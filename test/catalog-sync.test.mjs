import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCatalogSync, validateCatalogBatch } from '../src/catalog-sync.mjs';
import { createOrderServer } from '../src/server.mjs';
const record = { externalId: 'printie-123', brand: 'Example', material: 'PETG', colorName: 'Green', colorHex: '#39ff14', sku: 'PETG-GREEN' };
const id = '11111111-1111-4111-8111-111111111111';
function row(input, uuid = id) {
  return { id: uuid, organization_id: 'not-browser-data', brand: input.brand, name: `${input.brand} ${input.material} ${input.colorName}`, material_type: input.material, color: input.colorHex, sku: input.sku, metadata: { externalId: input.externalId, colorName: input.colorName, replacementFilamentId: input.replacementFilamentId ?? null, private: 'not-browser-data' } };
}
test('batch validation canonicalizes aliases and rejects invalid imports before any SDK call', async () => {
  assert.deepEqual(validateCatalogBatch({ records: [{ ...record, externalId: ' printie-123 ', hex: '#39FF14', colorHex: '#39ff14', sku: ' PETG-GREEN ' }] }), [{ ...record, externalId: 'printie-123', colorHex: '#39FF14', sku: 'PETG-GREEN' }]);
  const { colorHex, ...withoutColor } = record;
  assert.equal(validateCatalogBatch([{ ...withoutColor, hex: '#112233' }])[0].colorHex, '#112233');
  let calls = 0;
  const sync = createCatalogSync({ filamentCatalog: { upsert: async () => { calls++; }, list() {}, get() {} } });
  for (const invalid of [[], Array(21).fill(record), { log: { entries: [] } }, [{ ...withoutColor }], [{ ...record, hex: '#FFFFFF' }], [{ ...record, extra: 'unknown' }], [{ ...record, brand: ' ' }], [{ ...record, sku: '' }], [{ ...record, material: 'x'.repeat(101) }], [{ ...record, replacementFilamentId: {} }], [record, { ...record, externalId: ' printie-123 ' }]]) await assert.rejects(sync.upsert(invalid));
  assert.equal(calls, 0);
  assert.equal(sync.preview([record]).records[0].externalId, record.externalId);
  assert.equal(calls, 0);
});
test('explicit sequential upserts retain stable identity and return partial outcomes safely', async () => {
  const bindings = new Map(); const events = []; let active = 0;
  const sync = createCatalogSync({ filamentCatalog: {
    async upsert(input) { assert.equal(active++, 0); events.push(input.externalId); try { await Promise.resolve(); if (input.externalId === 'bad') throw Object.assign(new Error('secret-key raw SQL'), { status: 403 }); const result = row(input); bindings.set(input.externalId, result); return result; } finally { active--; } },
    async list() { return { materials: [...bindings.values()], total: bindings.size }; },
    async get() { return bindings.get(record.externalId); },
  } });
  const first = await sync.upsert([record, { ...record, externalId: 'bad', sku: 'SECOND' }]);
  assert.equal(first.synced, 1); assert.equal(first.failed, 1);
  assert.equal(first.outcomes[0].filament.id, id);
  assert.equal(first.outcomes[1].error, 'Hive filament catalog returned HTTP 403');
  assert.equal(JSON.stringify(first).includes('secret-key'), false);
  assert.equal(JSON.stringify(first).includes('not-browser-data'), false);
  const again = await sync.upsert([{ ...record, colorHex: '#FFFFFF', replacementFilamentId: 'future-printie-id' }]);
  assert.equal(again.outcomes[0].filament.id, id);
  assert.equal(again.outcomes[0].filament.colorHex, '#FFFFFF');
  assert.equal(again.outcomes[0].filament.replacementFilamentId, 'future-printie-id');
  assert.deepEqual(events, ['printie-123', 'bad', 'printie-123']);
});
test('catalog list and read use SDK methods and sanitize permissions or malformed responses', async () => {
  const calls = [];
  const sync = createCatalogSync({ filamentCatalog: { upsert() {}, async list(query) { calls.push(query); return { materials: [row(record)], total: 21 }; }, async get(value) { calls.push(value); return row(record); } } });
  const page = await sync.list(new URLSearchParams({ externalId: ' printie-123 ', sku: 'PETG-GREEN', offset: '0', limit: '20' }));
  assert.equal(page.hasMore, true);
  assert.deepEqual(calls[0], { limit: 20, offset: 0, externalId: 'printie-123', sku: 'PETG-GREEN' });
  assert.equal((await sync.get(id)).externalId, 'printie-123');
  assert.equal(calls[1], id);
  await assert.rejects(sync.list(new URLSearchParams({ q: 'unsupported' })));
  await assert.rejects(sync.list(new URLSearchParams({ limit: '201' })));
  await assert.rejects(sync.get('not-uuid'));
});
async function setup(t, filamentCatalog) {
  let printCalls = 0;
  const server = createOrderServer({ hive: { filamentCatalog, printJobs: { create: async () => { printCalls++; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  return { url: `http://127.0.0.1:${server.address().port}`, printCalls: () => printCalls };
}
const post = (value) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
test('preview routes never sync; explicit upsert, list and get use only injected SDK catalog', async (t) => {
  const events = [];
  const s = await setup(t, { async upsert(input) { events.push('upsert'); return row(input); }, async list() { events.push('list'); return { materials: [row(record)], total: 1 }; }, async get() { events.push('get'); return row(record); } });
  const config = await (await fetch(s.url+'/config')).json();
  assert.equal(config.sdk.capabilities.filamentCatalog, true);
  assert.equal((await fetch(s.url+'/catalog-sync/preview', post([record]))).status, 200);
  assert.deepEqual(events, []);
  const formStyle = await fetch(s.url+'/catalog-sync/upsert', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify([record]) });
  assert.equal(formStyle.status, 400); assert.deepEqual(events, []);
  assert.equal((await fetch(s.url+'/catalog-sync/upsert', post([record]))).status, 200);
  assert.deepEqual(events, ['upsert']);
  assert.equal((await fetch(s.url+'/catalog-sync/list')).status, 200);
  assert.equal((await fetch(s.url+`/catalog-sync/filaments/${id}`)).status, 200);
  assert.deepEqual(events, ['upsert', 'list', 'get']);
  assert.equal(s.printCalls(), 0);
});
test('older SDK capability fails cleanly without HTTP fallback and preview remains read-only', async (t) => {
  const s = await setup(t, undefined);
  assert.equal((await (await fetch(s.url+'/config')).json()).sdk.capabilities.filamentCatalog, false);
  const preview = await (await fetch(s.url+'/catalog-sync/preview', post([record]))).json();
  assert.equal(preview.available, false);
  for (const [path, options] of [['/catalog-sync/upsert', post([record])], ['/catalog-sync/list'], [`/catalog-sync/filaments/${id}`]]) {
    const response = await fetch(s.url+path, options); assert.equal(response.status, 503); assert.match((await response.json()).error, /unavailable/);
  }
  assert.equal(s.printCalls(), 0);
});
test('catalog HTTP errors and invalid JSON never expose upstream secrets', async (t) => {
  const s = await setup(t, { upsert() {}, async list() { throw Object.assign(new Error('private-key raw database'), { status: 403 }); }, async get() { throw new Error('private-key'); } });
  const response = await fetch(s.url+'/catalog-sync/list');
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Hive filament catalog returned HTTP 403' });
  const get = await fetch(s.url+`/catalog-sync/filaments/${id}`); assert.equal(get.status, 502); assert.equal((await get.text()).includes('private-key'), false);
  const bad = await fetch(s.url+'/catalog-sync/preview', { method: 'POST', body: '{' }); assert.equal(bad.status, 400);
});
