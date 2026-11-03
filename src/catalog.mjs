import { materialIdPattern, normalizeColor } from './project-data.mjs';

export const SEARCH_LIMIT = 20;
export const MAX_SEARCH_OFFSET = 10000;
const text = (value, max = 500) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const refused = 'Hive does not accept this filament for print-job creation';

// acceptedByCreate is the admission check creation itself runs, for organization and enabled
// global rows alike. The material type and color beside it are for recognition only: creation
// sends the catalog ID, and Hive derives both from its own row.
function unavailableReason(row, materialType) {
  if (row.acceptedByCreate) return null;
  if (!materialType) return `${refused}: it has no material type.`;
  if (!text(row.color)) return `${refused}: it has no usable color.`;
  if (row.organization_id === 'global') return `${refused}: this global catalog filament failed Hive's admission check. Its color may be ambiguous, or your organization's material settings may exclude it.`;
  return `${refused}: it is not a synced organization partner catalog row, or its color is ambiguous. Sync it with an external ID first.`;
}

export function normalizeSearchFilament(row) {
  if (!row || typeof row !== 'object' || !materialIdPattern.test(row.filamentId ?? '') || typeof row.acceptedByCreate !== 'boolean') throw new Error('Invalid Hive catalog response');
  const brand = text(row.brand);
  const materialType = typeof row.material_type === 'string' ? row.material_type.trim() : '';
  const reason = unavailableReason(row, materialType);
  return {
    id: row.filamentId,
    name: text(row.name) ?? text([brand, materialType].filter(Boolean).join(' ')) ?? 'Unnamed filament',
    brand,
    sku: text(row.sku),
    materialType,
    color: normalizeColor(row.color),
    acceptedByCreate: row.acceptedByCreate,
    selectable: reason === null,
    unavailableReason: reason,
  };
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
  };
}
