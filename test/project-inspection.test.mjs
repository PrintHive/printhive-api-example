import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createOrderServer } from '../src/server.mjs';

test('uploading a project extracts actual plates and palette without creating a job', async (t) => {
  let creates = 0;
  const server = createOrderServer({ hive: { printJobs: { create: async () => { creates++; throw new Error('Must not create'); } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const form = new FormData(); form.set('file', new Blob([await readFile('proof/filament-mapping/three-plate.3mf')]), 'three-plate.3mf');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/project-data/inspect`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.plates.map((p) => p.number), [1, 2, 3]);
  assert.equal(data.requiresUsageConfirmation, true);
  assert.ok(data.palette.length > 0);
  assert.equal(creates, 0);
});

import { inspectProject } from '../src/project-inspection.mjs';
test('extracts exact sparse plate IDs and palette indices without treating palette as usage', async () => {
  const result = await inspectProject(await readFile('test/fixtures/project-inspection/valid.3mf'), 'known.3mf');
  assert.deepEqual(result.plates, [{ number: 2 }, { number: 7 }]);
  assert.deepEqual(result.palette.map(({ sourceSlot, material, color }) => ({ sourceSlot, material, color })), [
    { sourceSlot: 0, material: 'PETG-CF', color: '#112233' },
    { sourceSlot: 1, material: 'PETG', color: '#ABCDEF' },
  ]);
  assert.equal(result.usageEvidence, 'palette_only');
  assert.equal(result.requiresUsageConfirmation, true);
  assert.equal('filaments' in result.plates[0], false);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.warnings[0], /does not decode painted material usage/);
});
test('malformed and unsupported archives fail explicitly instead of inventing plate 1', async () => {
  await assert.rejects(inspectProject(Buffer.from('not a ZIP'), 'bad.3mf'), /valid ZIP/);
  await assert.rejects(inspectProject(Buffer.alloc(0), 'empty.3mf'), /nonempty/);
  await assert.rejects(inspectProject(Buffer.alloc(16 * 1024 * 1024 + 1), 'large.3mf'), /16 MiB/);
  for (const name of ['unsafe-path', 'dtd', 'bad-xml', 'bad-json', 'missing-metadata', 'oversized-metadata', 'duplicate-plates', 'no-plates', 'too-many-entries', 'symlink']) {
    await assert.rejects(inspectProject(await readFile(`test/fixtures/project-inspection/${name}.3mf`), `${name}.3mf`), undefined, name);
  }
});
test('extraction endpoint rejects missing files, bad archives and oversize HTTP bodies without SDK calls', async (t) => {
  let creates = 0;
  const server = createOrderServer({ hive: { printJobs: { create: async () => { creates++; } } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}/project-data/inspect`;
  const missing = new FormData(); missing.set('text', 'not a file');
  assert.equal((await fetch(url, { method: 'POST', body: missing })).status, 400);
  const invalid = new FormData(); invalid.set('file', new Blob(['bad ZIP']), 'bad.3mf');
  const failed = await fetch(url, { method: 'POST', body: invalid });
  assert.equal(failed.status, 422);
  assert.match((await failed.json()).error, /valid ZIP/);
  const huge = new FormData(); huge.set('file', new Blob([Buffer.alloc(16 * 1024 * 1024)]), 'large.3mf');
  assert.equal((await fetch(url, { method: 'POST', body: huge })).status, 413);
  assert.equal(creates, 0);
});

test('valid plate choices remain available when palette or colors are missing', async () => {
  for (const name of ['missing-palette', 'missing-colors']) {
    const result = await inspectProject(await readFile(`test/fixtures/project-inspection/${name}.3mf`), `${name}.3mf`);
    assert.deepEqual(result.plates, [{ number: 3 }, { number: 8 }]);
    assert.equal(result.requiresUsageConfirmation, true);
    assert.equal(result.palette.every((f) => !f.selectable), true);
    assert.match(result.warnings.join(' '), /missing or incomplete/);
  }
});
