import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hasCatalogSync } from './catalog-sync.mjs';
const require = createRequire(import.meta.url);
function installedSdkPackage() {
  let directory = dirname(require.resolve('@printhive/api'));
  for (let step = 0; step < 4; step++) {
    try { const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')); if (manifest.name === '@printhive/api') return { version: manifest.version, directory }; } catch { /* The resolved entry may be below the package root. */ }
    directory = dirname(directory);
  }
  return { version: 'unknown', directory: null };
}
export function installedSdkVersion() { return installedSdkPackage().version; }
const loadedPackage = installedSdkPackage();
export function sdkInfo(hive, markerPath = resolve('data/sdk-local.json')) {
  const version = loadedPackage.version;
  let source = 'installed-package';
  try { const marker = JSON.parse(readFileSync(markerPath, 'utf8')); if (marker.version === version && marker.kind === 'local-sdk-package') source = 'local-package'; if (marker.version === version && marker.kind === 'local-sdk-workspace' && realpathSync(marker.workspace) === loadedPackage.directory) source = 'local-workspace'; } catch { /* A normal registry install has no local build marker. */ }
  return { version, source, capabilities: { filamentCatalog: hasCatalogSync(hive), printJobRead: typeof hive?.printJobs?.get === 'function' } };
}
