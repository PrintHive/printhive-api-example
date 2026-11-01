import { materialIdPattern } from './project-data.mjs';

export class CatalogSyncInputError extends Error {}
export class CatalogSyncUnavailableError extends Error {}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowed = new Set(['externalId', 'brand', 'material', 'colorName', 'sku', 'colorHex', 'hex', 'replacementFilamentId']);
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new CatalogSyncInputError(`${name} must be a nonempty string of at most ${max} characters`);
  return value.trim();
}
function color(value, name) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new CatalogSyncInputError(`${name} must be a six-digit hex color beginning with #`);
  return value.toUpperCase();
}
export function validateCatalogBatch(input) {
  if (object(input) && (Object.keys(input).length !== 1 || !('records' in input))) throw new CatalogSyncInputError('Supply a records array, not a HAR or login payload');
  const records = Array.isArray(input) ? input : input?.records;
  if (!Array.isArray(records) || !records.length || records.length > 20) throw new CatalogSyncInputError('Import between 1 and 20 filament catalog records');
  const ids = new Set();
  return records.map((record) => {
    if (!object(record) || Object.keys(record).some((key) => !allowed.has(key))) throw new CatalogSyncInputError('Catalog records contain unsupported fields');
    const externalId = text(record.externalId, 'externalId', 200);
    if (ids.has(externalId)) throw new CatalogSyncInputError('Each trimmed externalId must appear only once in a batch');
    ids.add(externalId);
    const primary = record.colorHex === undefined ? undefined : color(record.colorHex, 'colorHex');
    const alias = record.hex === undefined ? undefined : color(record.hex, 'hex');
    if (!primary && !alias) throw new CatalogSyncInputError('Each record needs colorHex or hex');
    if (primary && alias && primary !== alias) throw new CatalogSyncInputError('colorHex and hex must describe the same color');
    if (record.replacementFilamentId !== undefined && record.replacementFilamentId !== null && (typeof record.replacementFilamentId !== 'string' || record.replacementFilamentId.length > 200)) throw new CatalogSyncInputError('replacementFilamentId must be a string of at most 200 characters or null');
    return {
      externalId, brand: text(record.brand, 'brand', 100), material: text(record.material, 'material', 100),
      colorName: text(record.colorName, 'colorName', 100), sku: text(record.sku, 'sku', 200), colorHex: primary ?? alias,
      ...(record.replacementFilamentId === undefined ? {} : { replacementFilamentId: record.replacementFilamentId }),
    };
  });
}
export function hasCatalogSync(hive) {
  return ['upsert', 'list', 'get'].every((method) => typeof hive?.filamentCatalog?.[method] === 'function');
}
export function catalogSyncError(error) {
  if (error instanceof CatalogSyncInputError) return { status: 400, error: error.message };
  if (error instanceof CatalogSyncUnavailableError) return { status: 503, error: 'Catalog sync is unavailable in the installed SDK' };
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
  return { status, error: status === 502 ? 'Hive catalog sync could not be confirmed. Read current state before retrying.' : `Hive filament catalog returned HTTP ${status}` };
}
function syncedFilamentFields(row) {
  if (!object(row) || !materialIdPattern.test(row.id ?? '') || !object(row.metadata)) throw new Error('Invalid catalog response');
  const externalId = text(row.metadata.externalId, 'externalId', 200);
  const colorHex = color(row.color, 'color');
  const replacement = row.metadata.replacementFilamentId;
  if (replacement !== null && replacement !== undefined && (typeof replacement !== 'string' || replacement.length > 200)) throw new Error('Invalid catalog response');
  return {
    id: row.id, externalId, sku: text(row.sku, 'sku', 200), material: text(row.material_type, 'material', 100), colorHex,
    colorName: text(row.metadata.colorName, 'colorName', 100),
    brand: typeof row.brand === 'string' ? row.brand.slice(0, 100) : null,
    name: typeof row.name === 'string' ? row.name.slice(0, 500) : externalId,
    replacementFilamentId: replacement ?? null,
  };
}
export function normalizeSyncedFilament(row) {
  try { return syncedFilamentFields(row); }
  catch { throw new Error('Invalid Hive catalog response'); }
}
export function createCatalogSync(hive) {
  function sdk() { if (!hasCatalogSync(hive)) throw new CatalogSyncUnavailableError(); return hive.filamentCatalog; }
  return {
    preview(input) { return { records: validateCatalogBatch(input), available: hasCatalogSync(hive) }; },
    async upsert(input) {
      const records = validateCatalogBatch(input);
      const client = sdk();
      const outcomes = [];
      for (const record of records) {
        try {
          const filament = normalizeSyncedFilament(await client.upsert(record));
          if (filament.externalId !== record.externalId) throw new Error('Catalog binding changed');
          outcomes.push({ externalId: record.externalId, status: 'synced', filament });
        } catch (error) {
          const failure = catalogSyncError(error);
          outcomes.push({ externalId: record.externalId, status: 'failed', error: failure.error, upstreamStatus: failure.status });
        }
      }
      return { outcomes, synced: outcomes.filter((item) => item.status === 'synced').length, failed: outcomes.filter((item) => item.status === 'failed').length };
    },
    async list(search) {
      if ([...search.keys()].some((key) => !['externalId', 'sku', 'limit', 'offset'].includes(key))) throw new CatalogSyncInputError('Unsupported catalog list filter');
      const limit = Number(search.get('limit') ?? 20); const offset = Number(search.get('offset') ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new CatalogSyncInputError('Catalog list requires limit 1–200 and offset 0–10000');
      const query = { limit, offset };
      for (const key of ['externalId', 'sku']) if (search.has(key)) query[key] = text(search.get(key), key, 200);
      const result = await sdk().list(query);
      if (!Array.isArray(result?.materials) || !Number.isInteger(result.total) || result.total < 0 || result.materials.length > limit) throw new Error('Invalid catalog response');
      return { materials: result.materials.map(normalizeSyncedFilament), total: result.total, offset, hasMore: offset + result.materials.length < result.total && offset + limit <= 10000 };
    },
    async get(id) {
      if (!materialIdPattern.test(id)) throw new CatalogSyncInputError('Use a Hive filament UUID');
      const row = normalizeSyncedFilament(await sdk().get(id));
      if (row.id.toLowerCase() !== id.toLowerCase()) throw new Error('Catalog binding changed');
      return row;
    },
  };
}
