import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PrintHive } from '@printhive/api';
import { createCatalogSync } from '../../src/catalog-sync.mjs';
export async function fixture() {
  const calls = [], rows = new Map(), counts = new Map();
  let failed = true;
  const id = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const api = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/v1/filament-catalog')) { res.writeHead(404).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), key: req.headers['idempotency-key'], body: raw });
    assert.equal(req.headers['x-api-key'], 'owned-contract-fixture-key');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST') {
      const input = JSON.parse(raw); counts.set(input.externalId, (counts.get(input.externalId) ?? 0)+1);
      if (input.externalId === 'retry-record' && failed) return send(422, { error: 'contract_rejection', message: 'upstream-private-detail' });
      const row = { id: input.externalId === 'retry-record' ? secondId : id, sku: input.sku, organization_id: 'private-fixture-org', material_type: input.material, color: input.colorHex, brand: input.brand, metadata: { externalId: input.externalId, colorName: input.colorName, replacementFilamentId: input.replacementFilamentId ?? null } };
      rows.set(input.externalId, row);
      // First response is lost after the write. The real SDK must replay identical bytes/key.
      if (input.externalId.includes('lost') && counts.get(input.externalId) === 1) return req.socket.destroy();
      return send(200, row);
    }
    if (url.pathname === '/v1/filament-catalog') {
      const found = [...rows.values()].filter(r => (!url.searchParams.has('externalId') || r.metadata.externalId === url.searchParams.get('externalId')) && (!url.searchParams.has('sku') || r.sku === url.searchParams.get('sku')));
      return send(200, { materials: found, total: found.length });
    }
    const found = [...rows.values()].find(r => r.id === url.pathname.split('/').at(-1));
    return found ? send(200, found) : send(404, { error: 'not_found', message: 'upstream-private-detail' });
  });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const hive = new PrintHive({ apiKey: 'owned-contract-fixture-key', baseUrl: `http://127.0.0.1:${api.address().port}`, maxRetries: 1 });
  return { hive, calls, rows, id, allowRetry: () => { failed = false; }, close: async () => { api.closeAllConnections(); await new Promise(r => api.close(r)); } };
}
export const record = { externalId: 'store/lost response', brand: 'Example', material: 'PETG', colorName: 'Green', colorHex: '#39FF14', sku: 'PETG+GREEN & 01' };
export async function contract() {
  const f = await fixture();
  try {
    const sync = createCatalogSync(f.hive);
    sync.preview([record]); assert.equal(f.calls.length, 0);
    await assert.rejects(sync.upsert([record, { ...record, externalId: 'bad', colorHex: 'oops' }])); assert.equal(f.calls.length, 0);
    const first = await sync.upsert([record, { ...record, externalId: 'retry-record' }]);
    assert.equal(first.synced, 1); assert.equal(first.failed, 1); assert.equal(first.outcomes[0].filament.id, f.id);
    assert.equal(first.outcomes[1].upstreamStatus, 422); assert(!JSON.stringify(first).includes('upstream-private'));
    const retryCalls = f.calls.filter(c => c.method === 'POST' && c.key === encodeURIComponent(record.externalId));
    assert.equal(retryCalls.length, 2); assert.deepEqual(JSON.parse(retryCalls[0].body), record); assert.equal(retryCalls[0].body, retryCalls[1].body);
    const updated = await sync.upsert([{ ...record, colorHex: '#FFFFFF' }]); assert.equal(updated.outcomes[0].filament.id, f.id);
    const listed = await sync.list(new URLSearchParams({ externalId: record.externalId, sku: record.sku })); assert.equal(listed.total, 1); assert.equal(listed.materials[0].colorHex, '#FFFFFF');
    const query = f.calls.find(c => c.method === 'GET').query; assert.equal(query.externalId, record.externalId); assert.equal(query.sku, record.sku);
    assert.equal((await sync.get(f.id)).externalId, record.externalId);
    await assert.rejects(sync.get('33333333-3333-4333-8333-333333333333'), e => e.status === 404);
    f.allowRetry(); assert.equal((await sync.upsert([{ ...record, externalId: 'retry-record' }])).synced, 1);
    assert.equal(f.calls.some(c => c.path.includes('print-jobs')), false);
    console.log(JSON.stringify({ fixture: 'owned loopback HTTP contract, not production or real database', sdk: '0.3.0 local package', passed: ['preview zero SDK calls', 'whole-batch validation before writes', 'lost response replays identical JSON and encoded external-ID key', 'partial 422 failure sanitized', 'update retains UUID', 'list filters preserve special characters', 'get and 404 propagation', 'explicit failed-record retry'], wireCalls: f.calls.length }, null, 2));
  } finally { await f.close(); }
}
if (process.argv[1]?.endsWith('/contract.mjs')) await contract();
