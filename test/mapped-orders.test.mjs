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
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('test source bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const projectData = { filename: 'part.3mf', sha256, plates: [{ number: 2, filaments: [{ sourceSlot: 3, material: 'PETG', color: '#FFFFFF' }] }] };
const input = { id: 'mapped-order', plates: [2], release: 'manual', projectData, mappings: [{ sourceSlot: 3, materialId: id }] };
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mapped-orders-')); const calls = []; const reads = [];
  const server = createOrderServer({ directory, catalog: {
    search: async () => ({ materials: [], total: 0, hasMore: false }),
    get: async (materialId) => { reads.push(materialId); if (options.get) return options.get(materialId); if (![id, other].includes(materialId)) throw new Error('Catalog unavailable'); return { id: materialId, name: 'Black', sku: 'PETG-01', materialType: 'PETG', color: '#112233', selectable: true }; },
  }, hive: { printJobs: { create: async (value) => { calls.push(value); if (options.create) return options.create(value); return { requestId: 'request-1' }; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls, reads, directory };
}
function upload(value, fileBytes = bytes) { const form = new FormData(); form.set('order', JSON.stringify(value)); form.set('file', new Blob([fileBytes]), 'part.3mf'); return { method: 'POST', body: form }; }
test('preview performs only catalog reads; submission binds file and sends supported SDK fields', async (t) => {
  const s = await setup(t);
  const preview = await fetch(s.url + '/orders/preview', { method: 'POST', body: JSON.stringify(input) });
  assert.deepEqual(await preview.json(), { plate: 2, filaments: [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }] });
  assert.equal(s.calls.length, 0);
  assert.equal((await fetch(s.url + '/orders', upload(input))).status, 202);
  assert.deepEqual(s.calls[0].filaments, [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }]);
  assert.equal(s.calls[0].plate, 2);
  assert.equal(s.calls[0].release, 'manual');
  assert.equal('catalogSelections' in s.calls[0], false);
  assert.equal('targetSlot' in s.calls[0].filaments[0], false);
  const stored = JSON.parse(await readFile(join(s.directory, 'mapped-order.json'), 'utf8'));
  assert.equal(stored.intent.catalogSelections[0].id, id);
  assert.equal(stored.intent.projectData.plates[0].filaments[0].sourceSlot, 3);
  const key = s.calls[0].idempotencyKey;
  assert.equal((await fetch(s.url + '/orders', upload(input))).status, 202);
  assert.equal(s.calls.length, 1);
  assert.equal(stored.plates[0].idempotencyKey, key);
  assert.equal((await fetch(s.url + '/orders', upload({ ...input, mappings: [{ sourceSlot: 3, materialId: other }] }))).status, 400);
  assert.equal(s.calls.length, 1);
});
test('changed source or invalid mapping stops before job creation', async (t) => {
  const s = await setup(t);
  for (const [value, payload] of [[input, Buffer.from('changed')], [{ ...input, projectData: { ...projectData, filename: 'other.3mf' } }, bytes], [{ ...input, plates: [3] }, bytes], [{ ...input, mappings: [] }, bytes], [{ ...input, mappings: [{ sourceSlot: 3, materialId: 'bad' }] }, bytes]]) {
    assert.equal((await fetch(s.url + '/orders', upload(value, payload))).status, 400);
  }
  assert.equal(s.calls.length, 0);
});

for (const mode of ['renamed', 'unavailable']) test(`lost-response replay retains saved requirements when catalog is ${mode}`, async (t) => {
  let changed = false;
  let attempts = 0;
  const s = await setup(t, {
    get: async (materialId) => {
      if (changed && mode === 'unavailable') throw new Error('Catalog unavailable');
      return { id: materialId, name: changed ? 'Renamed product' : 'Black', sku: 'PETG-01', materialType: 'PETG', color: '#112233', selectable: true };
    },
    create: async () => { if (++attempts === 1) throw new Error('Create response lost'); return { requestId: 'recovered-request' }; },
  });
  assert.equal((await fetch(s.url + '/orders', upload(input))).status, 400);
  const saved = JSON.parse(await readFile(join(s.directory, 'mapped-order.json'), 'utf8'));
  const readsBeforeReplay = s.reads.length;
  changed = true;
  const response = await fetch(s.url + '/orders', upload(input));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).requests[0].requestId, 'recovered-request');
  assert.equal(s.reads.length, readsBeforeReplay);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].idempotencyKey, saved.plates[0].idempotencyKey);
  assert.deepEqual(s.calls[1].filaments, [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }]);
  assert.equal((await fetch(s.url + '/orders', upload({ ...input, mappings: [{ sourceSlot: 3, materialId: other }] }))).status, 400);
  assert.equal(s.calls.length, 2);
});

test('orders stored before catalog IDs replay their saved requirements and keys unchanged', async (t) => {
  let attempts = 0;
  const s = await setup(t, { create: async () => { if (++attempts === 1) throw new Error('Create response lost'); return { requestId: 'recovered-request' }; } });
  assert.equal((await fetch(s.url + '/orders', upload(input))).status, 400);
  const path = join(s.directory, 'mapped-order.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  // A record written by the 0.3.2 sample: material and color only.
  saved.intent.filaments = saved.intent.filaments.map(({ filamentId, ...rest }) => rest);
  await writeFile(path, JSON.stringify(saved));
  const reads = s.reads.length;
  assert.equal((await fetch(s.url + '/orders', upload(input))).status, 202);
  assert.equal(s.reads.length, reads);
  assert.deepEqual(s.calls[1].filaments, [{ sourceSlot: 3, material: 'PETG', color: '#112233' }]);
  assert.equal(s.calls[1].idempotencyKey, saved.plates[0].idempotencyKey);
});
test('the installed SDK reads the organization catalog row and sends filamentId with its snapshot in one multipart create', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mapped-sdk-')); const events = []; const forms = [];
  const row = { id, sku: 'PETG-01', organization_id: 'org-private', material_type: 'PETG', color: '#112233', metadata: { externalId: 'store-1', colorName: 'Black', replacementFilamentId: null } };
  const hive = new PrintHive({ apiKey: 'test-only-key', baseUrl: 'http://127.0.0.1:1', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(url).pathname; events.push(`${init.method} ${path}`);
    if (path === `/v1/filament-catalog/${id}`) return Response.json(row);
    if (path === `/v1/filament-catalog/${other}`) return Response.json({ error: 'catalog_filament_not_found' }, { status: 404 });
    if (path === '/v1/print-jobs/create') { forms.push(init); return Response.json({ requestId: 'request-sdk', status: 'preparing', externalId: null, createdAt: '2026-01-01T00:00:00Z', job: null, requiredActions: [], error: null }, { status: 202 }); }
    return Response.json({ error: 'not_found' }, { status: 404 });
  } });
  const server = createOrderServer({ directory, hive, catalog: createCatalog(hive) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const preview = await fetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(input) });
  assert.deepEqual(await preview.json(), { plate: 2, filaments: [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }] });
  assert.deepEqual(events, [`GET /v1/filament-catalog/${id}`]);
  const submitted = await fetch(url + '/orders', upload(input));
  assert.equal(submitted.status, 202);
  assert.deepEqual((await submitted.json()).requests, [{ plate: 2, requestId: 'request-sdk' }]);
  assert.deepEqual(events, [`GET /v1/filament-catalog/${id}`, `GET /v1/filament-catalog/${id}`, 'POST /v1/print-jobs/create']);
  const stored = JSON.parse(await readFile(join(directory, 'mapped-order.json'), 'utf8'));
  assert.equal(forms[0].headers.get('idempotency-key'), stored.plates[0].idempotencyKey);
  assert.equal(forms[0].body.get('plate'), '2');
  assert.equal(forms[0].body.get('release'), 'manual');
  assert.equal(forms[0].body.get('file').name, 'part.3mf');
  assert.deepEqual(JSON.parse(forms[0].body.get('filaments')), [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }]);
  assert.deepEqual(stored.intent.filaments, [{ sourceSlot: 3, filamentId: id, material: 'PETG', color: '#112233' }]);
  assert.equal(stored.intent.catalogSelections[0].id, id);
  assert.equal(JSON.stringify(stored).includes('org-private'), false);
  const foreign = { ...input, id: 'foreign-catalog-order', mappings: [{ sourceSlot: 3, materialId: other }] };
  assert.equal((await fetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(foreign) })).status, 400);
  const refused = await fetch(url + '/orders', upload(foreign));
  assert.equal(refused.status, 400);
  const body = await refused.json();
  assert.equal(body.upstreamStatus, 404);
  assert.equal(body.code, 'catalog_filament_not_found');
  assert.equal(forms.length, 1);
  assert.ok(events.every((e) => !e.includes('/v1/materials')));
  assert.deepEqual(events.slice(3), [`GET /v1/filament-catalog/${other}`, `GET /v1/filament-catalog/${other}`]);
});
