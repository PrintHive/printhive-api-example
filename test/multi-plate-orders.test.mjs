import { localFetch } from "./local-fetch.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
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
  return { directory, input, bytes };
}
test('one local source snapshot creates only selected plates with independent requirements and durable keys', async t => {
  const f = await fixture(t), calls = [];
  const orders = createOrders({ printJobs: { create: async value => {
    const saved = JSON.parse(await readFile(join(f.directory, 'selected-plates.json'), 'utf8'));
    assert.equal(saved.plates.length, 2);
    assert.ok(saved.plates.every(p => p.idempotencyKey));
    calls.push(value); return { requestId: `request-${value.plate}` };
  } } }, f.directory);
  await orders.submit(f.input);
  assert.deepEqual(calls.map(v => [v.plate, v.filaments]), [[2, [{ sourceSlot: 0, filamentId: a }]], [7, [{ sourceSlot: 0, filamentId: b }]]]);
  assert.equal(calls[0].file, calls[1].file);
  assert.deepEqual((await readdir(f.directory)).sort(), ['selected-plates.3mf', 'selected-plates.json']);
  await orders.submit(f.input);
  assert.equal(calls.length, 2);
});
test('a partial batch retries only the unsettled plate with its saved key and requirements', async t => {
  const f = await fixture(t), calls = []; let fail = true;
  const hive = { printJobs: { create: async value => { calls.push(value); if (value.plate === 7 && fail) { fail = false; throw new Error('Lost response'); } return { requestId: `request-${value.plate}` }; } } };
  const orders = createOrders(hive, f.directory);
  await assert.rejects(orders.submit(f.input), /Lost response/);
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
  const server = createOrderServer({ directory: f.directory, hive: { printJobs: { create: async value => { calls.push(value); return { requestId: `request-${value.plate}` }; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const preview = await localFetch(url + '/orders/preview', { method: 'POST', body: JSON.stringify(f.input) });
  assert.deepEqual(await preview.json(), { plates: [{ plate: 2, filaments: [{ sourceSlot: 0, filamentId: a }] }, { plate: 7, filaments: [{ sourceSlot: 0, filamentId: b }] }] });
  assert.equal(calls.length, 0);
  const form = new FormData(); form.set('order', JSON.stringify(f.input)); form.set('file', new Blob([f.bytes]), 'valid.3mf');
  const submitted = await localFetch(url + '/orders', { method: 'POST', body: form });
  assert.equal(submitted.status, 202);
  assert.deepEqual((await submitted.json()).requests, [{ plate: 2, requestId: 'request-2' }, { plate: 7, requestId: 'request-7' }]);
});

test('selecting a subset never submits unselected manifest plates', async t => {
  const f = await fixture(t), plates = [];
  const orders = createOrders({ printJobs: { create: async value => { plates.push(value.plate); return { requestId: 'only-blue' }; } } }, f.directory);
  await orders.submit({ ...f.input, plates: [7], plateMappings: [f.input.plateMappings[1]] });
  assert.deepEqual(plates, [7]);
});

test('batches stored before catalog IDs replay their saved per-plate requirements and keys unchanged', async t => {
  const f = await fixture(t), calls = []; let fail = true;
  const hive = { printJobs: { create: async value => { calls.push(value); if (value.plate === 7 && fail) { fail = false; throw new Error('Lost response'); } return { requestId: `request-${value.plate}` }; } } };
  await assert.rejects(createOrders(hive, f.directory).submit(f.input), /Lost response/);
  const path = join(f.directory, 'selected-plates.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  // A record written by the 0.3.2 sample: material and color only.
  saved.intent.plateRequirements = saved.intent.plateRequirements.map(r => ({ ...r, filaments: [{ sourceSlot: 0, material: 'PETG', color: r.plate === 2 ? '#B44235' : '#296AAB' }] }));
  await writeFile(path, JSON.stringify(saved));
  await createOrders(hive, f.directory).submit(f.input);
  assert.deepEqual(calls.map(v => v.plate), [2, 7, 7]);
  assert.deepEqual(calls[2].filaments, [{ sourceSlot: 0, material: 'PETG', color: '#296AAB' }]);
  assert.equal(calls[2].idempotencyKey, saved.plates[1].idempotencyKey);
});

test('one failed send or poll does not hide progress for sibling plates', async t => {
  const f = await fixture(t), sent = [];
  const hive = { printJobs: {
    create: async value => {
      sent.push(value);
      if (value.plate === 2) throw Object.assign(new Error('refused'), { code: 'catalog_store_failed', status: 503 });
      return { requestId: 'request-7' };
    },
    getCreateRequest: async () => ({ status: 'held', requestId: 'request-7', requiredActions: [{ code: 'manual_release_required' }] }),
  } };
  const orders = createOrders(hive, f.directory);
  await assert.rejects(orders.submit(f.input), /refused/);
  assert.deepEqual(sent.map(value => value.plate), [2, 7]);
  let status = await orders.status(f.input.id);
  assert.equal(status.plates[0].status, 'pending_submission');
  assert.equal(status.plates[0].error.code, 'catalog_store_failed');
  assert.equal(status.plates[1].status, 'held');
  hive.printJobs.getCreateRequest = async () => { throw Object.assign(new Error('offline'), { code: 'upstream_unavailable' }); };
  status = await orders.status(f.input.id);
  assert.equal(status.plates[0].status, 'pending_submission');
  assert.equal(status.plates[1].status, 'status_unavailable');
  assert.equal(status.plates[1].error.code, 'upstream_unavailable');
});

test('4xx rejections are final with upstream details while transport, 429 and 5xx can retry', async t => {
  for (const status of [null, 400, 403, 422, 429, 500, 503]) {
    const f = await fixture(t); let calls = 0;
    const failure = Object.assign(new Error('Rejected'), { ...(status ? { status } : {}), code: 'filaments_do_not_cover_plate', body: { message: 'Missing used sources', missingSlots: [3], reasons: ['source slot 3 is unmapped'] } });
    const hive = { printJobs: { create: async () => { calls++; throw failure; } } };
    const orders = createOrders(hive, f.directory);
    await assert.rejects(orders.submit(f.input));
    const snapshot = await orders.status(f.input.id);
    const retryable = status === null || status === 429 || status >= 500;
    assert.equal(snapshot.plates[0].status, retryable ? 'pending_submission' : 'failed');
    assert.deepEqual(snapshot.plates[0].error, { code: failure.code, message: 'Missing used sources', missingSlots: [3], reasons: ['source slot 3 is unmapped'], upstreamStatus: status, retryable, ...(retryable ? { retryAdvice: 'Not confirmed by Hive. Retry the same order with its saved key.' } : {}) });
    await createOrders(hive, f.directory).retry(f.input.id).catch(() => {});
    assert.equal(calls, retryable ? 4 : 2);
  }
});

test('status is visible during sequential uploads and disk-only retry after restart preserves all keys', async t => {
  const f = await fixture(t), calls = [];
  let unblock, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const block = new Promise(resolve => { unblock = resolve; });
  const hive = { printJobs: {
    create: async value => { calls.push(value); if (value.plate === 2) { started(); await block; return { requestId: 'request-2' }; } throw new Error('offline'); },
    getCreateRequest: async requestId => ({ requestId, status: 'held', plate: 999, requiredActions: [{ code: 'manual_release_required' }] }),
  } };
  const orders = createOrders(hive, f.directory);
  const submission = orders.submit(f.input);
  await waiting;
  assert.deepEqual((await orders.status(f.input.id)).plates.map(p => p.status), ['pending_submission', 'pending_submission']);
  unblock(); await assert.rejects(submission);
  const before = JSON.parse(await readFile(join(f.directory, f.input.id + '.json'), 'utf8'));
  hive.printJobs.create = async value => { calls.push(value); return { requestId: 'request-7' }; };
  const restarted = createOrders(hive, f.directory);
  await restarted.retry(f.input.id);
  assert.deepEqual(calls.map(c => c.plate), [2, 7, 7]);
  assert.equal(calls[2].idempotencyKey, before.plates[1].idempotencyKey);
  assert.deepEqual((await restarted.status(f.input.id)).plates.map(p => [p.plate, p.status]), [[2, 'held'], [7, 'held']]);
});
