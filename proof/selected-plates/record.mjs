import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const url = new URL(process.env.DEMO_URL ?? 'http://127.0.0.1:3086');
if (url.hostname !== '127.0.0.1') throw new Error('Use only the owned loopback fake');
const rehearse = process.argv.includes('--rehearse');
const script = await readFile(new URL('./demo.js', import.meta.url), 'utf8');
const archive = (await readFile(new URL('./shared.3mf', import.meta.url))).toString('base64');
const browser = await chromium.launch({ headless: true });
await mkdir('data/selected-plates', { recursive: true });
try {
  for (const [name, viewport, automatic] of [
    ['manual-desktop', { width: 1280, height: 900 }, false],
    ['automatic-desktop', { width: 1280, height: 900 }, true],
    ['manual-mobile', { width: 390, height: 844 }, false],
  ]) {
    const context = await browser.newContext({ viewport, ...(rehearse ? {} : { recordVideo: { dir: resolve('data/selected-plates'), size: viewport } }) });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Fail closed even if application configuration accidentally points elsewhere.
    await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
    await page.goto(url.href);
    await page.evaluate(script);
    const result = await page.evaluate(options => window.runSelectedDemo(options), { archive, automatic, rehearse });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ name, result, errors }));
    await context.close();
    if (!rehearse) await page.video().saveAs(resolve(`data/selected-plates/${name}.webm`));
  }
} finally { await browser.close(); }
