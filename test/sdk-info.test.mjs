import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sdkInfo } from '../src/sdk-info.mjs';

test('workspace provenance requires the loaded package path, not only a matching version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-origin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = await realpath('node_modules/@printhive/api');
  const { version } = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
  const marker = join(directory, 'marker.json');
  await writeFile(marker, JSON.stringify({ kind: 'local-sdk-workspace', version, workspace: directory }));
  assert.equal(sdkInfo({}, marker).source, 'installed-package');
  await writeFile(marker, JSON.stringify({ kind: 'local-sdk-workspace', version, workspace }));
  const result = sdkInfo({}, marker);
  assert.equal(result.source, 'local-workspace');
  assert.equal(result.version, version);
  assert.equal(JSON.stringify(result).includes(workspace), false);
});
