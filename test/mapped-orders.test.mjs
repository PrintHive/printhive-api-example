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
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('test source bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const projectData = { filename: 'part.3mf', sha256, plates: [{ number: 2, filaments: [{ sourceSlot: 3, material: 'PETG', color: '#FFFFFF' }] }] };
const input = { id: 'mapped-order', plates: [2], release: 'manual', projectData, mappings: [{ sourceSlot: 3, materialId: id }] };
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mapped-orders-')); const calls = [];
  const server = createOrderServer({ directory, hive: { printJobs: { create: async (value) => { calls.push(value); if (options.create) return options.create(value); return { requestId: 'request-1' }; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls, directory };
}
function upload(value, fileBytes = bytes) { const form = new FormData(); form.set('order', JSON.stringify(value)); form.set('file', new Blob([fileBytes]), 'part.3mf'); return { method: 'POST', body: form }; }
test('preview is local validation; submission binds the file and sends the catalog ID without a material snapshot', async (t) => {
  const s = await setup(t);
  const preview = await localFetch(s.url + '/orders/preview', { method: 'POST', body: JSON.stringify(input) });
  assert.deepEqual(await preview.json(), { plate: 2, filaments: [{ sourceSlot: 3, filamentId: id }] });
  assert.equal(s.calls.length, 0);
  assert.equal((await localFetch(s.url + '/orders', upload(input))).status, 202);
  assert.deepEqual(s.calls[0].filaments, [{ sourceSlot: 3, filamentId: id }]);
  assert.equal(s.calls[0].plate, 2);
  assert.equal(s.calls[0].release, 'manual');
  assert.equal('catalogSelections' in s.calls[0], false);
  const stored = JSON.parse(await readFile(join(s.directory, 'mapped-order.json'), 'utf8'));
  assert.deepEqual(stored.intent.catalogSelections, [{ sourceSlot: 3, id }]);
  assert.equal(stored.intent.projectData.plates[0].filaments[0].sourceSlot, 3);
  const key = s.calls[0].idempotencyKey;
  assert.equal((await localFetch(s.url + '/orders', upload(input))).status, 202);
  assert.equal(s.calls.length, 1);
  assert.equal(stored.plates[0].idempotencyKey, key);
  assert.equal((await localFetch(s.url + '/orders', upload({ ...input, mappings: [{ sourceSlot: 3, materialId: other }] }))).status, 400);
  assert.equal(s.calls.length, 1);
});
test('changed source or invalid mapping stops before job creation', async (t) => {
  const s = await setup(t);
  for (const [value, payload] of [[input, Buffer.from('changed')], [{ ...input, projectData: { ...projectData, filename: 'other.3mf' } }, bytes], [{ ...input, plates: [3] }, bytes], [{ ...input, mappings: [] }, bytes], [{ ...input, mappings: [{ sourceSlot: 3, materialId: 'bad' }] }, bytes]]) {
    assert.equal((await localFetch(s.url + '/orders', upload(value, payload))).status, 400);
  }
  assert.equal(s.calls.length, 0);
});
test('lost-response replay resends the saved catalog ID with the saved key', async (t) => {
  let attempts = 0;
  const s = await setup(t, { create: async () => { if (++attempts === 1) throw new Error('Create response lost'); return { requestId: 'recovered-request' }; } });
  assert.equal((await localFetch(s.url + '/orders', upload(input))).status, 400);
  const saved = JSON.parse(await readFile(join(s.directory, 'mapped-order.json'), 'utf8'));
  const response = await localFetch(s.url + '/orders', upload(input));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).requests[0].requestId, 'recovered-request');
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].idempotencyKey, saved.plates[0].idempotencyKey);
  assert.deepEqual(s.calls[1].filaments, [{ sourceSlot: 3, filamentId: id }]);
  assert.equal((await localFetch(s.url + '/orders', upload({ ...input, mappings: [{ sourceSlot: 3, materialId: other }] }))).status, 400);
  assert.equal(s.calls.length, 2);
});
test('orders stored before catalog IDs replay their saved requirements and keys unchanged', async (t) => {
  let attempts = 0;
  const s = await setup(t, { create: async () => { if (++attempts === 1) throw new Error('Create response lost'); return { requestId: 'recovered-request' }; } });
  assert.equal((await localFetch(s.url + '/orders', upload(input))).status, 400);
  const path = join(s.directory, 'mapped-order.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  saved.intent.filaments = [{ sourceSlot: 3, material: 'PETG', color: '#112233' }];
  saved.intent.catalogSelections = [{ sourceSlot: 3, id, name: 'Black', sku: 'PETG-01', materialType: 'PETG', color: '#112233', selectable: true }];
  await writeFile(path, JSON.stringify(saved));
  assert.equal((await localFetch(s.url + '/orders', upload(input))).status, 202);
  assert.deepEqual(s.calls[1].filaments, [{ sourceSlot: 3, material: 'PETG', color: '#112233' }]);
  assert.equal(s.calls[1].idempotencyKey, saved.plates[0].idempotencyKey);
});
test('the installed SDK sends the catalog ID in one multipart create and never reads the organization catalog row', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mapped-sdk-')); const events = []; const forms = [];
  const hive = new PrintHive({ apiKey: 'test-only-key', baseUrl: 'http://127.0.0.1:1', maxRetries: 0, fetch: async (url, init) => {
    const path = new URL(url).pathname; events.push(`${init.method} ${path}`);
    if (path === '/v1/print-jobs/create') {
      forms.push(init);
      if (JSON.parse(init.body.get('filaments')).some((f) => f.filamentId === other)) return Response.json({ error: 'catalog_filament_not_found', message: 'org-private details', filaments: [{ sourceSlot: 3, reason: 'catalog_filament_not_found' }] }, { status: 422 });
      return Response.json({ requestId: 'request-sdk', status: 'preparing', externalId: null, createdAt: '2026-01-01T00:00:00Z', job: null, requiredActions: [], error: null }, { status: 202 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  } });
  const server = createOrderServer({ directory, hive, catalog: createCatalog(hive) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const preview = await localFetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(input) });
  assert.deepEqual(await preview.json(), { plate: 2, filaments: [{ sourceSlot: 3, filamentId: id }] });
  assert.deepEqual(events, []);
  const submitted = await localFetch(url + '/orders', upload(input));
  assert.equal(submitted.status, 202);
  assert.deepEqual((await submitted.json()).requests, [{ plate: 2, requestId: 'request-sdk' }]);
  assert.deepEqual(events, ['POST /v1/print-jobs/create']);
  const stored = JSON.parse(await readFile(join(directory, 'mapped-order.json'), 'utf8'));
  assert.equal(forms[0].headers.get('idempotency-key'), stored.plates[0].idempotencyKey);
  assert.equal(forms[0].body.get('plate'), '2');
  assert.equal(forms[0].body.get('release'), 'manual');
  assert.equal(forms[0].body.get('file').name, 'part.3mf');
  assert.deepEqual(JSON.parse(forms[0].body.get('filaments')), [{ sourceSlot: 3, filamentId: id }]);
  assert.deepEqual(stored.intent.filaments, [{ sourceSlot: 3, filamentId: id }]);
  assert.deepEqual(stored.intent.catalogSelections, [{ sourceSlot: 3, id }]);
  const foreign = { ...input, id: 'foreign-catalog-order', mappings: [{ sourceSlot: 3, materialId: other }] };
  assert.equal((await localFetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(foreign) })).status, 200);
  const refused = await localFetch(url + '/orders', upload(foreign));
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.deepEqual([body.code, body.upstreamStatus], ['catalog_filament_not_found', 422]);
  assert.equal(JSON.stringify(body).includes('org-private'), false);
  assert.equal(forms.length, 2);
  assert.ok(events.every((e) => e === 'POST /v1/print-jobs/create'));
});
