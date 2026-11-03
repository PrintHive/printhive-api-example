import test from 'node:test';
import assert from 'node:assert/strict';
import { PrintHive } from '@printhive/api';
import { createSearch, searchCapabilities } from '../src/search.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const printerId = '22222222-2222-4222-8222-222222222222';
const filament = { id: 'picker-row-9', filamentId: id, acceptedByCreate: true, name: 'Red PETG', brand: 'Bambu', material_type: 'PETG', color: '#B44235', diameter: 1.75, category: 'filament', sku: null, organization_id: '99999999-9999-4999-8999-999999999999' };
const printer = { id: printerId, name: 'Boo', model: 'P1S', serial_number: 'private-serial', status: 'idle', location_text: 'private bench', score: 0.91, match: 'text' };
function hive(routes, calls = []) {
  return new PrintHive({ apiKey: 'test-only-key', baseUrl: 'http://127.0.0.1:1', maxRetries: 0, fetch: async (url, init) => {
    const target = new URL(url);
    calls.push({ method: init.method, path: target.pathname, search: target.search, key: init.headers.get('x-api-key') });
    const route = routes[target.pathname];
    return route ? route(target, init) : Response.json({ error: 'not_found' }, { status: 404 });
  } });
}
test('filament search sends free text to /v1/filaments/search and keeps catalog filamentId, paging and match mode', async () => {
  const calls = [];
  const search = createSearch(hive({ '/v1/filaments/search': () => Response.json({ filaments: [filament, { ...filament, id: 'picker-row-10', filamentId: '33333333-3333-4333-8333-333333333333', acceptedByCreate: false, organization_id: 'global' }], total: 90, hasMore: true, matchMode: 'broadened', originalQuery: 'bambu red' }) }, calls));
  const page = await search.filaments(new URLSearchParams({ q: 'bambu red', offset: '20' }));
  assert.deepEqual(calls, [{ method: 'GET', path: '/v1/filaments/search', search: '?q=bambu+red&limit=20&offset=20', key: 'test-only-key' }]);
  assert.deepEqual(page.materials.map((m) => [m.id, m.selectable]), [[id, true], ['33333333-3333-4333-8333-333333333333', false]]);
  assert.equal(page.materials[0].materialType, 'PETG');
  assert.equal(page.materials[0].sku, null);
  assert.deepEqual({ offset: page.offset, hasMore: page.hasMore, total: page.total, matchMode: page.matchMode, mode: page.mode }, { offset: 20, hasMore: true, total: 90, matchMode: 'broadened', mode: 'sdk-search' });
});
test('printer search sends free text to /v1/printers/search and returns only public picker fields', async () => {
  const calls = [];
  const search = createSearch(hive({ '/v1/printers/search': (url) => Response.json({ printers: [printer], total: 21, query: url.searchParams.get('q') }) }, calls));
  const first = await search.printers(new URLSearchParams({ q: 'Boo P1S' }));
  assert.deepEqual(first, { printers: [{ id: printerId, name: 'Boo', model: 'P1S', status: 'idle' }], total: 21, offset: 0, hasMore: true });
  assert.deepEqual(await search.printers(new URLSearchParams({ q: 'Boo P1S', offset: '20' })), { printers: [{ id: printerId, name: 'Boo', model: 'P1S', status: 'idle' }], total: 21, offset: 20, hasMore: false });
  assert.deepEqual(calls.map((c) => c.path + c.search), ['/v1/printers/search?q=Boo+P1S&limit=20&offset=0', '/v1/printers/search?q=Boo+P1S&limit=20&offset=20']);
  assert.ok(calls.every((c) => c.key === 'test-only-key' && c.path !== '/v1/search'));
  for (const secret of ['private-serial', 'private bench', 'score']) assert.equal(JSON.stringify(first).includes(secret), false, secret);
  await assert.rejects(search.printers(new URLSearchParams({ q: 'Boo P1S', offset: '-1' })), /offset/);
  assert.equal(calls.length, 2);
});
test('the installed SDK provides both search methods; upstream shape drift fails instead of inventing results', async () => {
  assert.deepEqual(searchCapabilities(hive({})), { filaments: true, printers: true });
  assert.deepEqual(searchCapabilities({}), { filaments: false, printers: false });
  const legacyShape = createSearch(hive({ '/v1/printers/search': () => Response.json({ results: [{ type: 'printers', id: printerId, name: 'Boo' }], total: 1, query: 'Boo P1S', processingTimeMs: 1 }) }));
  await assert.rejects(legacyShape.printers(new URLSearchParams({ q: 'Boo P1S' })), /Invalid Print Hive API response/);
  const badId = createSearch(hive({ '/v1/printers/search': () => Response.json({ printers: [{ ...printer, id: 'printer-7' }], total: 1, query: 'Boo P1S' }) }));
  await assert.rejects(badId.printers(new URLSearchParams({ q: 'Boo P1S' })), /Invalid printer search response/);
  const denied = createSearch(hive({ '/v1/filaments/search': () => new Response('test-only-key in body', { status: 403 }) }));
  await assert.rejects(denied.filaments(new URLSearchParams({ q: 'black PETG' })), (e) => e.status === 403 && !e.message.includes('test-only-key'));
});
