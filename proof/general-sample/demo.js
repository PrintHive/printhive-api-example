window.runSampleDemo = async ({ sdkSearch = false, cancel = false, rehearse = false } = {}) => {
  const pause = ms => new Promise(r => setTimeout(r, rehearse ? Math.min(ms, 150) : ms));
  const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Demo state did not arrive'); };
  const get = selector => {
    const el = selector.startsWith('text:') ? [...document.querySelectorAll('button')].find(e => e.textContent.trim() === selector.slice(5)) : document.querySelector(selector);
    if (!el) throw new Error(`Missing demo element: ${selector}`);
    return el;
  };
  document.querySelectorAll('#demo-cursor,#demo-subtitle').forEach(el => el.remove());
  const cursor = document.createElement('div'); cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5"/></svg>';
  cursor.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;left:10px;top:10px;transition:all .35s'; document.body.append(cursor);
  const caption = document.createElement('div'); caption.id = 'demo-subtitle';
  caption.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99998;background:#111e;color:white;text-align:center;padding:10px;font:13px system-ui;pointer-events:none'; document.body.append(caption);
  const say = async text => { caption.textContent = `Local HTTP mock, no real slicing or printer. ${text}`; await pause(1500); };
  const view = async selector => { const el = get(selector); el.scrollIntoView({ behavior: rehearse ? 'instant' : 'smooth', block: 'center' }); await pause(800); const b = el.getBoundingClientRect(); cursor.style.left = `${b.x + b.width / 2}px`; cursor.style.top = `${b.y + b.height / 2}px`; await pause(450); return el; };
  const click = async selector => { const el = await view(selector); if (el.disabled) throw new Error(`Disabled: ${selector}`); el.click(); await pause(650); };
  const type = async (selector, text) => { const el = await view(selector); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); for (const ch of text) { setter.call(el, el.value + ch); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(35); } await pause(400); };
  await until(() => document.querySelector('#search-1-0'));
  await say(sdkSearch ? 'Step 1 - Unpublished SDK search preview' : 'Step 1 - Published SDK 0.3.2');
  await view('#sdk-info');
  await click('#project-editor summary'); await pause(1300); await click('#project-editor summary');
  await say('Step 2 - Map a plate filament');
  await type('#search-1-0', 'black PETG'); await click('text:Search');
  await until(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Use Black PETG'));
  await pause(1200);
  await type('#search-1-0', '11111111-1111-4111-8111-111111111111'); await click('text:Search');
  await until(() => document.body.innerText.includes('HTTP GET /v1/materials/{id}. Direct catalog ID lookup.'));
  await view('#search-1-0'); await pause(1500);
  await click('text:Use Black PETG');
  await say('Step 3 - Choose a destination');
  await type('#printer-search', 'Boo P1S'); await click('text:Find printers'); await pause(1700);
  if (sdkSearch) { await until(() => [...document.querySelectorAll('button')].some(e => e.textContent.trim() === 'Use Boo mock printer')); await click('text:Use Boo mock printer'); }
  else await type('#printer', '22222222-2222-4222-8222-222222222222');
  await click('#preview'); await until(() => document.querySelector('#payload')?.textContent.includes('sourceSlot')); await view('#payload'); await pause(1600);
  await say('Step 4 - Create and review the hold');
  await click('#submit'); await until(() => document.querySelector('#state')?.textContent === 'held'); await view('#state'); await pause(1800);
  await click(cancel ? '#cancel' : '#release'); await until(() => document.querySelector('#state')?.textContent === (cancel ? 'cancelled' : 'created')); await view('#state'); await pause(1600);
  if (!cancel) { await say('Step 5 - Read the created job'); await view(sdkSearch ? '#job-read-error' : '#job-state'); await pause(2200); }
  await click('#catalog-sync summary'); await view('#sync-capability'); await pause(1700); await click('#catalog-sync summary');
  const result = { state: get('#state').textContent, overflow: document.documentElement.scrollWidth > innerWidth, sdk: get('#sdk-info').textContent };
  if (result.overflow) throw new Error('Horizontal overflow');
  await view('#state'); await pause(1500);
  return result;
};
