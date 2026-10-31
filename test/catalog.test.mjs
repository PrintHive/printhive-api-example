import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, normalizeCatalogFilament } from '../src/catalog.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const row = { id, name: 'Black', brand: 'Example', sku: 'PETG-01', material_type: ' PETG-CF ', color: '#112233', organization_id: 'private', metadata: { colors: ['#112233'] } };
test('catalog search encodes query and paging; exact IDs use the item endpoint', async () => {
  const calls = [];
  const catalog = createCatalog({ baseUrl: 'https://api.example', apiKey: 'private-key', fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(url.includes('/materials?') ? { materials: [row], total: 65 } : row); } });
  const found = await catalog.search(new URLSearchParams({ q: 'PETG & black', offset: '20' }));
  assert.equal(calls[0].url, 'https://api.example/v1/materials?q=PETG+%26+black&limit=20&offset=20');
  assert.equal(calls[0].options.headers['x-api-key'], 'private-key');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(found.hasMore, true);
  assert.equal(found.materials[0].materialType, 'PETG-CF');
  assert.equal(JSON.stringify(found).includes('private-key'), false);
  assert.equal(JSON.stringify(found).includes('organization_id'), false);
  const exact = await catalog.search(new URLSearchParams({ q: id }));
  assert.equal(calls[1].url, `https://api.example/v1/materials/${id}`);
  assert.equal(exact.materials[0].id, id);
  assert.equal(exact.hasMore, false);
  for (const query of [new URLSearchParams({ q: 'x'.repeat(101) }), new URLSearchParams({ offset: '-1' }), new URLSearchParams({ offset: '1.2' })]) await assert.rejects(catalog.search(query));
  assert.equal(calls.length, 2);
});
test('missing and multi-color catalog entries cannot become a guessed requirement', () => {
  assert.equal(normalizeCatalogFilament(row).selectable, true);
  assert.equal(normalizeCatalogFilament({ ...row, color: 'black', metadata: {} }).selectable, false);
  assert.equal(normalizeCatalogFilament({ ...row, material_type: '' }).selectable, false);
  assert.equal(normalizeCatalogFilament({ ...row, metadata: { colors: ['#112233', '#FFFFFF'] } }).selectable, false);
  assert.equal(normalizeCatalogFilament({ ...row, color: 'blue', metadata: { hex_code: '#aaBBcc' } }).color, '#AABBCC');
});
test('upstream failures never include the key or raw response body', async () => {
  const catalog = createCatalog({ baseUrl: 'https://api.example', apiKey: 'private-key', fetchImpl: async () => new Response('private-key in failure body', { status: 403 }) });
  await assert.rejects(catalog.get(id), (e) => e.message === 'Hive catalog returned HTTP 403');
  await assert.rejects(createCatalog({ baseUrl: 'https://api.example', apiKey: 'private-key', fetchImpl: async () => { throw new Error('private-key'); } }).get(id), (e) => !e.message.includes('private-key'));
  await assert.rejects(createCatalog({ baseUrl: 'https://api.example', apiKey: 'private-key', fetchImpl: async () => Response.json({ ...row, id: '22222222-2222-4222-8222-222222222222' }) }).get(id), /different filament/);
});
