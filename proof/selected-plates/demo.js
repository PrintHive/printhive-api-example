window.runSelectedDemo = async ({ archive, rehearse = false, automatic = false }) => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, rehearse ? Math.min(ms, 50) : ms));
  const wait = async (fn, label) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Missing demo state: ${label}`);
  };
  const button = text => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === text);
  const cursor = document.createElement('div');
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5"/></svg>';
  cursor.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;left:30px;top:30px;transition:left .25s,top .25s';
  document.body.append(cursor);
  const caption = document.createElement('div');
  caption.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#000e;color:white;padding:12px;text-align:center;z-index:99998;font:15px sans-serif;pointer-events:none';
  document.body.append(caption);
  async function say(text) { caption.textContent = text; await pause(900); }
  async function click(el) {
    if (!el || el.disabled) throw new Error(`Demo control missing or disabled: ${el?.textContent}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); await pause(600);
    const box = el.getBoundingClientRect(); cursor.style.left = `${box.x + box.width/2}px`; cursor.style.top = `${box.y + box.height/2}px`;
    await pause(400); el.click(); await pause(900);
  }
  async function type(el, text) {
    await click(el);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const char of text) { setter.call(el, el.value + char); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(35); }
  }
  await wait(() => button('Use Red PETG'), 'initial project');
  await say('1. Choose a 3MF. This entire demo uses a fake API.');
  const bytes = Uint8Array.from(atob(archive), char => char.charCodeAt(0));
  const files = new DataTransfer(); files.items.add(new File([bytes], 'shared.3mf'));
  const input = document.querySelector('#file'); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.querySelector('[aria-label="Include plate 7"]'), 'all plate cards');
  document.querySelector('[aria-label="Configure plate 7"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
  await say('2. All plates are shown, including a missing-preview placeholder.');
  await click(document.querySelector('[aria-label="Include plate 7"]'));
  if (document.querySelector('[data-selected-source="2"]')) throw new Error('Unselected source appeared');
  await say('3. Map only the Source Slots used by selected plates.');
  await click(button('Confirm saved usage for selected plates'));
  for (const [slot, query, name] of [[0, 'bambu red', 'Red PETG'], [1, 'black PETG', 'Black PETG']]) {
    const row = document.querySelector(`[data-selected-source="${slot}"]`);
    await type(row.querySelector('input[type="search"]'), query);
    await click([...row.querySelectorAll('button')].find(el => el.textContent.trim() === 'Search'));
    await wait(() => [...row.querySelectorAll('button')].some(el => el.textContent.trim() === `Use ${name}`), query);
    await click([...row.querySelectorAll('button')].find(el => el.textContent.trim() === `Use ${name}`));
  }
  // Include the synthetic failure plate after proving it added no mapping while excluded.
  await click(document.querySelector('[aria-label="Include plate 9"]'));
  await click(button('Confirm saved usage for selected plates'));
  const row = document.querySelector('[data-selected-source="2"]');
  await wait(() => [...row.querySelectorAll('button')].some(el => el.textContent.trim() === 'Use Black PETG'), 'third slot');
  await click([...row.querySelectorAll('button')].find(el => el.textContent.trim() === 'Use Black PETG'));
  await say(automatic ? '4. Choose Smart Queue to distribute the plates.' : '4. Search for the destination printer.');
  if (automatic) await click(button('Use Smart Queue'));
  else {
    await type(document.querySelector('#printer-search'), 'Boo P1S');
    await click(button('Find printers'));
    await wait(() => button('Use Boo P1S'), 'printer search');
    await click(button('Use Boo P1S'));
  }
  if (automatic) {
    const select = document.querySelector('#release-mode'); select.value = 'automatic'; select.dispatchEvent(new Event('change', { bubbles: true }));
    select.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await say('5. Automatic is explicit and requires destination confirmation.');
    button('Submit order').scrollIntoView({ behavior: 'smooth', block: 'center' });
    await pause(1000);
    await click(button('Submit order'));
    await wait(() => document.querySelector('[role="alertdialog"]'), 'automatic confirmation');
    document.querySelector('[role="alertdialog"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
    await say('Confirm Smart Queue. This will start real prints on the farm.');
    await pause(2000);
    await click(button('Confirm automatic printing'));
    await wait(() => button('Plate 2 · created') && button('Plate 7 · created') && button('Plate 9 · failed'), 'automatic settlement');
    document.querySelector('#progress-summary').scrollIntoView({ behavior: 'smooth', block: 'center' });
    await say('Two jobs queued. One plate failed. No manual release call.');
    await pause(2200);
    return { automatic: true, summary: document.querySelector('#progress-summary').textContent };
  }
  await say('5. Submit with Manual review first, the default.');
  await click(button('Submit order'));
  await wait(() => button('Plate 2 · held'), 'held plate');
  document.querySelector('#status-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await say('6. Each plate has its own progress, hold, or API failure.');
  await click(button('Plate 2 · held'));
  await click(button('Release'));
  await wait(() => button('Plate 2 · created'), 'created plate');
  await say('Release authorizes only this held plate. Job created, queued.');
  await click(button('Plate 7 · held'));
  await click(button('Cancel'));
  await wait(() => button('Plate 7 · cancelled'), 'cancelled plate');
  await click(button('Plate 9 · failed'));
  await say('Failures retain the API code and reason. Other plates continue.');
  document.querySelector('#failure').scrollIntoView({ behavior: 'smooth', block: 'center' });
  await pause(2200);
  return { manual: true, summary: document.querySelector('#progress-summary').textContent };
};
