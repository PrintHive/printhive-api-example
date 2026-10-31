import { materialIdPattern, normalizeColor } from './project-data.mjs';
export function normalizeCatalogFilament(row) {
  if (!row || typeof row !== 'object' || !materialIdPattern.test(row.id ?? '')) throw new Error('Invalid Hive catalog response');
  const materialType = typeof row.material_type === 'string' ? row.material_type.trim() : '';
  const listedColors = Array.isArray(row.metadata?.colors) ? row.metadata.colors : [];
  const distinct = new Set(listedColors.map(normalizeColor).filter(Boolean));
  const color = normalizeColor(row.color) ?? normalizeColor(row.metadata?.hex_code);
  const ambiguous = distinct.size > 1 || (listedColors.length > 1 && listedColors.some((value) => !normalizeColor(value))) || row.metadata?.gradient === true;
  const unavailableReason = !materialType ? 'This catalog filament has no material type' : ambiguous ? 'This catalog filament has multiple colors; a single-color requirement cannot represent it' : !color ? 'This catalog filament has no unambiguous hex color' : null;
  const text = (name) => typeof row[name] === 'string' ? row[name].slice(0, 500) : null;
  return { id: row.id, name: text('name') ?? 'Unnamed filament', brand: text('brand'), sku: text('sku'), materialType, color, selectable: unavailableReason === null, unavailableReason };
}
export function validateCatalogQuery(search) {
  const q = search.get('q') ?? '';
  const offset = Number(search.get('offset') ?? 0);
  if (q.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Search is limited to 100 characters and offset 0–10000');
  return { q: q.trim(), offset };
}
export function createCatalog({ baseUrl, apiKey, fetchImpl = fetch }) {
  async function read(path) {
    let response;
    try { response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, { headers: { 'x-api-key': apiKey }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Hive catalog is unavailable; retry the search'); }
    if (!response.ok) throw new Error(`Hive catalog returned HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new Error('Invalid Hive catalog response'); }
  }
  async function get(id) {
    if (!materialIdPattern.test(id)) throw new Error('Invalid Hive filament ID');
    const result = await read(`/v1/materials/${encodeURIComponent(id)}`);
    const row = result.material ?? result;
    const normalized = normalizeCatalogFilament(row);
    if (normalized.id.toLowerCase() !== id.toLowerCase()) throw new Error('Hive catalog returned a different filament');
    return normalized;
  }
  return { get, async search(search) {
    const { q, offset } = validateCatalogQuery(search);
    if (materialIdPattern.test(q)) return { materials: [await get(q)], total: 1, offset: 0, hasMore: false };
    const query = new URLSearchParams({ q, limit: '20', offset: String(offset) });
    const result = await read(`/v1/materials?${query}`);
    if (!Array.isArray(result.materials) || !Number.isInteger(result.total) || result.total < 0) throw new Error('Invalid Hive catalog response');
    return { materials: result.materials.map(normalizeCatalogFilament), total: result.total, offset, hasMore: offset + result.materials.length < result.total && offset + 20 <= 10000 };
  } };
}
