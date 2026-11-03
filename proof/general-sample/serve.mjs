import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clientFromEnv } from '../../src/client.mjs';
import { createOrderServer } from '../../src/server.mjs';

const demoPort = Number(process.env.DEMO_PORT ?? 3086);
if (demoPort === 3077) throw new Error('Port 3077 is reserved for the user sample');
const organizationId = '55555555-5555-4555-8555-555555555555';
const filament = { id: '11111111-1111-4111-8111-111111111111', name: 'Black PETG', brand: 'Bambu', sku: 'MOCK-PETG', material_type: 'PETG', color: '#000000', diameter: 1.75, category: 'filament', organization_id: organizationId };
const sharedMaterials = process.env.DEMO_PROJECT === 'shared';
const multiPlate = sharedMaterials || process.env.DEMO_PROJECT === 'plates';
const ownedRows = multiPlate ? [{ ...filament, name: 'Red PETG', color: '#B44235' }, { ...filament, id: '33333333-3333-4333-8333-333333333333', name: 'Blue PETG', color: '#296AAB' }, { ...filament, id: '66666666-6666-4666-8666-666666666666', name: 'Black PETG' }] : [filament];
const globalRows = [
  { ...filament, id: '44444444-4444-4444-8444-444444444444', filamentId: '44444444-4444-4444-8444-444444444444', brand: 'Generic', name: 'Generic PETG-CF', material_type: 'PETG-CF', color: '#000000', organization_id: 'global', acceptedByCreate: true },
  { ...filament, id: '77777777-7777-4777-8777-777777777777', filamentId: '77777777-7777-4777-8777-777777777777', brand: 'Generic', name: 'Global missing color', color: null, organization_id: 'global', acceptedByCreate: false },
];
const catalogRows = [...ownedRows.map(row => ({ ...row, filamentId: row.id, acceptedByCreate: true })), ...(process.env.DEMO_GLOBALS === 'disabled' ? [] : globalRows)];
const printerId = '22222222-2222-4222-8222-222222222222';
const requests = new Map();
const events = [];
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const reply = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  events.push(`${req.method} ${url.pathname}${url.search}`);
  if (url.pathname === '/v1/filaments/search') {
    const query = url.searchParams.get('q') ?? '';
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows = catalogRows.filter(row => terms.every(term => [row.id, row.name, row.brand, row.material_type, row.sku, row.color === '#000000' ? 'black' : ''].some(value => String(value).toLowerCase().includes(term))));
    return reply({ filaments: rows, total: rows.length, hasMore: false, matchMode: 'strict', originalQuery: query });
  }
  if (url.pathname === '/v1/printers/search') return reply({ printers: [{ id: printerId, name: 'Boo mock printer', model: 'P1S', serial_number: 'fixture-only', status: 'idle', location_text: 'mock room', score: 1, match: 'text' }], total: 1, query: url.searchParams.get('q') });
  if (url.pathname.startsWith('/v1/filament-catalog/')) {
    const row = ownedRows.find(row => url.pathname === `/v1/filament-catalog/${row.id}`);
    return row ? reply({ ...row, metadata: { externalId: `fixture-${row.id}`, colorName: row.name, replacementFilamentId: null } }) : reply({ error: 'catalog_filament_not_found' }, 404);
  }
  if (url.pathname === '/v1/print-jobs/42') return reply({ job: { id: 42, status: 'QUEUED', printer_id: printerId, print_options: { filament_route_state: 'waiting', filament_waiting_reasons: [{ code: 'filament_not_loaded', sourceSlot: 0, material: 'PETG', color: multiPlate ? '#B44235' : '#000000', cause: 'slot_empty', suggestedTargetSlot: { ams_id: 0, slot_id: 1 } }] } } });
  if (req.method === 'POST' && url.pathname === '/v1/print-jobs/create') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    if (form.get('file')?.name !== (sharedMaterials ? 'shared.3mf' : multiPlate ? 'valid.3mf' : 'cube.3mf')) return reply({ error: 'fixture_only' }, 422);
    const requirements = JSON.parse(form.get('filaments'));
    for (const requirement of requirements) {
      const row = catalogRows.find(row => row.filamentId === requirement.filamentId);
      if (!row?.acceptedByCreate) return reply({ error: 'catalog_filament_not_found' }, 422);
      if ((requirement.material !== undefined && requirement.material.toUpperCase() !== row.material_type.toUpperCase()) || (requirement.color !== undefined && requirement.color.toUpperCase() !== row.color.toUpperCase())) return reply({ error: 'filament_catalog_conflict' }, 422);
    }
    events.push({ createdPlate: Number(form.get('plate')), requirements, release: form.get('release') });
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
app.listen(demoPort, '127.0.0.1'); await once(app, 'listening');
console.log(`Mock-only sample on http://127.0.0.1:${app.address().port}. No real Hive API, slicing engine, or printer connection.`);
async function close() {
  app.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(r => app.close(r)), new Promise(r => upstream.close(r))]);
  await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ fixtureEvents: events }));
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void close(); });
