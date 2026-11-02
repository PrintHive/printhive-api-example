import { colorLabel } from '/colors.mjs';
const $ = (id) => document.getElementById(id);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let available = false;
let production = false;
let busy = false;
let version = 0;
let preview = null;
let page = { offset: 0, total: 0, hasMore: false };
const outcomes = new Map();
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function setBusy(value) {
  busy = value;
  for (const id of ['sync-input', 'sync-file', 'sync-preview', 'sync-filter-external', 'sync-filter-sku', 'sync-get-id']) $(id).disabled = value;
  $('sync-all').disabled = value || !available || !preview;
  $('sync-retry').disabled = value || !available || !preview || ![...outcomes.values()].some((o) => o.status === 'failed');
  $('sync-refresh').disabled = value || !available;
  $('sync-get').disabled = value || !available;
  $('sync-previous').disabled = value || !available || page.offset === 0;
  $('sync-next').disabled = value || !available || !page.hasMore;
  for (const button of $('sync-preview-records').querySelectorAll('button')) button.disabled = value || !available;
}
function invalidate() {
  version++; preview = null; outcomes.clear();
  $('sync-preview-records').replaceChildren(); $('sync-outcomes').replaceChildren();
  $('sync-status').textContent = 'Validate and preview the current records before syncing.';
  $('sync-error').textContent = ''; setBusy(false);
}
function fields(record) {
  const card = element('div', undefined, 'sync-record');
  card.append(element('strong', record.externalId), element('span', `${record.brand ?? ''} ${record.material} · ${record.colorName}`.trim()), colorLabel(record.colorHex), element('span', `SKU ${record.sku}`));
  if (record.replacementFilamentId !== undefined && record.replacementFilamentId !== null) card.append(element('span', `Informational replacement ID: ${record.replacementFilamentId || '(empty)'}`, 'hint'));
  return card;
}
function binding(record) {
  const card = fields(record);
  const label = element('label', 'Hive filament UUID'); const input = element('input'); input.readOnly = true; input.value = record.id; input.setAttribute('aria-label', `Hive UUID for ${record.externalId}`); input.onclick = () => input.select(); label.append(input); card.append(label);
  return card;
}
function renderPreview() {
  $('sync-preview-records').replaceChildren();
  if (!preview) return;
  for (const record of preview.records) {
    const card = fields(record); const sync = element('button', 'Sync this record', 'secondary'); sync.type = 'button'; sync.disabled = !available || busy;
    sync.onclick = () => performSync([record]); card.append(sync); $('sync-preview-records').append(card);
  }
  $('sync-all').textContent = `Sync ${preview.records.length} previewed record${preview.records.length === 1 ? '' : 's'}${production ? ' to production' : ''}`;
}
function renderOutcomes() {
  $('sync-outcomes').replaceChildren();
  for (const outcome of outcomes.values()) {
    const card = outcome.status === 'synced' ? binding(outcome.filament) : element('div', undefined, 'sync-record');
    if (outcome.status === 'synced') card.prepend(element('strong', 'Synced'));
    else card.append(element('strong', `Not confirmed: ${outcome.externalId}`), element('p', outcome.error));
    $('sync-outcomes').append(card);
  }
}
async function performSync(records) {
  if (busy || !available || !preview || preview.version !== version) return;
  const ownVersion = version; setBusy(true); $('sync-error').textContent = '';
  $('sync-status').textContent = `Syncing ${records.length} record${records.length === 1 ? '' : 's'} sequentially…`;
  try {
    const result = await api('/catalog-sync/upsert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ records }) });
    if (ownVersion !== version) return;
    for (const outcome of result.outcomes) outcomes.set(outcome.externalId, outcome);
    renderOutcomes(); $('sync-status').textContent = `${result.synced} synced, ${result.failed} not confirmed in this attempt. Read current bindings before retrying uncertain results.`;
  } catch (error) { $('sync-error').textContent = `${error.message} Read current bindings before retrying; external IDs retain catalog identity.`; $('sync-status').textContent = 'Sync result is not confirmed.'; }
  finally { setBusy(false); }
}
$('sync-input').oninput = invalidate;
$('sync-file').onchange = async () => {
  const file = $('sync-file').files[0]; if (!file) return;
  invalidate(); const ownVersion = version;
  try {
    if (file.size > 65536) throw new Error('Catalog JSON must be at most 64 KiB');
    const value = await file.text(); if (ownVersion !== version) return;
    $('sync-input').value = value; $('sync-status').textContent = 'Imported locally. Validate and preview before syncing.';
  } catch (error) { $('sync-error').textContent = error.message; }
};
$('sync-preview').onclick = async () => {
  if (busy) return;
  const ownVersion = ++version; preview = null; outcomes.clear(); $('sync-outcomes').replaceChildren(); $('sync-preview-records').replaceChildren();
  setBusy(true); $('sync-error').textContent = '';
  try {
    const records = JSON.parse($('sync-input').value);
    const data = await api('/catalog-sync/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(records) });
    if (ownVersion !== version) return;
    preview = { records: data.records, version: ownVersion }; renderPreview(); $('sync-status').textContent = `Validated ${data.records.length} record${data.records.length === 1 ? '' : 's'}. Preview only; this action made no catalog writes.`;
  } catch (error) { $('sync-error').textContent = error instanceof SyntaxError ? 'Paste a valid JSON records array.' : error.message; $('sync-status').textContent = 'Nothing was synced.'; }
  finally { setBusy(false); }
};
$('sync-all').onclick = () => { if (preview) performSync(preview.records); };
$('sync-retry').onclick = () => { if (preview) performSync(preview.records.filter((r) => outcomes.get(r.externalId)?.status === 'failed')); };
async function readList(offset = 0) {
  if (busy || !available) return;
  setBusy(true); $('sync-error').textContent = '';
  try {
    const query = new URLSearchParams({ limit: '20', offset: String(offset) });
    for (const [name, id] of [['externalId', 'sync-filter-external'], ['sku', 'sync-filter-sku']]) if ($(id).value.trim()) query.set(name, $(id).value.trim());
    const data = await api(`/catalog-sync/list?${query}`); page = data;
    $('sync-read-results').replaceChildren(...data.materials.map(binding)); $('sync-read-status').textContent = data.materials.length ? `${data.total} synced records · showing ${data.offset + 1}–${data.offset + data.materials.length}` : 'No synced catalog bindings match these filters.';
  } catch (error) { $('sync-read-results').replaceChildren(); $('sync-read-status').textContent = error.message; }
  finally { setBusy(false); }
}
$('sync-refresh').onclick = () => readList();
$('sync-previous').onclick = () => readList(Math.max(0, page.offset - 20));
$('sync-next').onclick = () => readList(page.offset + 20);
$('sync-get').onclick = async () => {
  if (busy || !available) return;
  const id = $('sync-get-id').value.trim();
  if (!uuid.test(id)) { $('sync-read-status').textContent = 'Enter a Hive filament UUID.'; return; }
  setBusy(true);
  try { const record = await api(`/catalog-sync/filaments/${encodeURIComponent(id)}`); $('sync-read-results').replaceChildren(binding(record)); $('sync-read-status').textContent = 'Read current Hive binding.'; }
  catch (error) { $('sync-read-results').replaceChildren(); $('sync-read-status').textContent = error.message; }
  finally { setBusy(false); }
};
api('/config').then((config) => {
  available = config.sdk?.capabilities?.filamentCatalog === true; production = config.production;
  const source = config.sdk?.source === 'local-workspace' ? 'local workspace build, not an npm release' : config.sdk?.source === 'local-package' ? 'local package build, not an npm release' : 'installed package';
  $('sdk-info').textContent = `@printhive/api ${config.sdk?.version ?? 'unknown'} · ${source}`;
  $('sync-capability').textContent = available ? 'SDK catalog sync is available. Preview first; Sync writes to the displayed API destination.' : 'Catalog sync is unavailable in this installed SDK. Print-order creation and catalog requirement search remain available.';
  setBusy(false);
}).catch(() => { $('sdk-info').textContent = 'SDK information is unavailable.'; $('sync-capability').textContent = 'Cannot verify SDK catalog support. Reload before syncing.'; setBusy(false); });
