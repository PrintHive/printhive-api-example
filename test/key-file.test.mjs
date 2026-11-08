import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { clientFromEnv } from '../src/client.mjs';

test('server prefers a trimmed key file, falls back to env only when no file was configured, and fails closed', async t => {
  const env = { ...process.env };
  const dir = await mkdtemp(join(tmpdir(), 'sample-key-'));
  const keys = [];
  const server = createServer((req, res) => {
    keys.push(req.headers['x-api-key']);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ printers: [], total: 0, query: '' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { process.env = env; server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });
  process.env.PRINTHIVE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.PRINTHIVE_API_KEY = 'fake-env-key';
  process.env.PRINTHIVE_API_KEY_FILE = join(dir, 'fake.key');
  await writeFile(process.env.PRINTHIVE_API_KEY_FILE, 'fake-file-key\n', { mode: 0o600 });
  await clientFromEnv().hive.printers.search({ query: '' });
  delete process.env.PRINTHIVE_API_KEY_FILE;
  await clientFromEnv().hive.printers.search({ query: '' });
  assert.deepEqual(keys, ['fake-file-key', 'fake-env-key']);
  process.env.PRINTHIVE_API_KEY_FILE = join(dir, 'absent.key');
  assert.throws(clientFromEnv, /Cannot read PRINTHIVE_API_KEY_FILE/);
  await writeFile(process.env.PRINTHIVE_API_KEY_FILE, '\n');
  assert.throws(clientFromEnv, /Set PRINTHIVE_API_KEY_FILE/);
});
