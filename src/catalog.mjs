import { materialIdPattern, normalizeColor } from './project-data.mjs';

export const SEARCH_LIMIT = 20;
export const MAX_SEARCH_OFFSET = 10000;
const text = (value, max = 500) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const refused = 'Hive does not accept this filament for print-job creation';

function publicFields(row, id) {
  if (!row || typeof row !== 'object' || !materialIdPattern.test(id ?? '')) throw new Error('Invalid Hive catalog response');
  const brand = text(row.brand);
  const materialType = typeof row.material_type === 'string' ? row.material_type.trim() : '';
  const name = text(row.name) ?? text([brand, materialType, text(row.metadata?.colorName)].filter(Boolean).join(' ')) ?? 'Unnamed filament';
  return { id, name, brand, sku: text(row.sku), materialType, color: normalizeColor(row.color) };
}

export function normalizeSearchFilament(row) {
  const filament = publicFields(row, row?.filamentId);
  if (typeof row.acceptedByCreate !== 'boolean') throw new Error('Invalid Hive catalog response');
  const unavailableReason = row.acceptedByCreate
    ? (filament.materialType && filament.color ? null : 'Hive accepted this filament, but the search result has no material type or six-digit hex color to record')
    : row.organization_id === 'global' ? `${refused}: it is a global catalog filament. Only organization-owned partner catalog rows are accepted; sync it to your catalog first.`
      : !filament.materialType ? `${refused}: it has no material type.`
        : !filament.color ? `${refused}: it has no six-digit hex color.`
          : `${refused}: it is not a synced organization partner catalog row. Sync it with an external ID first.`;
  return { ...filament, acceptedByCreate: row.acceptedByCreate, selectable: unavailableReason === null, unavailableReason };
}

export function normalizeCatalogFilament(row) {
  const filament = publicFields(row, row?.id);
  const unavailableReason = !filament.materialType ? 'This catalog filament has no material type' : !filament.color ? 'This catalog filament has no six-digit hex color' : null;
  return { ...filament, selectable: unavailableReason === null, unavailableReason };
}

export function validateCatalogQuery(search) {
  const q = search.get('q') ?? '';
  const offset = Number(search.get('offset') ?? 0);
  if (q.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > MAX_SEARCH_OFFSET) throw new Error('Search is limited to 100 characters and offset 0–10000');
  return { q: q.trim(), offset };
}

export function createCatalog(hive) {
  return {
    async search(search) {
      const { q, offset } = validateCatalogQuery(search);
      const page = await hive.filaments.search({ query: q, limit: SEARCH_LIMIT, offset });
      return { materials: page.filaments.map(normalizeSearchFilament), total: page.total, offset, hasMore: page.hasMore && offset + SEARCH_LIMIT <= MAX_SEARCH_OFFSET, mode: 'sdk-search', matchMode: page.matchMode };
    },
    async get(id) {
      if (!materialIdPattern.test(id)) throw new Error('Invalid Hive filament ID');
      const filament = normalizeCatalogFilament(await hive.filamentCatalog.get(id));
      if (filament.id.toLowerCase() !== id.toLowerCase()) throw new Error('Hive catalog returned a different filament');
      return filament;
    },
  };
}
