import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base='http://127.0.0.1:3077';
const b=await chromium.launch({headless:true});
try{
 const page=await b.newPage({viewport:{width:1280,height:1000}});
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  assert(u.origin===base && (['GET','HEAD'].includes(r.method()) || r.method()==='POST' && u.pathname.startsWith('/project-data/')),'Unexpected mutating or remote request');
  return route.continue();
 });
 await page.goto(base);
 await page.locator('#plate option').waitFor({state:'attached'});
 await page.locator('#file').setInputFiles('proof/filament-mapping/three-plate.3mf');
 try{await page.waitForFunction(()=>document.querySelector('#plate').options.length===3,{},{timeout:5000})}catch{}
 const options=await page.locator('#plate option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent,disabled:e.disabled})));
 console.log('Detected plates after selecting a three-plate project:',JSON.stringify(options));
 await page.screenshot({path:'proof/plate-extraction/repro.png',fullPage:true});
 assert.deepEqual(options.filter(o=>!o.disabled).map(o=>o.value),['1','2','3']);
}finally{await b.close()}
