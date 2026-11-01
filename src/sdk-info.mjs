import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hasCatalogSync } from './catalog-sync.mjs';
const require = createRequire(import.meta.url);
export function installedSdkVersion() {
  let directory = dirname(require.resolve('@printhive/api'));
  for (let step = 0; step < 4; step++) {
    try { const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')); if (manifest.name === '@printhive/api') return manifest.version; } catch { /* The resolved entry may be below the package root. */ }
    directory = dirname(directory);
  }
  return 'unknown';
}
const loadedPackageVersion = installedSdkVersion();
export function sdkInfo(hive, markerPath = resolve('data/sdk-local.json')) {
  const version = loadedPackageVersion;
  let source = 'installed-package';
  try { const marker = JSON.parse(readFileSync(markerPath, 'utf8')); if (marker.version === version && marker.kind === 'local-sdk-package') source = 'local-package'; } catch { /* A normal registry install has no local build marker. */ }
  return { version, source, capabilities: { filamentCatalog: hasCatalogSync(hive), printJobRead: typeof hive?.printJobs?.get === 'function' } };
}
