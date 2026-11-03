import test from 'node:test';
import assert from 'node:assert/strict';
import { PrintHive } from '@printhive/api';
import { createCatalog, normalizeSearchFilament } from '../src/catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const globalId = '22222222-2222-4222-8222-222222222222';
const unsyncedId = '33333333-3333-4333-8333-333333333333';
const noColorId = '44444444-4444-4444-8444-444444444444';
const noMaterialId = '55555555-5555-4555-8555-555555555555';
const refusedGlobalId = '66666666-6666-4666-8666-666666666666';
const org = '99999999-9999-4999-8999-999999999999';
// FilamentSearchResult from the installed SDK contract: every listed field is required by its response validator.
const result = { id: 'picker-row-1', filamentId: id, acceptedByCreate: true, name: 'Black PETG', brand: 'Example', material_type: ' PETG-CF ', color: '#112233', diameter: 1.75, category: 'filament', sku: 'PETG-01', organization_id: org };
const page = (filaments, extra = {}) => ({ filaments, total: filaments.length, hasMore: false, matchMode: 'strict', originalQuery: null, ...extra });
function hive(routes, calls = []) {
  return new PrintHive({ apiKey: 'test-only-key', baseUrl: 'http://127.0.0.1:1', maxRetries: 0, fetch: async (url, init) => {
    const target = new URL(url);
    calls.push({ method: init.method, path: target.pathname, search: target.search, key: init.headers.get('x-api-key') });
    const route = routes[target.pathname];
    return route ? route(target, init) : Response.json({ error: 'not_found' }, { status: 404 });
  } });
}
test('filament search uses the SDK picker route with the server key and keeps Hive admission verdicts visible', async () => {
  const calls = [];
  const rows = [result,
    { ...result, id: 'picker-row-2', filamentId: globalId, organization_id: 'global', color: 'black' },
    { ...result, id: 'picker-row-3', filamentId: unsyncedId, acceptedByCreate: false },
    { ...result, id: 'picker-row-4', filamentId: noColorId, acceptedByCreate: false, color: null },
    { ...result, id: 'picker-row-5', filamentId: noMaterialId, acceptedByCreate: false, material_type: '' },
    { ...result, id: 'picker-row-6', filamentId: refusedGlobalId, acceptedByCreate: false, organization_id: 'global' }];
  const catalog = createCatalog(hive({ '/v1/filaments/search': () => Response.json(page(rows, { total: 65, hasMore: true })) }, calls));
  const found = await catalog.search(new URLSearchParams({ q: 'black PETG', offset: '20' }));
  assert.deepEqual(calls, [{ method: 'GET', path: '/v1/filaments/search', search: '?q=black+PETG&limit=20&offset=20', key: 'test-only-key' }]);
  assert.deepEqual({ total: found.total, offset: found.offset, hasMore: found.hasMore, mode: found.mode, matchMode: found.matchMode }, { total: 65, offset: 20, hasMore: true, mode: 'sdk-search', matchMode: 'strict' });
  assert.deepEqual(found.materials.map((m) => [m.id, m.acceptedByCreate, m.selectable]), [[id, true, true], [globalId, true, true], [unsyncedId, false, false], [noColorId, false, false], [noMaterialId, false, false], [refusedGlobalId, false, false]]);
  assert.deepEqual(found.materials[0], { id, name: 'Black PETG', brand: 'Example', sku: 'PETG-01', materialType: 'PETG-CF', color: '#112233', acceptedByCreate: true, selectable: true, unavailableReason: null });
  assert.deepEqual([found.materials[1].color, found.materials[1].unavailableReason], [null, null]);
  assert.match(found.materials[2].unavailableReason, /not a synced organization partner catalog row/);
  assert.match(found.materials[3].unavailableReason, /no usable color/);
  assert.match(found.materials[4].unavailableReason, /no material type/);
  assert.match(found.materials[5].unavailableReason, /global catalog filament.*(ambiguous|settings)/);
  assert.doesNotMatch(found.materials[5].unavailableReason, /only organization-owned|sync it to your catalog/i);
  assert.ok(found.materials.every((m) => m.unavailableReason === null || /does not accept this filament for print-job creation/.test(m.unavailableReason)));
  for (const secret of ['test-only-key', 'organization_id', 'picker-row', org]) assert.equal(JSON.stringify(found).includes(secret), false, secret);
});
test('exact IDs and browse queries go through the same SDK search; no catalog row or materials route is ever requested', async () => {
  const calls = [];
  const catalog = createCatalog(hive({ '/v1/filaments/search': (url) => Response.json(page(url.searchParams.get('q') === id ? [result] : [], { matchMode: url.searchParams.get('q') ? 'strict' : 'broadened', originalQuery: url.searchParams.get('q') })) }, calls));
  const exact = await catalog.search(new URLSearchParams({ q: id }));
  assert.equal(exact.materials[0].id, id);
  assert.equal(exact.hasMore, false);
  const browse = await catalog.search(new URLSearchParams());
  assert.deepEqual(browse.materials, []);
  assert.equal(browse.matchMode, 'broadened');
  assert.deepEqual(calls.map((c) => c.path + c.search), [`/v1/filaments/search?q=${id}&limit=20&offset=0`, '/v1/filaments/search?q=&limit=20&offset=0']);
  for (const query of [new URLSearchParams({ q: 'x'.repeat(101) }), new URLSearchParams({ offset: '-1' }), new URLSearchParams({ offset: '1.2' }), new URLSearchParams({ offset: '10001' })]) await assert.rejects(catalog.search(query), /limited to 100 characters/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.path === '/v1/filaments/search'));
  assert.equal('get' in catalog, false);
});
test('denied, drifted and malformed search responses fail without exposing the key or inventing rows', async () => {
  const calls = [];
  const denied = createCatalog(hive({ '/v1/filaments/search': () => new Response('test-only-key appears in this failure body', { status: 403 }) }, calls));
  await assert.rejects(denied.search(new URLSearchParams({ q: 'black' })), (e) => e.status === 403 && !e.message.includes('test-only-key'));
  const drifted = createCatalog(hive({ '/v1/filaments/search': () => Response.json({ results: [{ id, name: 'Black PETG' }], total: 1 }) }, calls));
  await assert.rejects(drifted.search(new URLSearchParams({ q: 'black' })), /Invalid Print Hive API response/);
  const unkeyed = createCatalog(hive({ '/v1/filaments/search': () => Response.json(page([{ ...result, filamentId: 'picker-row-1' }])) }, calls));
  await assert.rejects(unkeyed.search(new URLSearchParams({ q: 'black' })), /Invalid Hive catalog response/);
  assert.ok(calls.every((c) => c.path === '/v1/filaments/search'));
});
test('normalizer: the search verdict alone decides selection; display fields never override it', () => {
  assert.equal(normalizeSearchFilament(result).selectable, true);
  const named = normalizeSearchFilament({ ...result, color: 'black' });
  assert.deepEqual([named.selectable, named.color, named.unavailableReason], [true, null, null]);
  assert.equal(normalizeSearchFilament({ ...result, color: '#aaBBcc' }).color, '#AABBCC');
  assert.equal(normalizeSearchFilament({ ...result, acceptedByCreate: false }).selectable, false);
  assert.equal(normalizeSearchFilament({ ...result, acceptedByCreate: false }).acceptedByCreate, false);
  assert.match(normalizeSearchFilament({ ...result, acceptedByCreate: false, organization_id: 'global', color: null }).unavailableReason, /no usable color/);
  assert.match(normalizeSearchFilament({ ...result, acceptedByCreate: false, organization_id: 'global', material_type: ' ' }).unavailableReason, /no material type/);
  assert.equal(normalizeSearchFilament({ ...result, name: '' }).name, 'Example PETG-CF');
  assert.equal(normalizeSearchFilament({ ...result, name: '', brand: null }).name, 'PETG-CF');
  for (const invalid of [null, { ...result, filamentId: 'picker-row-1' }, { ...result, acceptedByCreate: 'yes' }, { ...result, filamentId: undefined }]) assert.throws(() => normalizeSearchFilament(invalid), /Invalid Hive catalog response/);
});
