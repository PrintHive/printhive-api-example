import { localFetch } from "./local-fetch.mjs";
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
  const response = await localFetch(`http://127.0.0.1:${server.address().port}/project-data/inspect`, { method: 'POST', body: form });
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
  assert.deepEqual(result.plates.map((p) => p.number), [2, 7]);
  assert.equal(result.plates.every((p) => p.usage.kind === 'unknown'), true);
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
  await assert.rejects(inspectProject(Buffer.alloc(150 * 1024 * 1024 + 1), 'large.3mf'), /150 MiB/);
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
  assert.equal((await localFetch(url, { method: 'POST', body: missing })).status, 400);
  const invalid = new FormData(); invalid.set('file', new Blob(['bad ZIP']), 'bad.3mf');
  const failed = await localFetch(url, { method: 'POST', body: invalid });
  assert.equal(failed.status, 422);
  assert.match((await failed.json()).error, /valid ZIP/);
  const huge = new FormData(); huge.set('file', new Blob([Buffer.alloc(150 * 1024 * 1024 + 1)]), 'large.3mf');
  assert.equal((await localFetch(url, { method: 'POST', body: huge })).status, 413);
  assert.equal(creates, 0);
});

test('valid plate choices remain available when palette or colors are missing', async () => {
  for (const name of ['missing-palette', 'missing-colors']) {
    const result = await inspectProject(await readFile(`test/fixtures/project-inspection/${name}.3mf`), `${name}.3mf`);
    assert.deepEqual(result.plates.map((p) => p.number), [3, 8]);
    assert.equal(result.requiresUsageConfirmation, true);
    assert.equal(result.palette.every((f) => !f.selectable), true);
    assert.match(result.warnings.join(' '), /missing or incomplete/);
  }
});

test('per-plate JSON hints preserve zero-based indices and distinct same-color filaments', async () => {
  const d = await inspectProject(await readFile('test/fixtures/project-inspection/plate-usage-json.3mf'), 'plates.3mf');
  assert.deepEqual(d.plates.map((p) => p.usage), [
    { kind: 'detected', sourceSlots: [1, 4, 7], evidence: 'plate_json' },
    { kind: 'detected', sourceSlots: [0, 3], evidence: 'plate_json' },
  ]);
  assert.equal(d.palette[0].color, d.palette[3].color);
  assert.equal(d.palette.length, 8);
  assert.equal(d.requiresUsageConfirmation, true);
  assert.equal(d.usageEvidence, 'saved_slice_metadata');
});
test('saved slice XML uses one-based plate and filament IDs without remapping by color', async () => {
  const d = await inspectProject(await readFile('test/fixtures/project-inspection/plate-usage-slice.3mf'), 'plates.3mf');
  assert.deepEqual(d.plates.map((p) => ({ number: p.number, usage: p.usage })), [
    { number: 2, usage: { kind: 'detected', sourceSlots: [1, 7], evidence: 'slice_info' } },
    { number: 7, usage: { kind: 'detected', sourceSlots: [0, 3], evidence: 'slice_info' } },
  ]);
  const agree = await inspectProject(await readFile('test/fixtures/project-inspection/plate-usage-agree.3mf'), 'agree.3mf');
  assert.deepEqual(agree.plates[0].usage, { kind: 'detected', sourceSlots: [1, 7], evidence: 'plate_json_and_slice_info' });
});
test('empty, malformed, conflicting, mixed or out-of-range usage falls back to unresolved full palette', async () => {
  for (const name of ['empty', 'out-of-range', 'invalid', 'duplicate', 'conflict', 'stale-color', 'stale-material', 'mixed', 'bad-index']) {
    const d = await inspectProject(await readFile(`test/fixtures/project-inspection/plate-usage-${name}.3mf`), `${name}.3mf`);
    assert.equal(d.plates[0].usage.kind, 'unknown', name);
    assert.equal(d.palette.length, 8, name);
    assert.equal(d.requiresUsageConfirmation, true, name);
    assert.equal(d.plates[0].number, 2, name);
  }
});
test('combined optional metadata inflation stays bounded across plate files', async () => {
  await assert.rejects(inspectProject(await readFile('test/fixtures/project-inspection/metadata-total-limit.3mf'), 'too-much.3mf'), /invalid or exceeds its size limit/);
});

test('malformed optional saved metadata does not hide valid project plate choices', async () => {
  for (const kind of ['invalid-utf8', 'invalid-xml']) {
    const d = await inspectProject(await readFile(`test/fixtures/project-inspection/plate-usage-${kind}.3mf`), `${kind}.3mf`);
    assert.equal(d.plates[0].number, 2);
    assert.equal(d.plates[0].usage.kind, 'unknown');
    assert.equal(d.palette.length, 1);
  }
});

test('saved slice hints omit zero-use rows and require finite positive usage evidence', async () => {
  const d = await inspectProject(await readFile('test/fixtures/project-inspection/plate-usage-zero-weight.3mf'), 'weights.3mf');
  assert.deepEqual(d.plates[0].usage, { kind: 'detected', sourceSlots: [3], evidence: 'slice_info' });
  for (const kind of ['all-zero', 'negative-weight', 'nonfinite-weight', 'missing-weight']) {
    const result = await inspectProject(await readFile(`test/fixtures/project-inspection/plate-usage-${kind}.3mf`), `${kind}.3mf`);
    assert.equal(result.plates[0].usage.kind, 'unknown', kind);
    assert.equal(result.palette.length, 4, kind);
  }
});
