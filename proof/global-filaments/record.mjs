import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright');
const url = new URL(process.env.DEMO_URL ?? 'http://127.0.0.1:3086');
if (url.hostname !== '127.0.0.1' || url.port === '3077') throw new Error('Use the owned loopback fixture outside port 3077');
const rehearse = process.argv.includes('--rehearse');
const script = await readFile(new URL('./demo.js', import.meta.url), 'utf8');
const archive = (await readFile('proof/material-mapping/shared.3mf')).toString('base64');
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, ...(rehearse ? {} : { recordVideo: { dir: resolve('data/global-filaments'), size: viewport } }) });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url.href); await page.waitForSelector('#file');
    await page.evaluate(script);
    const result = await page.evaluate(options => window.runGlobalDemo(options), { archive, rehearse });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ name, ...result, errors }));
    await context.close();
    if (!rehearse) await page.video().saveAs(resolve(`data/global-filaments/${name}.webm`));
  }
} finally { await browser.close(); }
