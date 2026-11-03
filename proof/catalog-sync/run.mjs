import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, record } from './contract.mjs';
import { createOrderServer } from '../../src/server.mjs';
const { chromium } = await import((await import('node:url')).pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const out = 'proof/catalog-sync';
const productionBase = process.env.EXAMPLE_URL ?? 'http://127.0.0.1:3077';
const exampleUrl = new URL(productionBase);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(exampleUrl.hostname), 'Drive only an owned loopback example backend');
const config = await (await fetch(productionBase+'/config')).json();
assert.equal(config.production, true);
assert.equal(config.sdk.version, '0.3.0');
const mode = process.argv[2] ?? 'rehearse';
const recording = mode === 'record';
await mkdir(out, { recursive: true });
const f = await fixture();
const app = createOrderServer({ hive: f.hive, directory: out+'/orders-unused', baseUrl: 'http://127.0.0.1:1' });
app.listen(0, '127.0.0.1'); await once(app, 'listening');
const fixtureBase = `http://127.0.0.1:${app.address().port}`;
const old = createOrderServer({ directory: out+'/orders-unused', baseUrl: 'http://127.0.0.1:1' });
old.listen(0, '127.0.0.1'); await once(old, 'listening');
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [], violations = [], requests = [];
async function open(base, viewport) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', ...(recording ? {recordVideo:{dir:out,size:viewport}} : {}) });
  await ctx.route('**/*', route => {
    const r=route.request(), u=new URL(r.url());
    requests.push({origin:u.origin,method:r.method(),path:u.pathname});
    const allowed = u.origin === base && (['GET','HEAD'].includes(r.method()) || r.method() === 'POST' && (u.pathname === '/catalog-sync/preview' || base === fixtureBase && u.pathname === '/catalog-sync/upsert'));
    if(!allowed){violations.push(r.method()+' '+u.pathname);return route.abort();}
    return route.continue();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await page.waitForFunction(()=>!document.querySelector('#sdk-info').textContent.includes('Loading'));
  await page.evaluate(()=>{
    const arrow=document.createElement('div');arrow.innerHTML='<svg width="24" height="24"><path d="M5 3L19 12L12 13L9 20Z" fill="white" stroke="black"/></svg>';
    Object.assign(arrow.style,{position:'fixed',zIndex:'99999',pointerEvents:'none',left:'0',top:'0'});document.body.append(arrow);document.addEventListener('mousemove',e=>{arrow.style.left=e.clientX+'px';arrow.style.top=e.clientY+'px';});
    const bar=document.createElement('div');bar.id='proof-subtitle';Object.assign(bar.style,{position:'fixed',bottom:'0',left:'0',right:'0',zIndex:'99998',background:'#111',color:'white',padding:'12px',textAlign:'center',fontSize:'15px',pointerEvents:'none'});document.body.append(bar);
  });
  return {ctx,page,base,viewport};
}
async function pause(r,ms=1000){if(recording)await r.page.waitForTimeout(ms);}
async function subtitle(r,text){await r.page.locator('#proof-subtitle').evaluate((e,t)=>e.textContent=t,text);await pause(r,1000);}
async function click(r,s){const loc=r.page.locator(s);await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();assert(b);await r.page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await pause(r,250);await loc.click();await pause(r,700);}
async function input(r,s,value){const loc=r.page.locator(s);await click(r,s);await loc.fill('');if(recording)await loc.pressSequentially(value,{delay:12});else await loc.fill(value);await pause(r,500);}
async function expectText(r,s,text){await r.page.waitForFunction(({s,text})=>document.querySelector(s).textContent.includes(text),{s,text});}
async function close(r,name){assert.equal(await r.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');if(recording)await r.page.screenshot({path:out+'/'+name+'.png'});const video=r.page.video();await r.ctx.close();if(video)await video.saveAs(out+'/'+name+'.webm');}
try{
  for(const [name,viewport] of [['production-desktop',{width:1280,height:900}],['production-mobile',{width:390,height:844}]]){
    const r=await open(productionBase,viewport);
    await subtitle(r,'Real production API · preview and reads only');
    assert.match(await r.page.locator('#sdk-info').innerText(),/0.3.0.*local package/);
    await click(r,'#catalog-sync summary');
    await input(r,'#sync-input','{"log":{}}');await click(r,'#sync-preview');await expectText(r,'#sync-error','records array');assert.equal(await r.page.locator('#sync-all').isDisabled(),true);
    await subtitle(r,'Validate records locally; no catalog write');
    await r.page.locator('#sync-file').setInputFiles({name:'store-catalog.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{...record,externalId:'preview-only',sku:'PETG-GREEN'}],null,2))});
    await click(r,'#sync-preview');await expectText(r,'#sync-status','Preview only');assert.equal(await r.page.locator('#sync-preview-records .swatch').count(),1);
    assert.match(await r.page.locator('#sync-all').innerText(),/to production/);
    await subtitle(r,'Preview includes source identity, SKU and color swatch');
    await r.page.locator('#sync-preview-records').scrollIntoViewIfNeeded();await pause(r,1800);
    await subtitle(r,'Read real synced catalog: currently empty');await click(r,'#sync-refresh');await expectText(r,'#sync-read-status','No synced');
    await input(r,'#sync-get-id','33333333-3333-4333-8333-333333333333');await click(r,'#sync-get');await expectText(r,'#sync-read-status','HTTP 404');
    await subtitle(r,'No sync or order was submitted');await pause(r,1200);await close(r,name);
    checks.push(name+': local SDK shown, invalid import disabled, file import preview swatch, production-write label, live empty list and 404, no overflow');
  }
  const r=await open(fixtureBase,{width:1280,height:900});
  await subtitle(r,'Owned HTTP contract fixture · real SDK · no real database');await click(r,'#catalog-sync summary');
  const batch=[record,{...record,externalId:'retry-record',sku:'SECOND'}];
  await r.page.locator('#sync-file').setInputFiles({name:'contract-records.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(batch,null,2))});
  await click(r,'#sync-preview');await expectText(r,'#sync-status','Validated 2');assert.equal(f.calls.length,0);
  await subtitle(r,'Explicit sync: one confirmed; one API rejection');await click(r,'#sync-all');await expectText(r,'#sync-status','1 synced, 1 not confirmed');assert.equal(await r.page.locator('#sync-outcomes input').inputValue(),f.id);assert(!(await r.page.locator('#sync-outcomes').innerText()).includes('upstream-private'));
  await r.page.locator('#sync-outcomes').scrollIntoViewIfNeeded();await pause(r,2000);
  const postsBefore=f.calls.filter(c=>c.method==='POST').length;f.allowRetry();
  await subtitle(r,'Retry sends only the failed external ID');await click(r,'#sync-retry');await expectText(r,'#sync-status','1 synced, 0 not confirmed');assert.equal(f.calls.filter(c=>c.method==='POST').length,postsBefore+1);assert.equal(await r.page.locator('#sync-outcomes input').count(),2);
  await subtitle(r,'Read by external ID, then Hive UUID');await input(r,'#sync-filter-external',record.externalId);await click(r,'#sync-refresh');await expectText(r,'#sync-read-status','1 synced records');assert.equal(await r.page.locator('#sync-read-results input').inputValue(),f.id);
  await input(r,'#sync-get-id',f.id);await click(r,'#sync-get');await expectText(r,'#sync-read-status','Read current Hive binding');
  await r.page.locator('#sync-read-results').scrollIntoViewIfNeeded();await pause(r,1600);
  await subtitle(r,'Editing imported records invalidates the old preview');await input(r,'#sync-input','[]');assert.equal(await r.page.locator('#sync-all').isDisabled(),true);assert.equal(await r.page.locator('#sync-preview-records').innerText(),'');
  await close(r,'contract-desktop');checks.push('contract desktop: real SDK lost-response replay, partial error, failed-only retry, list/get UUID binding and stale preview reset');
  const legacy=await open('http://127.0.0.1:'+old.address().port,{width:390,height:844});await click(legacy,'#catalog-sync summary');assert.match(await legacy.page.locator('#sync-capability').innerText(),/unavailable/);assert(await legacy.page.locator('#sync-refresh').isDisabled());assert(await legacy.page.locator('#sync-all').isDisabled());await close(legacy,'capability-unavailable');checks.push('missing SDK capability disables catalog writes and reads');
  assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
  await writeFile(out+'/'+mode+'-results.json',JSON.stringify({mode,checks,errors,violations,productionMutations:requests.filter(r=>r.origin===productionBase&&r.method==='POST').map(r=>r.path),fixtureWireCalls:f.calls.length},null,2)+'\n');
  console.log(JSON.stringify({mode,checks:checks.length,errors,violations}));
}finally{await browser.close();for(const s of [app,old]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}await f.close();}
