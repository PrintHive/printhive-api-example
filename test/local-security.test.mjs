import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from "node:http";
import { once } from 'node:events';
import { createOrderServer } from '../src/server.mjs';

test('Host, Origin, fetch metadata, and session guard every local API before SDK calls', async t => {
  const calls = [];
  const server = createOrderServer({ hive: {}, control: () => calls.push('control') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const headers of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(base + '/session', { headers }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  const session = await fetch(base + '/session');
  assert.equal(session.headers.get('access-control-allow-origin'), null);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  const { token } = await session.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  for (const [method, path] of [['GET', '/config'], ['GET', '/orders/x'], ['GET', '/catalog?q=black'], ['POST', '/orders'], ['POST', '/project-data/inspect'], ['POST', '/catalog-sync/upsert'], ['POST', '/orders/x/1/release']]) {
    assert.equal((await fetch(base + path, { method })).status, 403, path);
    assert.equal((await fetch(base + path, { method, headers: { 'x-printhive-session': 'wrong' } })).status, 403, path);
  }
  assert.equal((await fetch(base + '/config', { headers: { 'x-printhive-session': token, origin: base } })).status, 200);
  assert.equal((await fetch(base + '/config', { headers: { 'x-printhive-session': token, origin: 'https://attacker.example' } })).status, 403);
  assert.equal(calls.length, 0);
});
