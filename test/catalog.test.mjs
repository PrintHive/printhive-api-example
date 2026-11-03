import test from 'node:test';
import assert from 'node:assert/strict';
import { PrintHive } from '@printhive/api';
import { createCatalog, normalizeCatalogFilament, normalizeSearchFilament } from '../src/catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const globalId = '22222222-2222-4222-8222-222222222222';
const unsyncedId = '33333333-3333-4333-8333-333333333333';
const noColorId = '44444444-4444-4444-8444-444444444444';
const noMaterialId = '55555555-5555-4555-8555-555555555555';
const org = '99999999-9999-4999-8999-999999999999';
// FilamentSearchResult from the installed SDK contract: every listed field is required by its response validator.
const result = { id: 'picker-row-1', filamentId: id, acceptedByCreate: true, name: 'Black PETG', brand: 'Example', material_type: ' PETG-CF ', color: '#112233', diameter: 1.75, category: 'filament', sku: 'PETG-01', organization_id: org };
// CatalogFilament from hive.filamentCatalog.get, with partner metadata that must stay on the server.
const row = { id, sku: 'PETG-01', organization_id: org, material_type: 'PETG-CF', color: '#112233', brand: 'Example', name: 'Black PETG', metadata: { externalId: 'store-1', colorName: 'Black', replacementFilamentId: null, private: 'not-browser-data' } };
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
    { ...result, id: 'picker-row-2', filamentId: globalId, acceptedByCreate: false, organization_id: 'global' },
    { ...result, id: 'picker-row-3', filamentId: unsyncedId, acceptedByCreate: false },
    { ...result, id: 'picker-row-4', filamentId: noColorId, acceptedByCreate: false, color: null },
    { ...result, id: 'picker-row-5', filamentId: noMaterialId, acceptedByCreate: false, material_type: '' }];
  const catalog = createCatalog(hive({ '/v1/filaments/search': () => Response.json(page(rows, { total: 65, hasMore: true })) }, calls));
  const found = await catalog.search(new URLSearchParams({ q: 'black PETG', offset: '20' }));
  assert.deepEqual(calls, [{ method: 'GET', path: '/v1/filaments/search', search: '?q=black+PETG&limit=20&offset=20', key: 'test-only-key' }]);
  assert.deepEqual({ total: found.total, offset: found.offset, hasMore: found.hasMore, mode: found.mode, matchMode: found.matchMode }, { total: 65, offset: 20, hasMore: true, mode: 'sdk-search', matchMode: 'strict' });
  assert.deepEqual(found.materials.map((m) => [m.id, m.acceptedByCreate, m.selectable]), [[id, true, true], [globalId, false, false], [unsyncedId, false, false], [noColorId, false, false], [noMaterialId, false, false]]);
  assert.equal(found.materials[0].unavailableReason, null);
  assert.match(found.materials[1].unavailableReason, /global catalog filament.*sync it to your catalog/);
  assert.match(found.materials[2].unavailableReason, /not a synced organization partner catalog row/);
  assert.match(found.materials[3].unavailableReason, /six-digit hex color/);
  assert.match(found.materials[4].unavailableReason, /no material type/);
  assert.ok(found.materials.every((m) => m.unavailableReason === null || /does not accept this filament for print-job creation/.test(m.unavailableReason)));
  assert.deepEqual(found.materials[0], { id, name: 'Black PETG', brand: 'Example', sku: 'PETG-01', materialType: 'PETG-CF', color: '#112233', acceptedByCreate: true, selectable: true, unavailableReason: null });
  for (const secret of ['test-only-key', 'organization_id', 'picker-row', org]) assert.equal(JSON.stringify(found).includes(secret), false, secret);
});
test('exact IDs and browse queries go through the same SDK search; no raw materials route is ever requested', async () => {
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
  assert.ok(calls.every((c) => !c.path.startsWith('/v1/materials') && c.path !== '/v1/search'));
});
test('selected IDs are read through the organization-scoped SDK catalog, identity-checked and normalized', async () => {
  const calls = [];
  const catalog = createCatalog(hive({ [`/v1/filament-catalog/${id}`]: () => Response.json(row) }, calls));
  const filament = await catalog.get(id);
  assert.deepEqual(calls, [{ method: 'GET', path: `/v1/filament-catalog/${id}`, search: '', key: 'test-only-key' }]);
  assert.deepEqual(filament, { id, name: 'Black PETG', brand: 'Example', sku: 'PETG-01', materialType: 'PETG-CF', color: '#112233', selectable: true, unavailableReason: null });
  for (const secret of ['not-browser-data', 'store-1', 'organization_id', 'test-only-key']) assert.equal(JSON.stringify(filament).includes(secret), false, secret);
  await assert.rejects(catalog.get('not-a-uuid'), /Invalid Hive filament ID/);
  await assert.rejects(catalog.get('SKU-123'), /Invalid Hive filament ID/);
  assert.equal(calls.length, 1);
});
test('foreign, renamed, incomplete and failed catalog reads never become requirements or expose upstream bodies', async () => {
  const other = '66666666-6666-4666-8666-666666666666';
  const calls = [];
  const catalog = createCatalog(hive({
    [`/v1/filament-catalog/${globalId}`]: () => Response.json({ error: 'catalog_filament_not_found' }, { status: 404 }),
    [`/v1/filament-catalog/${other}`]: () => Response.json({ ...row, id }),
    [`/v1/filament-catalog/${noColorId}`]: () => Response.json({ ...row, id: noColorId, color: 'black' }),
    [`/v1/filament-catalog/${noMaterialId}`]: () => Response.json({ ...row, id: noMaterialId, material_type: '  ' }),
    [`/v1/filament-catalog/${unsyncedId}`]: () => Response.json({ material: { ...row, id: unsyncedId } }),
    [`/v1/filament-catalog/${id}`]: () => new Response('test-only-key appears in this failure body', { status: 403 }),
  }, calls));
  await assert.rejects(catalog.get(globalId), (e) => e.status === 404 && e.code === 'catalog_filament_not_found' && !e.message.includes('catalog_filament'));
  await assert.rejects(catalog.get(other), /different filament/);
  assert.equal((await catalog.get(noColorId)).selectable, false);
  assert.match((await catalog.get(noColorId)).unavailableReason, /six-digit hex color/);
  assert.match((await catalog.get(noMaterialId)).unavailableReason, /no material type/);
  await assert.rejects(catalog.get(unsyncedId), /Invalid Hive catalog response/);
  await assert.rejects(catalog.get(id), (e) => e.status === 403 && !e.message.includes('test-only-key'));
  await assert.rejects(createCatalog(hive({ [`/v1/filament-catalog/${id}`]: () => { throw new Error('test-only-key'); } })).get(id), (e) => !e.message.includes('test-only-key'));
  assert.ok(calls.every((c) => c.path.startsWith('/v1/filament-catalog/')));
});
test('normalizers: the search verdict is authoritative; catalog rows need a material type and one hex color', () => {
  assert.equal(normalizeSearchFilament(result).selectable, true);
  assert.equal(normalizeSearchFilament({ ...result, acceptedByCreate: false }).selectable, false);
  assert.equal(normalizeSearchFilament({ ...result, acceptedByCreate: false }).acceptedByCreate, false);
  assert.match(normalizeSearchFilament({ ...result, acceptedByCreate: true, color: null }).unavailableReason, /accepted this filament, but/);
  assert.equal(normalizeSearchFilament({ ...result, acceptedByCreate: false, organization_id: 'global', color: null }).unavailableReason.includes('global catalog'), true);
  for (const invalid of [null, { ...result, filamentId: 'picker-row-1' }, { ...result, acceptedByCreate: 'yes' }, { ...result, filamentId: undefined }]) assert.throws(() => normalizeSearchFilament(invalid), /Invalid Hive catalog response/);
  assert.equal(normalizeCatalogFilament(row).selectable, true);
  assert.equal(normalizeCatalogFilament({ ...row, color: 'black' }).selectable, false);
  assert.equal(normalizeCatalogFilament({ ...row, material_type: '' }).selectable, false);
  assert.equal(normalizeCatalogFilament({ ...row, color: '#aaBBcc' }).color, '#AABBCC');
  const { name, ...unnamed } = row;
  assert.equal(normalizeCatalogFilament(unnamed).name, 'Example PETG-CF Black');
  assert.equal(normalizeCatalogFilament({ ...unnamed, brand: null, metadata: {} }).name, 'PETG-CF');
  assert.throws(() => normalizeCatalogFilament({ ...row, id: 'SKU-123' }), /Invalid Hive catalog response/);
});
