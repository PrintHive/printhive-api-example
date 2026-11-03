import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clientFromEnv } from '../../src/client.mjs';
import { createOrderServer } from '../../src/server.mjs';

const filament = { id: '11111111-1111-4111-8111-111111111111', name: 'Black PETG', brand: 'Bambu', sku: 'MOCK-PETG', material_type: 'PETG', color: '#000000', diameter: 1.75, category: 'filament', organization_id: null };
const multiPlate = process.env.DEMO_PROJECT === 'plates';
const catalogRows = multiPlate ? [{ ...filament, name: 'Red PETG', color: '#B44235' }, { ...filament, id: '33333333-3333-4333-8333-333333333333', name: 'Blue PETG', color: '#296AAB' }] : [filament];
const printerId = '22222222-2222-4222-8222-222222222222';
const requests = new Map();
const events = [];
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const reply = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  events.push(`${req.method} ${url.pathname}${url.search}`);
  if (url.pathname === '/v1/materials/command-search') return reply({ materials: /nothing/i.test(url.searchParams.get('q')) ? [] : catalogRows, total: catalogRows.length, hasMore: false, matchMode: 'strict', originalQuery: url.searchParams.get('q') });
  if (url.pathname === '/v1/search') return reply({ results: [{ type: 'printers', id: printerId, name: 'Boo mock printer', model: 'P1S', status: 'idle' }], total: 1, query: url.searchParams.get('q'), processingTimeMs: 1 });
  if (url.pathname === '/v1/materials') return reply({ materials: catalogRows, total: catalogRows.length });
  const catalogRow = catalogRows.find(row => url.pathname === `/v1/materials/${row.id}`);
  if (catalogRow) return reply(catalogRow);
  if (url.pathname === '/v1/print-jobs/42') return reply({ job: { id: 42, status: 'QUEUED', printer_id: printerId, print_options: { filament_route_state: 'waiting', filament_waiting_reasons: [{ code: 'filament_not_loaded', sourceSlot: 0, material: 'PETG', color: multiPlate ? '#B44235' : '#000000', cause: 'slot_empty', suggestedTargetSlot: { ams_id: 0, slot_id: 1 } }] } } });
  if (req.method === 'POST' && url.pathname === '/v1/print-jobs/create') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    if (form.get('file')?.name !== (multiPlate ? 'valid.3mf' : 'cube.3mf')) return reply({ error: 'fixture_only' }, 422);
    const requestId = randomUUID();
    const record = { requestId, status: 'preparing', externalId: null, createdAt: new Date().toISOString(), job: null, requiredActions: [], error: null };
    requests.set(requestId, { record, since: Date.now(), manual: form.get('release') === 'manual' });
    return reply(record, 202);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const item = requests.get(parts[3]);
  if (!item) return reply({ error: 'not_found' }, 404);
  if (req.method === 'POST' && parts[4] === 'cancel') { item.record.status = 'cancelled'; item.record.requiredActions = []; }
  if (req.method === 'POST' && parts[4] === 'release') { item.record.status = 'preparing'; item.record.requiredActions = []; item.manual = false; item.since = Date.now(); }
  if (item.record.status === 'preparing' && Date.now() - item.since > 1500) {
    item.record.status = item.manual ? 'held' : 'created';
    item.record.requiredActions = item.manual ? [{ code: 'manual_release_required' }] : [];
    if (!item.manual) item.record.job = { id: 42, status: 'QUEUED', model_file_id: null, printer_id: printerId, print_options: null };
  }
  reply(item.record);
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
process.env.PRINTHIVE_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.PRINTHIVE_API_KEY = 'local-contract-fixture';
const directory = await mkdtemp(join(tmpdir(), 'general-sample-orders-'));
const app = createOrderServer({ ...clientFromEnv(), directory, baseUrl: process.env.PRINTHIVE_BASE_URL });
app.listen(Number(process.env.DEMO_PORT ?? 3086), '127.0.0.1'); await once(app, 'listening');
console.log(`Mock-only sample on http://127.0.0.1:${app.address().port}. No real Hive API, slicing engine, or printer connection.`);
async function close() {
  app.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(r => app.close(r)), new Promise(r => upstream.close(r))]);
  await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ fixtureEvents: events }));
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void close(); });
