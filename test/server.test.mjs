import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createOrderServer, MAX_UPLOAD_BYTES } from '../src/server.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'http-orders-'));
  const calls = [];
  const server = createOrderServer({
    directory,
    baseUrl: 'http://user:private@127.0.0.1:9999/api?secret=private',
    hive: { printJobs: {
      create: async (input) => {
        calls.push({ ...input, bytes: await readFile(input.file) });
        return { requestId: 'request-1' };
      },
      getCreateRequest: async (requestId) => ({ requestId, status: 'held', requiredActions: [{ code: 'manual_release_required' }] }),
    } },
    control: async (requestId, action) => ({ requestId, status: action === 'cancel' ? 'cancelled' : 'created' }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  return { calls, url: `http://127.0.0.1:${server.address().port}`, directory };
}
const input = { id: 'upload', plates: [2], release: 'manual', filaments: [{ sourceSlot: 0, material: 'PETG', color: '#112233' }] };
function upload(order = input, name = 'example.3mf', bytes = 'test model') {
  const form = new FormData();
  form.set('order', JSON.stringify(order));
  form.set('file', new Blob([bytes]), name);
  return { method: 'POST', body: form };
}
test('multipart upload persists source bytes and supports status, release, and cancel', async (t) => {
  const s = await setup(t);
  const response = await fetch(`${s.url}/orders`, upload());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { id: 'upload', requests: [{ plate: 2, requestId: 'request-1' }] });
  assert.equal(s.calls[0].filename, 'example.3mf');
  assert.equal(s.calls[0].bytes.toString(), 'test model');
  assert.equal(s.calls[0].release, 'manual');
  assert.equal((await (await fetch(`${s.url}/orders/upload`)).json()).plates[0].status, 'held');
  for (const [action, status] of [['release', 'created'], ['cancel', 'cancelled']]) {
    const res = await fetch(`${s.url}/orders/upload/2/${action}`, { method: 'POST' });
    assert.equal((await res.json()).status, status);
  }
});
test('JSON bundled fixture and allowlisted page assets work without exposing URL secrets', async (t) => {
  const s = await setup(t);
  const config = await (await fetch(`${s.url}/config`)).json();
  assert.deepEqual({ ...config, sdk: undefined }, { baseUrl: 'http://127.0.0.1:9999/api', production: false, maxUploadBytes: MAX_UPLOAD_BYTES, sdk: undefined });
  assert.equal(typeof config.sdk.version, 'string');
  assert.equal(config.sdk.capabilities.filamentCatalog, false);
  for (const path of ['/', '/app.js', '/style.css']) assert.equal((await fetch(s.url + path)).status, 200);
  assert.equal((await fetch(s.url + '/src/client.mjs')).status, 404);
  assert.equal((await fetch(s.url + '/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, file: 'cube.3mf' }) })).status, 202);
});
test('bad input returns 400 before calling Print Hive', async (t) => {
  const s = await setup(t);
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });
  for (const options of [
    json('{'), json('null'), json(JSON.stringify({ ...input, file: '../README.md' })),
    json(JSON.stringify({ ...input, file: 'cube.3mf', filaments: [null] })),
    upload(input, 'model.txt'), upload(input, 'empty.3mf', ''),
    upload({ ...input, plates: [0] }), upload({ ...input, printer_id: 3 }),
    { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=bad' }, body: 'broken multipart' },
  ]) assert.equal((await fetch(s.url + '/orders', options)).status, 400);
  assert.equal(s.calls.length, 0);
});
test('JSON and multipart request byte limits return 413', async (t) => {
  const s = await setup(t);
  for (const [type, size] of [['application/json', 65537], ['multipart/form-data; boundary=test', MAX_UPLOAD_BYTES + 1]]) {
    const response = await fetch(s.url + '/orders', { method: 'POST', headers: { 'content-type': type }, body: Buffer.alloc(size, 120) });
    assert.equal(response.status, 413);
  }
  assert.equal(s.calls.length, 0);
});
