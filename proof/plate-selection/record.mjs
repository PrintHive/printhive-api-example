import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const demoUrl = new URL(process.env.DEMO_URL ?? 'http://127.0.0.1:3086');
if (demoUrl.hostname !== '127.0.0.1') throw new Error('Use the owned loopback fixture');
const rehearse = process.argv.includes('--rehearse');
const script = await readFile(new URL('./demo.js', import.meta.url), 'utf8');
const archive = (await readFile('test/fixtures/plate-previews/valid.3mf')).toString('base64');
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, ...(rehearse ? {} : { recordVideo: { dir: resolve('data/plate-selection'), size: viewport } }) });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(demoUrl.href); await page.waitForSelector('[aria-label="Configure plate 1"]');
    await page.evaluate(script);
    const result = await page.evaluate(options => window.runPlateDemo(options), { archive, rehearse });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ name, ...result, errors }));
    await context.close();
    if (!rehearse) await page.video().saveAs(resolve(`data/plate-selection/${name}.webm`));
  }
} finally { await browser.close(); }
