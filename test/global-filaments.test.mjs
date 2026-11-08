import { localFetch } from "./local-fetch.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { PrintHive } from '@printhive/api';
import { createOrderServer } from '../src/server.mjs';
import { createCatalog } from '../src/catalog.mjs';
import { validateOrder } from '../src/orders.mjs';

const globalId = '44444444-4444-4444-8444-444444444444';
const orgId = '11111111-1111-4111-8111-111111111111';
const refusedId = '77777777-7777-4777-8777-777777777777';
const printerId = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('global filament test bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const projectData = { filename: 'shared.3mf', sha256, plates: [2, 7].map((number) => ({ number, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#000000' }] })) };
const batch = { id: 'global-batch', plates: [2, 7], release: 'manual', projectData, plateMappings: [2, 7].map((plate) => ({ plate, mappings: [{ sourceSlot: 0, materialId: globalId }] })) };
const single = { id: 'global-single', plates: [2], release: 'manual', projectData, mappings: [{ sourceSlot: 0, materialId: globalId }] };
const globalRow = { id: 'picker-row-1', filamentId: globalId, acceptedByCreate: true, name: 'Generic PETG-CF', brand: 'Generic', material_type: 'PETG-CF', color: 'black', diameter: 1.75, category: 'filament', sku: null, organization_id: 'global' };
const orgRow = { ...globalRow, id: 'picker-row-2', filamentId: orgId, name: 'Black PETG', brand: 'Example', material_type: 'PETG', color: '#000000', sku: 'PETG-01', organization_id: '99999999-9999-4999-8999-999999999999' };
const refusedRow = { ...globalRow, id: 'picker-row-3', filamentId: refusedId, acceptedByCreate: false, name: 'Global missing color', color: null };
const rows = { enabled: [globalRow, orgRow, refusedRow], disabled: [orgRow] };
const receipt = { status: 'preparing', externalId: null, createdAt: '2026-01-01T00:00:00Z', job: null, requiredActions: [], error: null };

async function fixture(t, { create = () => null, globals = 'enabled', maxRetries = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'global-filaments-'));
  const events = [], forms = [];
  const hive = new PrintHive({ apiKey: 'test-only-key', baseUrl: 'http://127.0.0.1:1', maxRetries, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    events.push(`${init.method} ${path}`);
    if (path === '/v1/filaments/search') return Response.json({ filaments: rows[globals], total: rows[globals].length, hasMore: false, matchMode: 'strict', originalQuery: 'black PETG' });
    if (path === '/v1/print-jobs/create') { forms.push(init); return create(init, forms.length) ?? Response.json({ ...receipt, requestId: `request-${init.body.get('plate')}` }, { status: 202 }); }
    if (path.startsWith('/v1/print-jobs/create-requests/')) return Response.json({ ...receipt, requestId: path.split('/').at(-1) });
    return Response.json({ error: 'not_found', message: 'test-only-key must stay private' }, { status: 404 });
  } });
  const server = createOrderServer({ directory, hive, catalog: createCatalog(hive) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${server.address().port}`, events, forms, directory };
}
const upload = (order) => { const form = new FormData(); form.set('order', JSON.stringify(order)); form.set('file', new Blob([bytes]), 'shared.3mf'); return { method: 'POST', body: form }; };
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const requirements = (form) => JSON.parse(form.body.get('filaments'));
const key = (form) => form.headers.get('idempotency-key');
const catalogReads = (events) => events.filter((e) => e.includes('/v1/filament-catalog') || e.includes('/v1/materials'));

test('enabled global filaments are selectable on the search verdict alone; refused and excluded rows are not', async (t) => {
  const s = await fixture(t);
  const found = await (await localFetch(`${s.url}/catalog?q=black+PETG`)).json();
  assert.deepEqual(found.materials.map((m) => [m.id, m.acceptedByCreate, m.selectable]), [[globalId, true, true], [orgId, true, true], [refusedId, false, false]]);
  assert.deepEqual(found.materials[0], { id: globalId, name: 'Generic PETG-CF', brand: 'Generic', sku: null, materialType: 'PETG-CF', color: null, acceptedByCreate: true, selectable: true, unavailableReason: null });
  assert.match(found.materials[2].unavailableReason, /color/);
  assert.doesNotMatch(found.materials[2].unavailableReason, /only organization-owned|sync it to your catalog/i);
  for (const secret of ['organization_id', 'picker-row', 'test-only-key']) assert.equal(JSON.stringify(found).includes(secret), false, secret);
  const disabled = await fixture(t, { globals: 'disabled' });
  const excluded = await (await localFetch(`${disabled.url}/catalog?q=black+PETG`)).json();
  assert.deepEqual(excluded.materials.map((m) => m.id), [orgId]);
  assert.deepEqual(catalogReads([...s.events, ...disabled.events]), []);
});

test('single and multi-plate previews carry the global catalog ID without any catalog or materials read', async (t) => {
  const s = await fixture(t);
  const plates = await localFetch(`${s.url}/orders/preview`, json(batch));
  assert.equal(plates.status, 200);
  assert.deepEqual(await plates.json(), { plates: [2, 7].map((plate) => ({ plate, filaments: [{ sourceSlot: 0, filamentId: globalId }] })) });
  const one = await localFetch(`${s.url}/orders/preview`, json({ ...single, plates: [7] }));
  assert.equal(one.status, 200);
  assert.deepEqual(await one.json(), { plate: 7, filaments: [{ sourceSlot: 0, filamentId: globalId }] });
  assert.deepEqual(s.events, []);
});

test('multipart creation sends ID-only requirements with zero-based slots and hints, stores identity records, and retries with the saved key', async (t) => {
  const s = await fixture(t);
  const hinted = { ...batch, printer_id: printerId, plateMappings: [batch.plateMappings[0], { plate: 7, mappings: [{ sourceSlot: 0, materialId: globalId, targetSlot: { ams_id: 0, slot_id: 3 } }] }] };
  const submitted = await localFetch(`${s.url}/orders`, upload(hinted));
  assert.equal(submitted.status, 202);
  assert.deepEqual((await submitted.json()).requests, [{ plate: 2, requestId: 'request-2' }, { plate: 7, requestId: 'request-7' }]);
  assert.deepEqual(s.events, ['POST /v1/print-jobs/create', 'POST /v1/print-jobs/create']);
  assert.deepEqual(requirements(s.forms[0]), [{ sourceSlot: 0, filamentId: globalId }]);
  assert.deepEqual(requirements(s.forms[1]), [{ sourceSlot: 0, filamentId: globalId, targetSlot: { ams_id: 0, slot_id: 3 } }]);
  assert.deepEqual([s.forms[0].body.get('plate'), s.forms[0].body.get('printer_id'), s.forms[0].body.get('release'), s.forms[0].body.get('file').name], ['2', printerId, 'manual', 'shared.3mf']);
  const stored = JSON.parse(await readFile(join(s.directory, 'global-batch.json'), 'utf8'));
  assert.deepEqual(stored.intent.plateRequirements.map((r) => r.filaments), [requirements(s.forms[0]), requirements(s.forms[1])]);
  assert.deepEqual(stored.intent.plateRequirements.map((r) => r.catalogSelections), [[{ sourceSlot: 0, id: globalId }], [{ sourceSlot: 0, id: globalId }]]);
  assert.deepEqual(stored.plates.map((p) => p.idempotencyKey), s.forms.map(key));
  assert.equal((await localFetch(`${s.url}/orders`, upload(hinted))).status, 202);
  assert.equal(s.forms.length, 2);
  assert.equal((await localFetch(`${s.url}/orders`, upload({ ...hinted, plateMappings: [hinted.plateMappings[0], { plate: 7, mappings: [{ sourceSlot: 0, materialId: orgId }] }] }))).status, 400);
  assert.equal(s.forms.length, 2);
  assert.deepEqual(catalogReads(s.events), []);
});

test('an upstream 503 catalog_store_failed returns 503 with a safe code, and an unchanged retry reuses the saved key', async (t) => {
  const s = await fixture(t, { create: (init, attempt) => attempt === 1 ? Response.json({ error: 'catalog_store_failed', message: 'private settings read failure', filaments: [{ sourceSlot: 0, reason: 'catalog_store_failed' }] }, { status: 503 }) : null });
  const failed = await localFetch(`${s.url}/orders`, upload(single));
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.deepEqual([body.code, body.upstreamStatus], ['catalog_store_failed', 503]);
  for (const secret of ['private', 'settings read', 'test-only-key']) assert.equal(JSON.stringify(body).includes(secret), false, secret);
  const stored = JSON.parse(await readFile(join(s.directory, 'global-single.json'), 'utf8'));
  assert.equal('requestId' in stored.plates[0], false);
  assert.deepEqual(stored.intent.filaments, [{ sourceSlot: 0, filamentId: globalId }]);
  assert.deepEqual(stored.intent.catalogSelections, [{ sourceSlot: 0, id: globalId }]);
  const retried = await localFetch(`${s.url}/orders`, upload(single));
  assert.equal(retried.status, 202);
  assert.deepEqual((await retried.json()).requests, [{ plate: 2, requestId: 'request-2' }]);
  assert.equal(s.forms.length, 2);
  assert.equal(key(s.forms[1]), key(s.forms[0]));
  assert.equal(key(s.forms[1]), stored.plates[0].idempotencyKey);
  assert.deepEqual(requirements(s.forms[1]), requirements(s.forms[0]));
  assert.deepEqual(catalogReads(s.events), []);
});

test('the installed SDK retries an eligible 503 with the same key before the sample reports it', async (t) => {
  const s = await fixture(t, { maxRetries: 1, create: (init, attempt) => attempt === 1 ? Response.json({ error: 'catalog_store_failed', message: 'transient' }, { status: 503, headers: { 'retry-after': '0' } }) : null });
  assert.equal((await localFetch(`${s.url}/orders`, upload(single))).status, 202);
  assert.equal(s.forms.length, 2);
  assert.equal(key(s.forms[1]), key(s.forms[0]));
});

test('explicit material and color travel to Hive unchanged; a contradiction returns the 422 code and local shape errors stop first', async (t) => {
  const s = await fixture(t, { create: () => Response.json({ error: 'filament_catalog_conflict', message: 'private row details', filaments: [{ sourceSlot: 0, reason: 'filament_catalog_conflict' }] }, { status: 422 }) });
  const order = { id: 'explicit-conflict', file: 'cube.3mf', plates: [1], release: 'manual', filaments: [{ sourceSlot: 0, filamentId: globalId, material: 'PLA', color: '#000000' }] };
  const refused = await localFetch(`${s.url}/orders`, json(order));
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.deepEqual([body.code, body.upstreamStatus], ['filament_catalog_conflict', 422]);
  assert.equal(JSON.stringify(body).includes('private'), false);
  assert.deepEqual(requirements(s.forms[0]), [{ sourceSlot: 0, filamentId: globalId, material: 'PLA', color: '#000000' }]);
  for (const filaments of [[{ sourceSlot: 0 }], [{ sourceSlot: 0, filamentId: 'SKU-1' }], [{ sourceSlot: 0, filamentId: globalId, color: 'black' }], [{ sourceSlot: 0, filamentId: globalId, material: '' }], [{ sourceSlot: 0, material: 'PLA' }]])
    assert.equal((await localFetch(`${s.url}/orders`, json({ ...order, id: 'local-shape', filaments }))).status, 400);
  assert.equal(s.forms.length, 1);
  assert.deepEqual(catalogReads(s.events), []);
});

test('validateOrder accepts catalog-ID or typed requirements and rejects partial ones', () => {
  const base = { id: 'direct', file: 'cube.3mf', plates: [1] };
  for (const filament of [{ sourceSlot: 0, filamentId: globalId }, { sourceSlot: 255, filamentId: globalId.toUpperCase(), material: 'PLA-S', color: '#aabbcc' }, { sourceSlot: 0, material: 'PETG', color: '#000000' }, { sourceSlot: 0, material: 'PETG', color: '#000000', filamentId: orgId }])
    assert.equal(validateOrder({ ...base, filaments: [filament] }).filaments[0], filament);
  for (const filament of [{ sourceSlot: 0 }, { sourceSlot: 0, filamentId: 'SKU-1' }, { sourceSlot: 0, filamentId: globalId, color: 'black' }, { sourceSlot: 0, filamentId: globalId, material: '' }, { sourceSlot: 0, filamentId: globalId, material: 7 }, { sourceSlot: 0, material: 'PETG' }, { sourceSlot: 256, filamentId: globalId }])
    assert.throws(() => validateOrder({ ...base, filaments: [filament] }), /Invalid order/);
});

test('orders saved by the 0.3.2 and 0.4.0 samples replay their stored requirements byte-for-byte with the saved keys', async (t) => {
  let lost = 3;
  const s = await fixture(t, { create: () => { if (lost-- > 0) throw new Error('lost response'); return null; } });
  const legacySingle = { ...single, id: 'saved-single', mappings: [{ sourceSlot: 0, materialId: orgId }] };
  assert.equal((await localFetch(`${s.url}/orders`, upload(legacySingle))).status, 400);
  assert.equal((await localFetch(`${s.url}/orders`, upload(batch))).status, 400);
  const snapshot = (id, extra) => ({ sourceSlot: 0, id, name: 'Snapshot name', brand: 'Snapshot', sku: null, materialType: 'PETG-CF', color: '#000000', selectable: true, unavailableReason: null, ...extra });
  const rewrites = {
    'saved-single': (intent) => ({ ...intent, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#000000' }], catalogSelections: [snapshot(orgId)] }),
    'global-batch': (intent) => ({ ...intent, plateRequirements: intent.plateRequirements.map((r) => ({ ...r, filaments: r.filaments.map((f) => ({ ...f, material: 'PETG-CF', color: '#000000' })), catalogSelections: [snapshot(globalId)] })) }),
  };
  const saved = {};
  for (const [id, rewrite] of Object.entries(rewrites)) {
    const path = join(s.directory, `${id}.json`), record = JSON.parse(await readFile(path, 'utf8'));
    record.intent = rewrite(record.intent);
    await writeFile(path, JSON.stringify(record));
    saved[id] = record;
  }
  assert.equal((await localFetch(`${s.url}/orders`, upload(legacySingle))).status, 202);
  assert.equal((await localFetch(`${s.url}/orders`, upload(batch))).status, 202);
  assert.deepEqual(s.forms.slice(3).map(requirements), [[{ sourceSlot: 0, material: 'PETG', color: '#000000' }], [{ sourceSlot: 0, filamentId: globalId, material: 'PETG-CF', color: '#000000' }], [{ sourceSlot: 0, filamentId: globalId, material: 'PETG-CF', color: '#000000' }]]);
  assert.deepEqual(s.forms.slice(3).map(key), [saved['saved-single'].plates[0].idempotencyKey, ...saved['global-batch'].plates.map((p) => p.idempotencyKey)]);
  assert.equal((await localFetch(`${s.url}/orders`, upload({ ...legacySingle, mappings: [{ sourceSlot: 0, materialId: globalId }] }))).status, 400);
  assert.equal(s.forms.length, 6);
  assert.deepEqual(catalogReads(s.events), []);
});
