import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createOrders } from '../src/orders.mjs';
import { createOrderServer } from '../src/server.mjs';
import { mappedPlateInputs } from '../src/mapped-plates.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'selected-plates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = resolve('test/fixtures/plate-previews/valid.3mf'), bytes = await readFile(file);
  const input = { id: 'selected-plates', file, plates: [2, 7], release: 'manual', projectData: { filename: 'valid.3mf', sha256: createHash('sha256').update(bytes).digest('hex'), plates: [2, 7].map(number => ({ number, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#000000' }] })) }, plateMappings: [{ plate: 2, mappings: [{ sourceSlot: 0, materialId: a }] }, { plate: 7, mappings: [{ sourceSlot: 0, materialId: b }] }] };
  const catalog = { get: async id => ({ id, materialType: 'PETG', color: id === a ? '#B44235' : '#296AAB', selectable: true }) };
  return { directory, input, bytes, catalog };
}
test('one local source snapshot creates only selected plates with independent requirements and durable keys', async t => {
  const f = await fixture(t), calls = [];
  const orders = createOrders({ printJobs: { create: async value => {
    const saved = JSON.parse(await readFile(join(f.directory, 'selected-plates.json'), 'utf8'));
    assert.equal(saved.plates.length, 2);
    assert.ok(saved.plates.every(p => p.idempotencyKey));
    calls.push(value); return { requestId: `request-${value.plate}` };
  } } }, f.directory, undefined, f.catalog);
  await orders.submit(f.input);
  assert.deepEqual(calls.map(v => [v.plate, v.filaments]), [[2, [{ sourceSlot: 0, material: 'PETG', color: '#B44235' }]], [7, [{ sourceSlot: 0, material: 'PETG', color: '#296AAB' }]]]);
  assert.equal(calls[0].file, calls[1].file);
  assert.deepEqual((await readdir(f.directory)).sort(), ['selected-plates.3mf', 'selected-plates.json']);
  await orders.submit(f.input);
  assert.equal(calls.length, 2);
});
test('a partial batch retries only the unsettled plate with its saved key and requirements', async t => {
  const f = await fixture(t), calls = []; let fail = true, readable = true;
  const hive = { printJobs: { create: async value => { calls.push(value); if (value.plate === 7 && fail) { fail = false; throw new Error('Lost response'); } return { requestId: `request-${value.plate}` }; } } };
  const orders = createOrders(hive, f.directory, undefined, { get: async id => { if (!readable) throw new Error('Catalog offline'); return f.catalog.get(id); } });
  await assert.rejects(orders.submit(f.input), /Lost response/);
  readable = false;
  await orders.submit(f.input);
  assert.deepEqual(calls.map(v => v.plate), [2, 7, 7]);
  assert.equal(calls[1].idempotencyKey, calls[2].idempotencyKey);
  assert.deepEqual(calls[1].filaments, calls[2].filaments);
  await assert.rejects(orders.submit({ ...f.input, plateMappings: [{ plate: 2, mappings: [{ sourceSlot: 0, materialId: b }] }, f.input.plateMappings[1]] }), /conflicts/);
  assert.equal(calls.length, 3);
});
test('missing, duplicate and foreign plate mapping groups fail before SDK calls', async t => {
  const { input } = await fixture(t);
  for (const plateMappings of [[], [input.plateMappings[0], input.plateMappings[0]], [input.plateMappings[0], { plate: 3, mappings: [] }]]) assert.throws(() => mappedPlateInputs({ ...input, plateMappings }));
});
test('HTTP preview and one multipart upload preserve per-plate mappings', async t => {
  const f = await fixture(t), calls = [];
  const server = createOrderServer({ directory: f.directory, catalog: f.catalog, hive: { printJobs: { create: async value => { calls.push(value); return { requestId: `request-${value.plate}` }; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const preview = await fetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(f.input) });
  assert.deepEqual(await preview.json(), { plates: [{ plate: 2, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#B44235' }] }, { plate: 7, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#296AAB' }] }] });
  assert.equal(calls.length, 0);
  const form = new FormData(); form.set('order', JSON.stringify(f.input)); form.set('file', new Blob([f.bytes]), 'valid.3mf');
  const submitted = await fetch(url + '/orders', { method: 'POST', body: form });
  assert.equal(submitted.status, 202);
  assert.deepEqual((await submitted.json()).requests, [{ plate: 2, requestId: 'request-2' }, { plate: 7, requestId: 'request-7' }]);
});

test('selecting a subset never submits unselected manifest plates', async t => {
  const f = await fixture(t), plates = [];
  const orders = createOrders({ printJobs: { create: async value => { plates.push(value.plate); return { requestId: 'only-blue' }; } } }, f.directory, undefined, f.catalog);
  await orders.submit({ ...f.input, plates: [7], plateMappings: [f.input.plateMappings[1]] });
  assert.deepEqual(plates, [7]);
});
