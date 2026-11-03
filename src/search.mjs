import { materialIdPattern } from './project-data.mjs';
import { normalizeCatalogFilament, validateCatalogQuery } from './catalog.mjs';

export function searchCapabilities(hive) {
  return { filaments: typeof hive?.filaments?.search === 'function', printers: typeof hive?.printers?.search === 'function' };
}

export function createSearch(hive) {
  return {
    async filaments(search) {
      const { q, offset } = validateCatalogQuery(search);
      const page = await hive.filaments.search({ query: q, limit: 20, offset });
      return {
        materials: page.filaments.map((row) => normalizeCatalogFilament({ ...row, id: row.filamentId })),
        total: page.total, offset, hasMore: page.hasMore && offset + 20 <= 10000,
        mode: 'sdk-search', matchMode: page.matchMode,
      };
    },
    async printers(search) {
      const { q, offset } = validateCatalogQuery(search);
      if (!searchCapabilities(hive).printers) throw Object.assign(new Error('Printer search needs the SDK search release. Enter a printer ID or leave it empty for Smart Queue.'), { status: 503 });
      const page = await hive.printers.search({ query: q, limit: 20, offset });
      return {
        printers: page.printers.map((row) => {
          if (!materialIdPattern.test(row.id)) throw new Error('Invalid printer search response');
          return { id: row.id, name: row.name ?? 'Unnamed printer', model: row.model ?? null, status: row.status ?? null };
        }),
        total: page.total, offset, hasMore: offset + page.printers.length < page.total && offset + 20 <= 10000,
      };
    },
  };
}
