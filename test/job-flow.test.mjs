import { localFetch } from "./local-fetch.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createOrders } from '../src/orders.mjs';
import { readCreatedJob, waitingFilamentInstructions, shouldPollJob } from '../src/job-status.mjs';
import { createOrderServer } from '../src/server.mjs';
import { PrintHive } from '@printhive/api';
import { createHash } from 'node:crypto';

test('slot-conflict guidance distinguishes explicit placement from another needed spool', () => {
  const reason = { code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: 'FFFFFF', cause: 'slot_conflict' };
  const placed = waitingFilamentInstructions([{ ...reason, suggestedTargetSlot: { ams_id: 0, slot_id: 3 } }])[0];
  assert.match(placed.instruction, /Change the slot assignment/);
  assert.doesNotMatch(placed.instruction, /^Load/);
  const unplaced = waitingFilamentInstructions([reason])[0];
  assert.match(unplaced.instruction, /^Load another PETG #FFFFFF spool/);
  assert.match(unplaced.placement, /No physical slot supplied/);
});

test('uncertain readings do not become loading instructions and distance hints remain advisory', () => {
  const uncertain = waitingFilamentInstructions([{ code: 'material_route_changed', sourceSlot: 7, material: 'PETG', color: 'FFFFFF' }])[0];
  assert.match(uncertain.instruction, /Check.*reading/);
  assert.doesNotMatch(uncertain.instruction, /^Load/);
  const distance = waitingFilamentInstructions([{ code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: 'FFFFFF', cause: 'color_distance' }])[0];
  assert.match(distance.explanation, /material or color/);
});

test('three of four loaded: display API-reported unmet source without inventing its physical slot', () => {
  const result = waitingFilamentInstructions([{ code: 'filament_not_loaded', sourceSlot: 7, material: 'PETG', color: '112233', cause: 'missing_material' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'Source slot 7');
  assert.equal(result[0].instruction, 'Load PETG #112233 for source slot 7.');
  assert.match(result[0].placement, /No physical slot supplied/);
  assert.equal(result[0].placement.includes('slot 7'), false);
  assert.equal(result[0].color, '#112233');
  assert.equal(result[0].explanation, 'The required material is not loaded.');
});
test('waiting instructions explain each cause while keeping optional and future causes readable', () => {
  const descriptions = [
    ['slot_empty', 'The requested printer slot is empty.'],
    ['missing_material', 'The required material is not loaded.'],
    ['color_distance', 'The loaded filament does not meet the material or color requirements.'],
    ['slot_conflict', 'The printer slots cannot satisfy all filament requirements at the same time.'],
  ];
  for (const [cause, explanation] of descriptions) {
    const [instruction] = waitingFilamentInstructions([{ code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: 'FFFFFF', cause }]);
    assert.equal(instruction.cause, cause);
    assert.equal(instruction.explanation, explanation);
    assert.equal(instruction.instruction, cause === 'slot_conflict' ? 'Load another PETG #FFFFFF spool for source slot 3; another source slot is using the matching loaded spool.' : 'Load PETG #FFFFFF for source slot 3.');
  }
  const base = { code: 'filament_not_loaded', sourceSlot: 0, material: 'PETG', color: '#ffffff' };
  const legacy = waitingFilamentInstructions([base])[0];
  assert.equal(legacy.color, '#FFFFFF');
  assert.equal(legacy.explanation, null);
  for (const cause of ['future_cause', 'constructor', '__proto__']) {
    const future = waitingFilamentInstructions([{ ...base, cause }])[0];
    assert.equal(future.cause, cause);
    assert.equal(future.instruction, legacy.instruction);
    assert.equal(future.explanation, 'Hive reported another material-waiting condition. Check the API waiting reasons.');
  }
});
test('waiting color normalization rejects CSS and preserves only the returned sparse source identities', () => {
  for (const color of ['red', 'FFFFFF;background:url(x)', '#fff', '#FFFFFF00', '<script>']) {
    const [instruction] = waitingFilamentInstructions([{ sourceSlot: 3, material: 'PETG', color }]);
    assert.equal(instruction.color, null);
    assert.equal(instruction.instruction, 'Load PETG for source slot 3.');
  }
  const reasons = [{ sourceSlot: 3, material: 'PETG', color: 'FFFFFF' }, { sourceSlot: 7, material: 'PETG', color: '#000000' }];
  assert.deepEqual(waitingFilamentInstructions(reasons).map(row => row.source), ['Source slot 3', 'Source slot 7']);
  assert.deepEqual(reasons.map(row => row.color), ['FFFFFF', '#000000']);
  assert.deepEqual(waitingFilamentInstructions([]), []);
});
test('only API-supplied target indices identify a tray; route-change reasons remain actionable', () => {
  const result = waitingFilamentInstructions([{ code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: '#000000', suggestedTargetSlot: { ams_id: 2, slot_id: 1 } }, { code: 'material_route_changed' }]);
  assert.equal(result[0].placement, 'API target: AMS 2, slot 1.');
  assert.equal(result[1].source, 'Material route');
  assert.match(result[1].instruction, /Check the printer material readings/);
});
test('created request reads actual job status and waiting reasons, without treating creation as matched', async () => {
  const events = [];
  const reason = { code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: 'FFFFFF', cause: 'missing_material' };
  const read = await readCreatedJob({ printJobs: { get: async id => { events.push(id); return { id, status: 'pending', printer_id: 'mock-printer', print_options: { filament_route_state: 'waiting', filament_waiting_reasons: [reason] } }; } } }, { status: 'created', job: { id: 42 } });
  assert.deepEqual(events, [42]);
  assert.equal(read.kind, 'available');
  assert.equal(read.job.status, 'pending');
  assert.equal(read.job.filament_route_state, 'waiting');
  assert.deepEqual(read.job.filament_waiting_reasons, [reason]);
});
test('held receipt is not a job; deleted, old SDK and uncertain read stay distinct', async () => {
  assert.deepEqual(await readCreatedJob({}, { status: 'held' }), { kind: 'not_created' });
  assert.deepEqual(await readCreatedJob({}, { status: 'created', job: null }), { kind: 'missing' });
  const receipt = { status: 'created', job: { id: 42 } };
  assert.deepEqual(await readCreatedJob({ printJobs: {} }, receipt), { kind: 'unavailable', code: 'sdk_job_read_unavailable' });
  assert.deepEqual(await readCreatedJob({ printJobs: { get: async () => { throw Object.assign(new Error('private'), { status: 404 }); } } }, receipt), { kind: 'missing' });
  const unavailable = await readCreatedJob({ printJobs: { get: async () => { throw new Error('private'); } } }, receipt);
  assert.equal(unavailable.code, 'job_read_failed'); assert.equal(JSON.stringify(unavailable).includes('private'), false);
});
test('terminal API job statuses stop polling and revoked access requires credential correction', async () => {
  for (const status of ['COMPLETED', 'FAILED', 'ERROR', 'CANCELLED', 'completed']) assert.equal(shouldPollJob({ kind: 'available', job: { status } }), false);
  assert.equal(shouldPollJob({ kind: 'available', job: { status: 'QUEUED' } }), true);
  assert.equal(shouldPollJob({ kind: 'available', job: { status: 'IN_PROGRESS' } }), true);
  const denied = await readCreatedJob({ printJobs: { get: async () => { throw Object.assign(new Error('private'), { status: 403 }); } } }, { status: 'created', job: { id: 42 } });
  assert.equal(denied.code, 'job_read_forbidden'); assert.equal(shouldPollJob(denied), false);
  assert.equal(shouldPollJob({ kind: 'unavailable', code: 'job_read_failed' }), true);
});
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'job-flow-orders-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'project.3mf'); await writeFile(file, 'test bytes');
  return { directory, input: { id: 'policy', file, plates: [2], filaments: [{ sourceSlot: 0, material: 'PETG', color: '#000000' }], printer_id: 'mock-printer', release: 'automatic' } };
}
test('mismatch policy is durable request intent and rejects changed policy on replay', async t => {
  const { directory, input } = await fixture(t), calls = [];
  const orders = createOrders({ printJobs: { create: async value => { calls.push(value); return { requestId: 'request' }; } } }, directory);
  await orders.submit({ ...input, on_filament_mismatch: 'reject' });
  await orders.submit({ ...input, on_filament_mismatch: 'reject' });
  assert.equal(calls.length, 1); assert.equal(calls[0].on_filament_mismatch, 'reject');
  await assert.rejects(orders.submit({ ...input, on_filament_mismatch: 'wait' }), /conflicts/);
  await assert.rejects(orders.submit({ ...input, on_filament_mismatch: 'wrong' }), /Invalid order/);
});
test('updated SDK follows persisted upload through create request and real job snapshot contract', async t => {
  const { directory, input: base } = await fixture(t), events = [];
  const input = { ...base, filaments: ['#000000', '#FFFFFF', '#FF0000', '#0000FF'].map((color, sourceSlot) => ({ sourceSlot, material: 'PETG', color })) };
  const requestId = '00000000-0000-4000-8000-000000000001';
  const reason = { code: 'filament_not_loaded', sourceSlot: 3, material: 'PETG', color: '0000FF', cause: 'missing_material' };
  const created = { requestId, status: 'created', externalId: null, createdAt: '2026-01-01T00:00:00Z', job: { id: 42, status: 'QUEUED', printer_id: '00000000-0000-4000-8000-000000000002', model_file_id: null, print_options: { filament_waiting_reasons: [reason] } }, requiredActions: [], error: null };
  const hive = new PrintHive({ apiKey: 'test-only-contract', baseUrl: 'http://127.0.0.1:1', fetch: async (url, options) => {
    const path = new URL(url).pathname; events.push(`${options.method} ${path}`);
    if (options.method === 'POST') {
      assert(options.body instanceof FormData); assert.equal(options.body.get('plate'), '2'); assert.equal(options.body.get('on_filament_mismatch'), 'wait'); assert.equal(options.body.get('printer_id'), 'mock-printer');
      assert.deepEqual(JSON.parse(options.body.get('filaments')), input.filaments);
      return Response.json({ ...created, status: 'preparing', job: null }, { status: 202 });
    }
    return Response.json(path.endsWith(requestId) ? created : { job: { id: 42, status: 'QUEUED', print_options: { filament_route_state: 'waiting', filament_waiting_reasons: [reason] } } });
  } });
  const orders = createOrders(hive, directory);
  await orders.submit(input); const snapshot = await orders.status(input.id);
  assert.deepEqual(events, ['POST /v1/print-jobs/create', `GET /v1/print-jobs/create-requests/${requestId}`, 'GET /v1/print-jobs/42']);
  assert.equal(snapshot.plates[0].status, 'created'); assert.equal(snapshot.plates[0].jobRead.job.status, 'QUEUED');
  assert.deepEqual(snapshot.plates[0].job.print_options.filament_waiting_reasons, [reason]);
  assert.deepEqual(snapshot.plates[0].jobRead.job.filament_waiting_reasons, [reason]);
});
test('historical omitted wait policy keeps original outbound body and key after lost response', async t => {
  const { directory, input } = await fixture(t), calls = [];
  const orders = createOrders({ printJobs: { create: async value => { calls.push(value); throw new Error('lost'); } } }, directory);
  await assert.rejects(orders.submit(input));
  const path = join(directory, 'policy.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  delete saved.intent.on_filament_mismatch; await writeFile(path, JSON.stringify(saved));
  const replay = createOrders({ printJobs: { create: async value => { calls.push(value); return { requestId: 'request' }; } } }, directory);
  await replay.submit(input);
  assert.equal(calls[1].idempotencyKey, saved.plates[0].idempotencyKey);
  assert.equal('on_filament_mismatch' in calls[1], false);
  await assert.rejects(replay.submit({ ...input, on_filament_mismatch: 'reject' }), /conflicts/);
});
test('mapped placement is pinned before upload and changing a hint cannot silently reuse a saved order', async t => {
  const { directory, input } = await fixture(t), calls = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const projectData = { filename: 'project.3mf', sha256: createHash('sha256').update(await readFile(input.file)).digest('hex'), plates: [{ number: 2, filaments: input.filaments }] };
  const mapped = { ...input, projectData, mappings: [{ sourceSlot: 0, materialId: id, targetSlot: { ams_id: 0, slot_id: 3 } }] };
  const hive = { printJobs: { create: async value => { calls.push(value); if (calls.length === 1) throw new Error('lost response'); return { requestId: 'request' }; } } };
  await assert.rejects(createOrders(hive, directory).submit(mapped), /lost/);
  const restarted = createOrders(hive, directory);
  await restarted.submit(mapped);
  assert.deepEqual(calls[0].filaments, [{ sourceSlot: 0, filamentId: id, targetSlot: { ams_id: 0, slot_id: 3 } }]);
  assert.deepEqual(calls[1].filaments, calls[0].filaments);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  await assert.rejects(restarted.submit({ ...mapped, mappings: [{ ...mapped.mappings[0], targetSlot: { ams_id: 0, slot_id: 2 } }] }), /conflicts/);
  assert.equal(calls.length, 2);
});
test('HTTP reject response preserves 422 and safe API code without leaking upstream details', async t => {
  const { directory, input } = await fixture(t);
  const server = createOrderServer({ directory, hive: { printJobs: { create: async () => { throw Object.assign(new Error('private upstream details'), { status: 422, code: 'filament_mismatch' }); } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const response = await localFetch(`http://127.0.0.1:${server.address().port}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, file: 'cube.3mf', on_filament_mismatch: 'reject' }) });
  assert.equal(response.status, 422); const body = await response.json(); assert.equal(body.code, 'filament_mismatch'); assert.equal(JSON.stringify(body).includes('private'), false);
});
