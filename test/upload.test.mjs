import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpload } from '../src/upload.mjs';

test('streaming uploads accept the exact file limit and reject extra bytes, duplicate files, and excess metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bounded-upload-'));
  const server = createServer(async (req, res) => {
    try {
      const upload = await readUpload(req, directory, 32);
      res.end(JSON.stringify({ bytes: (await stat(upload.file)).size, order: upload.order }));
    } catch (error) { res.statusCode = error.status ?? 400; res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  for (const [bytes, duplicate, metadata, status] of [[32, false, '{}', 200], [33, false, '{}', 413], [1, true, '{}', 413], [1, false, 'x'.repeat(65537), 413]]) {
    const form = new FormData(); form.set('file', new Blob([Buffer.alloc(bytes)]), 'sample.3mf'); form.set('order', metadata);
    if (duplicate) form.append('file', new Blob(['extra']), 'extra.3mf');
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: form });
    assert.equal(response.status, status);
    if (status === 200) assert.deepEqual(await response.json(), { bytes: 32, order: '{}' });
  }
});
