import { materialIdPattern } from './project-data.mjs';
import { MAX_SEARCH_OFFSET, SEARCH_LIMIT, createCatalog, validateCatalogQuery } from './catalog.mjs';

export function searchCapabilities(hive) {
  return { filaments: typeof hive?.filaments?.search === 'function', printers: typeof hive?.printers?.search === 'function' };
}

export function createSearch(hive) {
  const catalog = createCatalog(hive);
  return {
    filaments: (search) => catalog.search(search),
    async printers(search) {
      const { q, offset } = validateCatalogQuery(search);
      const page = await hive.printers.search({ query: q, limit: SEARCH_LIMIT, offset });
      return {
        printers: page.printers.map((row) => {
          if (!materialIdPattern.test(row.id)) throw new Error('Invalid printer search response');
          return { id: row.id, name: row.name ?? 'Unnamed printer', model: row.model ?? null, status: row.status ?? null };
        }),
        total: page.total, offset, hasMore: offset + page.printers.length < page.total && offset + SEARCH_LIMIT <= MAX_SEARCH_OFFSET,
      };
    },
  };
}
