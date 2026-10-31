import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOrderServer } from '../../src/server.mjs';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const productionExample = 'http://127.0.0.1:3077';
const out = 'proof/plate-colors/';
await mkdir(out, { recursive: true });
const config = await (await fetch(productionExample + '/config')).json();
assert.equal(config.production, true);
assert.equal(config.baseUrl, 'https://api.printhiv3d.com');
let app;
let directory;
let base = process.env.EXAMPLE_URL;
if (!base) {
  directory = await mkdtemp(join(tmpdir(), 'plate-colors-'));
  const readCatalog = async params => {
    const response = await fetch(productionExample + '/catalog?' + params);
    assert(response.ok, 'Existing production catalog connection must authenticate');
    return response.json();
  };
  const catalog = {
    search: readCatalog,
    get: async id => {
      const data = await readCatalog(new URLSearchParams({ q: id }));
      assert.equal(data.materials.length, 1);
      assert.equal(data.materials[0].id, id);
      return data.materials[0];
    },
  };
  const backend = createOrderServer({ catalog, directory, baseUrl: config.baseUrl });
  app = (await import('node:http')).createServer((req, res) => {
    const path = new URL(req.url, productionExample).pathname;
    if (path.startsWith('/orders') && path !== '/orders/preview') {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end('{"error":"Proof instance is read-only"}');
    }
    backend.emit('request', req, res);
  });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  base = 'http://127.0.0.1:' + app.address().port;
}
const browser = await chromium.launch({ headless: true });
const checks = [], requests = [], errors = [], violations = [];
const fixture = 'test/fixtures/project-inspection/plate-usage-json.3mf';
async function open(viewport, record) {
  const ctx = await browser.newContext({ viewport, ...(record ? { recordVideo: { dir: out, size: viewport } } : {}) });
  await ctx.route('**/*', route => {
    const r = route.request(), u = new URL(r.url());
    requests.push({ method: r.method(), path: u.pathname });
    if (u.origin !== base || !(['GET', 'HEAD'].includes(r.method()) || r.method() === 'POST' && ['/project-data/inspect', '/orders/preview'].includes(u.pathname))) {
      violations.push(r.method() + ' ' + u.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#plate').value === '1');
  return { ctx, page, record };
}
async function pause(r, ms = 900) { if (r.record) await r.page.waitForTimeout(ms); }
async function click(r, locator) {
  await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox();
  await r.page.mouse.move(b.x + b.width/2, b.y + b.height/2, { steps: 10 });
  await pause(r, 250); await locator.click(); await pause(r, 600);
}
async function upload(r, file, selected) {
  await r.page.locator('#file').setInputFiles(file);
  await r.page.waitForFunction(value => !document.querySelector('#plate').disabled && document.querySelector('#plate').value === value, selected);
  await r.page.locator('#source-palette input').first().waitFor();
}
const slots = r => r.page.locator('#source-palette input').evaluateAll(es => es.map(e => Number(e.value)));
async function close(r, name) { const v = r.page.video(); await r.ctx.close(); if (v) await v.saveAs(out + name); }
try {
  const r = await open({ width: 1280, height: 1000 }, false);
  await upload(r, fixture, '2');
  assert.deepEqual(await slots(r), [1, 4, 7]);
  assert.equal(await r.page.locator('#source-palette input:checked').count(), 3);
  assert.equal(await r.page.locator('#source-palette .swatch').count(), 3);
  checks.push('Plate 2 defaults to saved indices 1, 4, 7 with swatches and confirmation');
  await click(r, r.page.locator('#show-all-filaments'));
  assert.deepEqual(await slots(r), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(await r.page.locator('#source-palette .swatch').count(), 8);
  await click(r, r.page.locator('input[data-palette-slot="0"]'));
  await click(r, r.page.locator('#show-all-filaments'));
  assert.deepEqual(await slots(r), [0, 1, 4, 7]);
  checks.push('Show all reveals eight colors; selected extras remain visible after filtering');
  await r.page.locator('#plate').selectOption('7');
  assert.deepEqual(await slots(r), [0, 3]);
  assert.equal(await r.page.locator('#source-palette .swatch').count(), 2);
  const colors = await r.page.locator('#source-palette .swatch').evaluateAll(es => es.map(e => getComputedStyle(e).backgroundColor));
  assert.equal(colors[0], colors[1]);
  checks.push('Switching plate preserves original indices and separate same-color identities');
  await r.page.locator('#plate').selectOption('2');
  assert.deepEqual(await slots(r), [0, 1, 4, 7]);
  await upload(r, 'test/fixtures/project-inspection/plate-usage-empty.3mf', '2');
  assert.equal((await slots(r)).length, 8);
  assert.equal(await r.page.locator('#source-palette input:checked').count(), 0);
  checks.push('Missing usage shows all eight candidates without inventing a used set');
  await r.page.screenshot({ path: out + 'unknown.png', fullPage: true });
  await r.page.locator('#file').setInputFiles([]);
  await r.page.locator('.mapping').first().waitFor();
  const row = r.page.locator('.mapping').first();
  await row.locator('input[type=search]').fill('PETG1710-BLK');
  await click(r, row.getByRole('button', { name: 'Search', exact: true }));
  await click(r, row.getByRole('button', { name: 'Use Black', exact: true }));
  assert.equal(await row.locator('.source-line .swatch').count(), 1);
  assert.equal(await row.locator('.selection .swatch').count(), 1);
  assert.equal(await row.locator('.catalog-item .swatch').count(), 1);
  await click(r, r.page.locator('#preview'));
  await r.page.waitForFunction(() => document.querySelector('#payload').textContent.includes('"filaments"'));
  assert.equal(JSON.parse(await r.page.locator('#payload').textContent()).filaments[0].color, '#111112');
  assert.equal(await r.page.locator('#payload-colors .swatch').count(), 1);
  await click(r, r.page.locator('summary'));
  assert.equal(await r.page.locator('#manifest-colors .swatch').count(), 1);
  checks.push('Real catalog, selected requirement, source, JSON preview and editor colors all have swatches');
  await close(r);
  const d = await open({ width: 1280, height: 1000 }, true);
  await pause(d, 1000); await upload(d, fixture, '2');
  await d.page.locator('#source-usage').scrollIntoViewIfNeeded(); await pause(d, 1400);
  await click(d, d.page.locator('#show-all-filaments')); await pause(d, 1000);
  await click(d, d.page.locator('#show-all-filaments'));
  await d.page.locator('#plate').scrollIntoViewIfNeeded(); await d.page.locator('#plate').selectOption('7');
  await d.page.locator('#source-usage').scrollIntoViewIfNeeded(); await pause(d, 1700);
  await d.page.screenshot({ path: out + 'desktop.png' }); await close(d, 'desktop-raw.webm');
  const m = await open({ width: 390, height: 844 }, true);
  await pause(m, 800); await upload(m, fixture, '2');
  await m.page.locator('#source-usage').scrollIntoViewIfNeeded(); await pause(m, 1300);
  await click(m, m.page.locator('#show-all-filaments')); await pause(m, 1300);
  assert(await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await m.page.screenshot({ path: out + 'mobile.png' }); await close(m, 'mobile-raw.webm');
  checks.push('Desktop and mobile show filtered/all-palette swatches without horizontal overflow');
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  await writeFile(out + 'results.json', JSON.stringify({ base, productionCatalogVia: productionExample, readOnlyReplica: Boolean(app), checks, requests, errors, violations, orderSubmitted: false }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, errors, violations, orderSubmitted: false }, null, 2));
} finally {
  await browser.close();
  if (app) { app.closeAllConnections(); await new Promise(r => app.close(r)); }
  if (directory) await rm(directory, { recursive: true, force: true });
}
