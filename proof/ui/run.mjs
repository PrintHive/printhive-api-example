// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node proof/ui/run.mjs.
// Playwright is a verification tool only, not an application dependency.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeApi } from './fake-api.mjs';
import { createOrderServer } from '../../src/server.mjs';
import { clientFromEnv } from '../../src/client.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = await mkdtemp(join(tmpdir(), 'ui-proof-'));
const fake = fakeApi();
let app, browser;
const results = [];
const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const pause = (page, ms = 1000) => page.waitForTimeout(ms);
try {
  const baseUrl = await listen(fake.server);
  process.env.PRINTHIVE_BASE_URL = baseUrl;
  process.env.PRINTHIVE_API_KEY = 'ui-proof-dummy';
  app = createOrderServer({ ...clientFromEnv(), directory, baseUrl });
  const url = await listen(app);
  browser = await chromium.launch({ headless: true });
  async function flow(record) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...(record ? { recordVideo: { dir: 'proof/ui', size: { width: 1280, height: 1000 } } } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/*', (route) => {
      assert.equal(new URL(route.request().url()).origin, url, 'Browser must talk only to example server');
      return route.continue();
    });
    async function open() {
      await page.goto(url);
      await page.getByText(`API destination: ${baseUrl}`, { exact: false }).waitFor();
      await page.evaluate(() => {
        const cursor = document.createElement('div');
        cursor.id = 'demo-cursor';
        cursor.textContent = '➤';
        cursor.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;color:#182822;font-size:25px;';
        document.body.append(cursor);
        document.addEventListener('mousemove', (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; });
      });
      if (record) await pause(page);
    }
    async function click(locator) {
      assert(await locator.isVisible());
      const box = await locator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      if (record) await pause(page, 350);
      await locator.click();
    }
    async function state(value, screenshot) {
      await page.locator('#state').filter({ hasText: new RegExp(`^${value}$`) }).waitFor({ timeout: 15000 });
      if (record) {
        await pause(page, 750);
        if (screenshot) await page.screenshot({ path: `proof/ui/${screenshot}.png`, fullPage: true });
      }
    }
    await open();
    if (!record) {
      results.push({ discovery: await page.locator('input, select, button').evaluateAll((els) => els.map((el) => ({ tag: el.tagName, type: el.type, id: el.id, text: el.textContent.trim().slice(0, 60) }))) });
    }
    await page.getByLabel('Release mode').selectOption('automatic');
    await page.getByLabel('Project 3MF').setInputFiles('fixtures/cube.3mf');
    await click(page.getByRole('button', { name: 'Add filament', exact: true }));
    await page.getByLabel('Material', { exact: true }).last().fill('PLA');
    await click(page.getByRole('button', { name: 'Submit order', exact: true }));
    await state('preparing', 'automatic-preparing');
    await state('created', 'automatic-created');
    assert.match(await page.locator('#job-id').textContent(), /^\d+$/);
    await open();
    await page.getByLabel('Plate number').fill('2');
    await click(page.getByRole('button', { name: 'Submit order', exact: true }));
    await state('preparing'); await state('held', 'manual-held');
    assert.match(await page.locator('#actions').textContent(), /manual_release_required/);
    // Changing the form after submission must not change which plate Release controls.
    await page.getByLabel('Plate number').fill('1');
    await click(page.getByRole('button', { name: 'Release', exact: true }));
    await state('created', 'manual-created');
    await open();
    await click(page.getByRole('button', { name: 'Submit order', exact: true }));
    await state('preparing');
    await click(page.getByRole('button', { name: 'Cancel', exact: true }));
    await state('cancelled', 'cancelled');
    assert.equal(await page.getByRole('button', { name: 'Release', exact: true }).isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isVisible(), false);
    if (record) await pause(page, 1500);
    assert.deepEqual(errors, []);
    const video = page.video();
    await context.close();
    if (record) { await video.saveAs('proof/ui/demo.webm'); await video.delete(); }
    results.push({ phase: record ? 'record' : 'rehearse', result: 'PASS' });
  }
  await flow(false);
  await flow(true);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await mobile.newPage(); await page.goto(url);
  assert(await page.getByLabel('Project 3MF').isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'proof/ui/mobile.png', fullPage: true });
  await mobile.close();
  await writeFile('proof/ui/results.json', JSON.stringify({ results, events: fake.events, scope: 'Loopback stub only; no real API, credentials, or printers' }, null, 2));
  console.log('UI rehearsal, recording, and mobile layout: PASS');
} finally {
  await browser?.close();
  for (const server of [app, fake.server]) if (server?.listening) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
  await rm(directory, { recursive: true, force: true });
}
