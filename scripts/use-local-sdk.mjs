import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, join } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv[2];
if (!argument || process.argv.length !== 3) throw new Error('Usage: npm run sdk:local -- /path/to/sdk.tgz-or-built-workspace');
const archive = resolve(argument);
const workspace = (await stat(archive)).isDirectory();
if (!workspace && !argument.endsWith('.tgz')) throw new Error('Supply an SDK .tgz or a built SDK workspace directory');
if (workspace) {
  const manifest = JSON.parse(await readFile(join(archive, 'package.json'), 'utf8'));
  if (manifest.name !== '@printhive/api') throw new Error('Workspace must contain @printhive/api');
  await access(join(archive, 'dist/index.js'));
}
const bytes = await readFile(workspace ? join(archive, 'dist/index.js') : archive);
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--package-lock=false', ...(workspace ? ['--ignore-scripts'] : []), archive], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const { installedSdkVersion } = await import('../src/sdk-info.mjs');
const version = installedSdkVersion();
const { PrintHive } = await import('@printhive/api');
const { hasCatalogSync } = await import('../src/catalog-sync.mjs');
if (!hasCatalogSync(new PrintHive({ apiKey: 'local-sdk-capability-check', baseUrl: 'http://127.0.0.1:1' }))) throw new Error('The installed package does not provide filamentCatalog upsert/list/get; no local SDK marker was written');
await mkdir(join(root, 'data'), { recursive: true, mode: 0o700 });
const digest = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(root, 'data/sdk-local.json'), JSON.stringify(workspace ? { kind: 'local-sdk-workspace', version, workspace: archive, entrySha256: digest } : { kind: 'local-sdk-package', version, archive: basename(archive), sha256: digest }, null, 2)+'\n', { mode: 0o600 });
console.log(`Installed local @printhive/api ${version}${workspace ? ' workspace link' : ''}; registry dependency and lockfile were not changed.`);
