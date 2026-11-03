import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearch, searchCapabilities } from '../src/search.mjs';
import { createCatalog } from '../src/catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
test('SDK filament search preserves catalog filamentId and upstream pagination, including broadened results', async () => {
  const calls = [];
  const search = createSearch({ filaments: { search: async input => {
    calls.push(input);
    return { filaments: [{ id: 'other-search-id', filamentId: id, name: 'Black PETG', brand: 'Example', material_type: 'PETG', color: '#000000' }], total: 90, hasMore: true, matchMode: 'broadened', originalQuery: 'black PETG' };
  } } });
  const catalog = createCatalog({ baseUrl: 'http://127.0.0.1:1', searchFilaments: search.filaments });
  const page = await catalog.search(new URLSearchParams({ q: 'black PETG', offset: '20' }));
  assert.deepEqual(calls, [{ query: 'black PETG', limit: 20, offset: 20 }]);
  assert.equal(page.materials[0].id, id);
  assert.equal(page.materials[0].materialType, 'PETG');
  assert.equal(page.offset, 20);
  assert.equal(page.hasMore, true);
  assert.equal(page.matchMode, 'broadened');
  assert.equal(page.mode, 'sdk-search');
});
test('SDK printer search passes free text unchanged and returns only public picker fields', async () => {
  let input;
  const search = createSearch({ printers: { search: async value => { input = value; return { printers: [{ type: 'printers', id, name: 'Boo', model: 'P1S', status: 'idle', serial_number: 'private' }], total: 21 }; } } });
  assert.deepEqual(await search.printers(new URLSearchParams({ q: 'Boo P1S', offset: '20' })), { printers: [{ id, name: 'Boo', model: 'P1S', status: 'idle' }], total: 21, offset: 20, hasMore: false });
  assert.deepEqual(input, { query: 'Boo P1S', limit: 20, offset: 20 });
  await assert.rejects(search.printers(new URLSearchParams({ offset: '-1' })), /offset/);
});
test('0.3.2 capability absence is explicit and never fabricates printer results', async () => {
  assert.deepEqual(searchCapabilities({}), { filaments: false, printers: false });
  await assert.rejects(createSearch({}).printers(new URLSearchParams({ q: 'Boo P1S' })), e => e.status === 503 && /SDK search release/.test(e.message));
});
