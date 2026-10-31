import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = 'http://127.0.0.1:3077';
const out = 'proof/plate-extraction/';
const fixture = 'proof/filament-mapping/three-plate.3mf';
const cube = 'fixtures/cube.3mf';
const requests = [], errors = [], violations = [], checks = [];
const browser = await chromium.launch({ headless: true });
async function open(viewport, record) {
  const ctx = await browser.newContext({ viewport, ...(record ? { recordVideo: { dir: out, size: viewport } } : {}) });
  await ctx.route('**/*', route => {
    const r = route.request(), u = new URL(r.url());
    requests.push({ method: r.method(), path: u.pathname });
    const allowed = u.origin === base && (['GET', 'HEAD'].includes(r.method()) || r.method() === 'POST' && ['/project-data/inspect', '/orders/preview'].includes(u.pathname));
    if (!allowed) { violations.push(r.method() + ' ' + u.pathname); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.getByText('API destination: https://api.printhiv3d.com · Production', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#plate').value === '1');
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5"/></svg>';
    cursor.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;left:0;top:0'; document.body.append(cursor);
    document.addEventListener('mousemove', e => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; });
  });
  return { ctx, page, record };
}
async function pause(r, ms = 1000) { if (r.record) await r.page.waitForTimeout(ms); }
async function click(r, locator) {
  await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox();
  await r.page.mouse.move(b.x + b.width/2, b.y + b.height/2, { steps: 10 });
  await pause(r, 250); await locator.click(); await pause(r, 700);
}
async function upload(r, file, values) {
  await r.page.locator('#file').setInputFiles(file);
  await r.page.waitForFunction(expected => {
    const select = document.querySelector('#plate');
    return !select.disabled && JSON.stringify(Array.from(select.options, o => o.value)) === JSON.stringify(expected);
  }, values);
  assert.deepEqual(await r.page.locator('#plate option').evaluateAll(es => es.map(e => e.value)), values);
  assert(await r.page.locator('#submit').isDisabled());
  await pause(r);
}
async function confirm(r, slots) {
  assert.equal(await r.page.locator('#source-palette input:checked').count(), 0);
  for (const slot of slots) await click(r, r.page.locator('input[data-palette-slot="' + slot + '"]'));
  await click(r, r.page.locator('#confirm-usage'));
  assert.deepEqual(await r.page.locator('.mapping').evaluateAll(es => es.map(e => Number(e.dataset.sourceSlot))), slots);
}
async function close(r, name) {
  const video = r.page.video(); await r.ctx.close(); if (video) await video.saveAs(out + name);
}
try {
  const r = await open({ width: 1280, height: 1000 }, false);
  await upload(r, fixture, ['1', '2', '3']); checks.push('Selecting a three-plate 3MF automatically uploads and renders plates 1, 2 and 3');
  assert.equal(await r.page.locator('#source-palette input:checked').count(), 0);
  await r.page.locator('#plate').selectOption('3'); await confirm(r, [0, 2]);
  checks.push('Usage is explicitly confirmed with original source slots 0 and 2');
  for (const [slot, sku, name] of [[0, 'PETG1710-BLK', 'Black'], [2, 'PETG1710-WHT', 'White']]) {
    const row = r.page.locator('.mapping[data-source-slot="' + slot + '"]');
    await row.locator('input[type=search]').fill(sku);
    await click(r, row.getByRole('button', { name: 'Search', exact: true }));
    await click(r, row.getByRole('button', { name: 'Use ' + name, exact: true }));
  }
  await click(r, r.page.locator('#preview'));
  await r.page.waitForFunction(() => document.querySelector('#payload').textContent.includes('"filaments"'));
  assert.deepEqual(JSON.parse(await r.page.locator('#payload').textContent()), { plate: 3, filaments: [{ sourceSlot: 0, material: 'PETG', color: '#111112' }, { sourceSlot: 2, material: 'PETG', color: '#E3E2E0' }], release: 'manual' });
  checks.push('Extracted selected plate maps through the real production catalog to the exact supported preview');
  await r.page.locator('#plate').selectOption('2');
  assert.equal(await r.page.locator('#source-palette input:checked').count(), 0); assert(await r.page.locator('#submit').isDisabled());
  await r.page.locator('#plate').selectOption('3'); assert(await r.page.locator('#submit').isEnabled()); checks.push('Confirmations and mappings remain isolated by plate');
  if (process.env.EXAMPLE_PROJECT) {
    await upload(r, process.env.EXAMPLE_PROJECT, ['1']);
    const text = await r.page.locator('#source-palette').textContent();
    assert(text.includes('PETG-CF') && text.includes('#000000') && text.includes('PETG') && text.includes('#FFFFFF'));
    checks.push('The reported project renders plate 1 and its actual two-entry palette');
  }
  await r.page.locator('#file').setInputFiles({ name: 'invalid.3mf', mimeType: 'application/octet-stream', buffer: Buffer.from('not a ZIP') });
  await r.page.waitForFunction(() => document.querySelector('#extraction-error').textContent.length > 0);
  assert(await r.page.locator('#plate').isDisabled()); assert(await r.page.locator('#submit').isDisabled());
  await r.page.screenshot({ path: out + 'invalid-project.png', fullPage: true }); checks.push('Invalid projects show an error and a disabled plate placeholder');
  await upload(r, cube, ['1']); assert.equal(await r.page.locator('#source-palette input').count(), 1); checks.push('Selecting a valid file recovers without stale choices');
  await close(r);
  const d = await open({ width: 1280, height: 1000 }, true);
  await pause(d, 1300); await upload(d, fixture, ['1', '2', '3']);
  await d.page.locator('#plate').scrollIntoViewIfNeeded(); await d.page.locator('#plate').selectOption('3'); await pause(d, 1300);
  await confirm(d, [0, 2]); await d.page.locator('#source-usage').scrollIntoViewIfNeeded(); await pause(d, 1800);
  await d.page.screenshot({ path: out + 'desktop.png' }); await close(d, 'desktop-raw.webm');
  const m = await open({ width: 390, height: 844 }, true);
  await pause(m, 1000); await upload(m, cube, ['1']); await m.page.locator('#source-usage').scrollIntoViewIfNeeded(); await pause(m, 1000);
  await confirm(m, [0]); await pause(m, 1500);
  assert(await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('Mobile upload and confirmation have no horizontal overflow');
  await m.page.screenshot({ path: out + 'mobile.png' }); await close(m, 'mobile-raw.webm');
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  await writeFile(out + 'results.json', JSON.stringify({ base, checks, requests, errors, violations, orderSubmitted: false }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, errors, violations, orderSubmitted: false }, null, 2));
} finally { await browser.close(); }
