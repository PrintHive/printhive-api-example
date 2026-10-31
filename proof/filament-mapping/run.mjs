import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.EXAMPLE_URL ?? 'http://127.0.0.1:3077';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const out = resolve('proof/filament-mapping');
const manifest = JSON.parse(await readFile(`${out}/three-plate.json`, 'utf8'));
const browser = await chromium.launch({ headless: true });
const checks = [];
const requests = [];
const violations = [];
const errors = [];
const expectCheck = (name, condition) => { assert(condition, name); checks.push(name); };
const black = { sku: 'PETG1710-BLK', name: 'Black', color: '#111112' };
const white = { sku: 'PETG1710-WHT', name: 'White', color: '#E3E2E0' };
for (const item of [black, white]) {
  const response = await fetch(`${base}/catalog?${new URLSearchParams({ q: item.sku })}`);
  assert(response.ok);
  const found = (await response.json()).materials.find(row => row.sku === item.sku && row.selectable);
  assert(found, `Proof catalog entry unavailable: ${item.sku}`);
  item.id = found.id;
}
async function context(viewport, record) {
  const ctx = await browser.newContext({ viewport, ...(record ? { recordVideo: { dir: out, size: viewport } } : {}) });
  await ctx.route('**/*', route => {
    const req = route.request(), url = new URL(req.url());
    const permitted = url.origin === new URL(base).origin && (['GET', 'HEAD'].includes(req.method()) || req.method() === 'POST' && url.pathname === '/orders/preview');
    requests.push({ method: req.method(), path: url.pathname + url.search });
    if (!permitted) { violations.push(`${req.method()} ${url.pathname}`); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByText('API destination: https://api.printhiv3d.com · Production', { exact: true }).waitFor();
  await page.locator('.mapping').first().waitFor();
  await page.evaluate(() => {
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5"/></svg>';
    cursor.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;left:0;top:0';
    document.body.append(cursor);document.addEventListener('mousemove', e => {cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
  });
  return { ctx, page, record };
}
async function pause(run, ms = 1100) { if (run.record) await run.page.waitForTimeout(ms); }
async function click(run, locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox(); await run.page.mouse.move(box.x+box.width/2, box.y+box.height/2, { steps: 10 });
  await pause(run, 250); await locator.click(); await pause(run, 600);
}
async function search(run, slot, query) {
  const row = run.page.locator(`.mapping[data-source-slot="${slot}"]`);
  const input = row.locator('input[type=search]');
  await input.fill(query); await click(run, row.getByRole('button', { name: 'Search', exact: true }));
  await row.locator('.catalog-item').first().waitFor(); return row;
}
async function choose(run, slot, item, byId = false) {
  const row = await search(run, slot, byId ? item.id : item.sku);
  await click(run, row.getByRole('button', { name: `Use ${item.name}`, exact: true }));
  assert((await row.locator('.selection').textContent()).includes(item.id));
}
async function project(run) {
  await run.page.locator('#file').setInputFiles(`${out}/three-plate.3mf`);
  expectCheck('Changing source clears prior mappings', await run.page.locator('.mapping').count() === 0 && await run.page.locator('#submit').isDisabled());
  await run.page.locator('#manifest').fill(JSON.stringify(manifest, null, 2));
  await click(run, run.page.locator('#apply-manifest'));
  await run.page.locator('#plate').selectOption('3');
  assert.deepEqual(await run.page.locator('.mapping').evaluateAll(rows => rows.map(row => Number(row.dataset.sourceSlot))), [0,2]);
  await pause(run);
}
async function preview(run, expected) {
  await click(run, run.page.locator('#preview'));
  await run.page.waitForFunction(() => document.querySelector('#payload').textContent.includes('"filaments"'));
  const value = JSON.parse(await run.page.locator('#payload').textContent());
  assert.deepEqual(value, expected);
  await run.page.locator('#payload').scrollIntoViewIfNeeded();
  await pause(run, 1100);
  await run.page.locator('#payload').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await pause(run, 1600);
  return value;
}
async function close(run, filename) {
  const video = run.page.video(); await run.ctx.close(); if (video) await video.saveAs(`${out}/${filename}`);
}
try {
  const r = await context({ width:1280,height:1000 }, false);
  await r.page.locator('.catalog-item').first().waitFor();
  await click(r, r.page.getByRole('button', { name:'More results', exact:true }).first());
  await r.page.getByText('showing 21–40', { exact:false }).waitFor(); checks.push('Real catalog pagination');
  await choose(r, 0, black, true); checks.push('Exact material ID lookup');
  await preview(r, {plate:1,filaments:[{sourceSlot:0,material:'PETG',color:black.color}],release:'manual'});
  checks.push('Bundled-source mapping resolves to supported SDK fields');
  const row = r.page.locator('.mapping').first();
  await row.locator('input').fill('no-match-filament-probe-83d4ed');
  await click(r, row.getByRole('button',{name:'Search',exact:true}));
  await row.getByText('No matching catalog filaments. Try a name, SKU, or ID.',{exact:true}).waitFor();checks.push('Real empty-search state');
  await project(r); await choose(r,0,black); await choose(r,2,white);
  const expected={plate:3,filaments:[{sourceSlot:0,material:'PETG',color:black.color},{sourceSlot:2,material:'PETG',color:white.color}],release:'manual'};
  await preview(r,expected); checks.push('Selected plate retains nonconsecutive source indices');
  expectCheck('Source properties are preserved separately', (await r.page.locator('.source-line').allTextContents()).join(' ').includes('#C12E1F'));
  await r.page.locator('#plate').selectOption('2');expectCheck('Another plate starts with its own unmapped requirements',await r.page.locator('#submit').isDisabled());
  await r.page.locator('#plate').selectOption('3');expectCheck('Returning to plate restores only its own choices',await r.page.locator('#submit').isEnabled());
  await click(r,r.page.locator('summary'));
  await r.page.locator('#manifest').fill(JSON.stringify({plates:[{number:1,filaments:[manifest.plates[0].filaments[0],manifest.plates[0].filaments[0]]}]}));
  await click(r,r.page.locator('#apply-manifest'));
  expectCheck('Duplicate source indices are rejected', (await r.page.locator('#project-error').textContent()).includes('unique zero-based slots') && await r.page.locator('#submit').isDisabled());
  await r.page.locator('#file').setInputFiles([]);await r.page.locator('.mapping').first().waitFor();
  expectCheck('Returning to bundled source clears imported-project selections',await r.page.locator('#submit').isDisabled());
  await close(r);
  const d=await context({width:1280,height:1000},true);await pause(d,1800);await project(d);await choose(d,0,black);await choose(d,2,white);await preview(d,expected);
  await d.page.screenshot({path:`${out}/desktop.png`,fullPage:false});
  await d.page.locator('#plate').selectOption('2');await pause(d,1600);assert(await d.page.locator('#submit').isDisabled());
  await d.page.locator('#plate').selectOption('3');await preview(d,expected);await close(d,'desktop-raw.webm');
  const m=await context({width:390,height:844},true);await choose(m,0,black);await preview(m,{plate:1,filaments:[{sourceSlot:0,material:'PETG',color:black.color}],release:'manual'});
  expectCheck('Mobile has no horizontal overflow',await m.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await m.page.screenshot({path:`${out}/mobile.png`,fullPage:false});await close(m,'mobile-raw.webm');
  assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  checks.push('No order creation, release, cancellation, or direct browser production calls');
  await writeFile(`${out}/results.json`,JSON.stringify({base,upstream:'https://api.printhiv3d.com',checks,requests,violations,errors,orderSubmitted:false},null,2)+'\n');
  console.log(JSON.stringify({checks,violations,errors,orderSubmitted:false},null,2));
}finally{await browser.close()}
