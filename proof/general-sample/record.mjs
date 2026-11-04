import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const demoUrl = new URL(process.env.DEMO_URL ?? 'http://127.0.0.1:3086');
if (demoUrl.hostname !== '127.0.0.1') throw new Error('Record only the owned loopback fixture');
const browser = await chromium.launch({ headless: true });
const rehearse = process.argv.includes('--rehearse');
const script = await readFile(new URL('./demo.js', import.meta.url), 'utf8');
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    if (process.argv.includes('--desktop') && name !== 'desktop') continue;
    if (process.argv.includes('--mobile') && name !== 'mobile') continue;
    const context = await browser.newContext({ viewport, ...(rehearse ? {} : { recordVideo: { dir: resolve('data/general-sample-video'), size: viewport } }) });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(demoUrl.href);
    await page.waitForSelector('#search-1-0');
    await page.evaluate(script);
    const result = await page.evaluate(options => window.runSampleDemo(options), { rehearse, cancel: name === 'mobile' });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ viewport: name, ...result, errors }));
    await context.close();
    if (!rehearse) await page.video().saveAs(resolve(`data/general-sample-video/sdk-0.4.1-${name}.webm`));
  }
} finally { await browser.close(); }
