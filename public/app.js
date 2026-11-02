import { colorLabel } from '/colors.mjs';
import { validateProjectData, validateMappedInput, normalizeColor } from '/project-data.mjs';
import { waitingFilamentInstructions, shouldPollJob } from '/job-status.mjs';
const $ = (id) => document.getElementById(id);
let active;
let timer;
let busy = false;
let ready = false;
let bundled;
let project;
let extracted;
let extractionController;
const confirmedPlates = new Map();
const usageDrafts = new Map();
const usageViews = new Map();
let sourceGeneration = 0;
let previewGeneration = 0;
const selections = new Map();
const placementHints = new Map();
const searches = new Set();
const template = { plates: [{ number: 1, filaments: [{ sourceSlot: 0, name: 'Body', material: 'PETG', color: '#000000' }] }] };
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error ?? 'Request failed'}${data.code ? ` (${data.code})` : ''} · HTTP ${response.status}`);
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderManifestColors() {
  $('manifest-colors').replaceChildren();
  try {
    const data = JSON.parse($('manifest').value);
    for (const plate of data.plates ?? []) for (const source of plate.filaments ?? []) {
      if (normalizeColor(source.color)) $('manifest-colors').append(colorLabel(source.color, `Plate ${plate.number} source slot ${source.sourceSlot}`));
    }
  } catch { /* Incomplete JSON has no color summary until it can be read. */ }
}
function renderReportedColors(target, value) {
  target.replaceChildren();
  function visit(node) {
    if (typeof node === 'string' && normalizeColor(node)) target.append(colorLabel(node, 'Reported color'));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  }
  visit(value);
}
function plate() { return extracted ? confirmedPlates.get(Number($('plate').value)) : project?.plates.find((p) => p.number === Number($('plate').value)); }
function unavailablePlate(message) { const option = element('option', message); option.value = ''; $('plate').replaceChildren(option); $('plate').disabled = true; }
function chosen() {
  const number = Number($('plate').value);
  if (!selections.has(number)) selections.set(number, new Map());
  return selections.get(number);
}
function invalidatePreview() {
  previewGeneration++;
  $('payload-colors').replaceChildren();
  $('payload').textContent = 'Choose a Hive requirement for every source filament, then preview the API request.';
  updateButtons();
}
function complete() { return plate()?.filaments.length > 0 && plate().filaments.every((f) => chosen().has(f.sourceSlot)); }
function updateButtons() {
  $('submit').disabled = busy || !ready || (!active && !complete());
  $('preview').disabled = busy || Boolean(active) || !ready || !complete();
  $('intent-fields').disabled = busy || Boolean(active);
  $('plate').disabled = !project || !(extracted?.plates.length || project.plates.length);
}
function resetProject() {
  sourceGeneration++;
  extractionController?.abort();
  extracted = null; confirmedPlates.clear(); usageDrafts.clear(); usageViews.clear();
  $('source-usage').hidden = true; $('source-palette').replaceChildren(); $('extraction-error').textContent = '';
  for (const controller of searches) controller.abort();
  searches.clear();
  project = null;
  selections.clear();
  placementHints.clear();
  unavailablePlate('Reading project…');
  $('filaments').replaceChildren();
  $('project-summary').textContent = 'Reading plates and filament palette from the selected 3MF…';
  $('manifest').value = JSON.stringify(template, null, 2);
  renderManifestColors();
  $('project-editor').open = false;
  $('project-error').textContent = '';
  invalidatePreview();
}
function showProject(value) {
  renderManifestColors();
  extracted = null; confirmedPlates.clear(); usageDrafts.clear(); usageViews.clear();
  $('source-usage').hidden = true; $('extraction-error').textContent = '';
  project = value;
  placementHints.clear();
  $('plate').replaceChildren(...value.plates.map((p) => {
    const option = element('option', `Plate ${p.number}`); option.value = p.number; return option;
  }));
  $('project-summary').textContent = `${value.filename} · Printie data for ${value.plates.length} plate${value.plates.length === 1 ? '' : 's'}`;
  $('project-error').textContent = '';
  $('project-editor').open = false;
  renderFilaments();
}
async function applyProject() {
  const generation = ++sourceGeneration;
  extractionController?.abort();
  try {
    const data = validateProjectData(JSON.parse($('manifest').value));
    const file = $('file').files[0];
    if (file && file.size > 16 * 1024 * 1024 - 65536) throw new Error('Choose a 3MF smaller than 16 MiB including form data');
    const sha256 = file ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('') : bundled.sha256;
    if (generation !== sourceGeneration) return;
    selections.clear();
    for (const controller of searches) controller.abort();
    searches.clear();
    showProject({ filename: file?.name ?? bundled.filename, sha256, ...data });
  } catch (error) {
    if (generation !== sourceGeneration) return;
    project = null; extracted = null; confirmedPlates.clear(); selections.clear(); $('source-usage').hidden = true; $('filaments').replaceChildren(); unavailablePlate('Project data is not ready');
    $('project-error').textContent = error.message;
    $('project-summary').textContent = 'Project data is not ready.';
    invalidatePreview();
  }
}
function showExtracted(value) {
  extracted = value;
  project = { filename: value.filename, sha256: value.sha256, plates: [] };
  confirmedPlates.clear(); usageDrafts.clear(); usageViews.clear();
  $('plate').replaceChildren(...value.plates.map((p) => { const option = element('option', `Plate ${p.number}`); option.value = p.number; return option; }));
  $('project-summary').textContent = `${value.filename} · ${value.plates.length} plate${value.plates.length === 1 ? '' : 's'} extracted · confirm this plate’s source filaments below`;
  $('manifest').value = '';
  renderManifestColors();
  $('project-editor').open = false;
  $('extraction-error').textContent = '';
  renderFilaments();
}
function canConfirmUsage(draft) { return draft.size > 0 && extracted.palette.filter((f) => draft.has(f.sourceSlot)).length === draft.size && extracted.palette.filter((f) => draft.has(f.sourceSlot)).every((f) => f.selectable); }
function renderUsage() {
  $('source-usage').hidden = !extracted;
  $('source-palette').replaceChildren();
  if (!extracted) return;
  const number = Number($('plate').value);
  const usage = extracted.plates.find((p) => p.number === number)?.usage;
  const detected = usage?.kind === 'detected';
  if (!usageDrafts.has(number)) usageDrafts.set(number, new Set(detected ? usage.sourceSlots : []));
  if (!usageViews.has(number)) usageViews.set(number, false);
  const draft = usageDrafts.get(number);
  $('show-all-label').hidden = !detected;
  $('show-all-filaments').checked = usageViews.get(number);
  const evidenceNote = detected ? 'From saved slice metadata; confirm usage. Saved metadata can be stale. ' : 'Plate usage is unresolved, so all project palette entries are shown. ' ;
  $('usage-warning').textContent = evidenceNote + extracted.warnings.join(' ');
  $('usage-status').textContent = confirmedPlates.has(number) ? `Source filaments confirmed for plate ${number}.` : detected ? `Confirm the detected source filaments for plate ${number}, or show all project filaments to adjust them.` : `Select the palette entries used on plate ${number}, then confirm. No material usage has been assumed.`;
  $('confirm-usage').disabled = !canConfirmUsage(draft);
  const visibleSlots = detected && !usageViews.get(number) ? new Set([...usage.sourceSlots, ...draft]) : null;
  for (const filament of extracted.palette.filter((f) => !visibleSlots || visibleSlots.has(f.sourceSlot))) {
    const label = element('label', undefined, 'palette-choice');
    const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.value = filament.sourceSlot; checkbox.dataset.paletteSlot = filament.sourceSlot;
    checkbox.checked = draft.has(filament.sourceSlot); checkbox.disabled = !filament.selectable;
    const description = `Source slot ${filament.sourceSlot} · ${filament.material || 'Unknown material'}`;
    label.append(checkbox, element('span', description), colorLabel(filament.color));
    if (!filament.selectable) label.append(element('span', filament.unavailableReason, 'hint'));
    checkbox.onchange = () => {
      if (checkbox.checked) draft.add(filament.sourceSlot); else draft.delete(filament.sourceSlot);
      confirmedPlates.delete(number); selections.delete(number);
      for (const controller of searches) controller.abort(); searches.clear();
      $('filaments').replaceChildren();
      $('confirm-usage').disabled = !canConfirmUsage(draft);
      $('usage-status').textContent = `Confirm the selected source filaments for plate ${number}.`;
      invalidatePreview();
    };
    $('source-palette').append(label);
  }
}
$('show-all-filaments').onchange = () => { usageViews.set(Number($('plate').value), $('show-all-filaments').checked); renderUsage(); };
$('confirm-usage').onclick = () => {
  if (!extracted) return;
  const number = Number($('plate').value); const draft = usageDrafts.get(number);
  if (!draft || !canConfirmUsage(draft)) return;
  const filaments = extracted.palette.filter((f) => f.selectable && draft?.has(f.sourceSlot)).map(({ sourceSlot, name, material, color }) => ({ sourceSlot, name, material, color }));
  if (!filaments.length) return;
  confirmedPlates.set(number, { number, filaments }); selections.delete(number);
  placementHints.delete(number);
  renderFilaments();
};
async function inspectSelectedFile() {
  resetProject();
  const file = $('file').files[0];
  if (!file) { if (bundled) { $('manifest').value = JSON.stringify({ plates: bundled.plates }, null, 2); showProject(bundled); } return; }
  const generation = sourceGeneration;
  const controller = new AbortController(); extractionController = controller;
  try {
    if (!/\.3mf$/i.test(file.name) || !file.size) throw new Error('Choose a nonempty .3mf project');
    if (file.size > 16 * 1024 * 1024 - 65536) throw new Error('Choose a 3MF smaller than 16 MiB including form data');
    const body = new FormData(); body.set('file', file);
    const data = await api('/project-data/inspect', { method: 'POST', body, signal: controller.signal });
    if (generation !== sourceGeneration || controller.signal.aborted) return;
    showExtracted(data);
  } catch (error) {
    if (generation !== sourceGeneration || controller.signal.aborted) return;
    unavailablePlate('Cannot read this project');
    $('extraction-error').textContent = error.message;
    $('project-summary').textContent = 'No plate data was accepted. Select a supported project or supply known data under Advanced.';
    updateButtons();
  } finally { if (extractionController === controller) extractionController = null; }
}
function renderFilaments() {
  for (const controller of searches) controller.abort();
  searches.clear();
  $('filaments').replaceChildren();
  renderUsage();
  const selectedPlate = plate();
  if (!selectedPlate) { invalidatePreview(); return; }
  for (const source of selectedPlate.filaments) renderFilament(source, selectedPlate.number);
  invalidatePreview();
}
function renderFilament(source, plateNumber) {
  const row = element('div', undefined, 'mapping');
  row.dataset.sourceSlot = source.sourceSlot;
  const heading = element('h3', `${source.name ?? 'Project filament'} · source slot ${source.sourceSlot}`);
  const sourceLine = element('p', undefined, 'source-line');
  sourceLine.append(element('span', `Source: ${source.material}`), colorLabel(source.color));
  const selected = element('p', undefined, 'selection');
  function showSelection() {
    const value = selections.get(plateNumber)?.get(source.sourceSlot);
    selected.replaceChildren();
    if (!value) { selected.textContent = 'No Hive requirement selected'; return; }
    selected.append(element('span', `Requirement: ${value.brand ?? ''} ${value.name} · ${value.materialType}`), colorLabel(value.color), element('span', `${value.sku ? `SKU ${value.sku} · ` : ''}ID ${value.id}`));
  }
  showSelection();
  if (!placementHints.has(plateNumber)) placementHints.set(plateNumber, new Map());
  const hints = placementHints.get(plateNumber), hint = hints.get(source.sourceSlot) ?? { ams: '', slot: '' };
  const placement = element('details'); placement.append(element('summary', 'Optional placement on a named printer'));
  placement.append(element('p', 'Enter API AMS and slot indices only when you know the physical destination. Source slot indices never determine placement. Leave both empty for Hive to resolve it.', 'hint'));
  const placementFields = element('div', undefined, 'pair');
  for (const [key, title, max] of [['ams', 'API AMS ID', 255], ['slot', 'API slot ID', 3]]) {
    const label = element('label', title), field = element('input'); field.type = 'number'; field.min = '0'; field.max = String(max); field.step = '1'; field.value = hint[key];
    field.id = `target-${key}-${plateNumber}-${source.sourceSlot}`; field.dataset.targetInput = ''; field.disabled = !$('printer').value.trim();
    field.setAttribute('aria-label', `${title} for source slot ${source.sourceSlot}`);
    field.oninput = () => { hint[key] = field.value; hints.set(source.sourceSlot, hint); invalidatePreview(); };
    label.append(field); placementFields.append(label);
  }
  placement.append(placementFields);
  const label = element('label', 'Find a Hive filament by name, SKU, or ID');
  const input = element('input'); input.type = 'search'; input.maxLength = 100; input.value = source.material; input.id = `search-${plateNumber}-${source.sourceSlot}`; label.htmlFor = input.id;
  const search = element('button', 'Search', 'secondary'); search.type = 'button';
  const status = element('p', '', 'hint'); status.setAttribute('role', 'status');
  const results = element('div', undefined, 'catalog-results');
  const navigation = element('div', undefined, 'pair');
  const previous = element('button', 'Previous', 'secondary'); previous.type = 'button';
  const next = element('button', 'More results', 'secondary'); next.type = 'button';
  navigation.append(previous, next); navigation.hidden = true;
  let requestVersion = 0;
  let controller;
  let offset = 0;
  let query = '';
  async function find(newOffset = 0) {
    const version = ++requestVersion;
    controller?.abort();
    controller = new AbortController(); searches.add(controller);
    const own = controller;
    offset = newOffset;
    query = input.value.trim();
    status.textContent = 'Searching Hive’s catalog…'; results.replaceChildren(); navigation.hidden = true;
    try {
      const data = await api(`/catalog?${new URLSearchParams({ q: query, offset: String(offset) })}`, { signal: controller.signal });
      if (version !== requestVersion || !row.isConnected || Number($('plate').value) !== plateNumber) return;
      status.textContent = data.materials.length ? `${data.total} results · showing ${data.offset + 1}–${data.offset + data.materials.length}` : 'No matching catalog filaments. Try a name, SKU, or ID.';
      for (const item of data.materials) {
        const card = element('div', undefined, 'catalog-item');
        const characteristics = element('div', undefined, 'catalog-characteristics');
        characteristics.append(element('span', item.materialType || 'Unknown material'), colorLabel(item.color));
        if (item.sku) characteristics.append(element('span', `SKU ${item.sku}`));
        card.append(element('strong', `${item.brand ?? ''} ${item.name}`.trim()), characteristics, element('code', item.id));
        const use = element('button', `Use ${item.name}`, 'secondary'); use.type = 'button'; use.disabled = !item.selectable;
        use.onclick = () => {
          chosen().set(source.sourceSlot, item); showSelection(); invalidatePreview();
          for (const button of results.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === use));
        };
        use.setAttribute('aria-pressed', String(chosen().get(source.sourceSlot)?.id === item.id));
        card.append(use);
        if (!item.selectable) card.append(element('span', item.unavailableReason, 'hint'));
        results.append(card);
      }
      previous.disabled = data.offset === 0; next.disabled = !data.hasMore;
      navigation.hidden = data.total <= 20;
    } catch (error) {
      if (own.signal.aborted || version !== requestVersion) return;
      status.textContent = error.message;
    } finally { searches.delete(own); }
  }
  input.oninput = () => { requestVersion++; controller?.abort(); results.replaceChildren(); navigation.hidden = true; status.textContent = 'Press Search to find catalog filaments.'; };
  input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); find(); } };
  search.onclick = () => find(); previous.onclick = () => find(Math.max(0, offset - 20)); next.onclick = () => find(offset + 20);
  row.append(heading, sourceLine, selected, placement, label, input, search, status, results, navigation);
  $('filaments').append(row);
  find();
}
function currentInput() {
  const input = {
    id: `browser-${crypto.randomUUID()}`, plates: [Number($('plate').value)], projectData: { filename: project.filename, sha256: project.sha256, plates: [plate()] },
    mappings: plate().filaments.map((f) => {
      const hint = $('printer').value.trim() ? placementHints.get(Number($('plate').value))?.get(f.sourceSlot) : undefined;
      if (hint && ((hint.ams === '') !== (hint.slot === ''))) throw new Error(`Source slot ${f.sourceSlot}: enter both placement indices or leave both empty`);
      return { sourceSlot: f.sourceSlot, materialId: chosen().get(f.sourceSlot)?.id, ...(hint && hint.ams !== '' && hint.slot !== '' ? { targetSlot: { ams_id: Number(hint.ams), slot_id: Number(hint.slot) } } : {}) };
    }),
    release: $('release-mode').value,
    on_filament_mismatch: $('filament-mismatch').value,
    ...($('printer').value.trim() ? { printer_id: $('printer').value.trim() } : {}),
  };
  validateMappedInput(input);
  return input;
}
$('preview').onclick = async () => {
  const version = ++previewGeneration;
  $('payload').textContent = 'Resolving selected catalog requirements…';
  try {
    const input = currentInput();
    const resolved = await api('/orders/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (version !== previewGeneration) return;
    $('payload').textContent = JSON.stringify({ ...resolved, release: input.release, on_filament_mismatch: input.on_filament_mismatch, ...(input.printer_id ? { printer_id: input.printer_id } : {}) }, null, 2);
    $('payload-colors').replaceChildren(...resolved.filaments.map((f) => colorLabel(f.color, `Source slot ${f.sourceSlot} requirement`)));
  } catch (error) { if (version === previewGeneration) $('payload').textContent = error.message; }
};
$('file').onchange = inspectSelectedFile;
$('manifest-file').onchange = async () => {
  const file = $('manifest-file').files[0];
  if (!file) return;
  const generation = sourceGeneration;
  try { if (file.size > 65536) throw new Error('Project data JSON must be smaller than 64 KiB'); const text = await file.text(); if (generation !== sourceGeneration) return; $('manifest').value = text; await applyProject(); }
  catch (error) { $('project-error').textContent = error.message; }
};
$('manifest').oninput = () => { renderManifestColors(); sourceGeneration++; extractionController?.abort(); extracted = null; confirmedPlates.clear(); usageDrafts.clear(); usageViews.clear(); $('source-usage').hidden = true; for (const controller of searches) controller.abort(); searches.clear(); project = null; selections.clear(); unavailablePlate('Apply the known project data'); $('filaments').replaceChildren(); invalidatePreview(); };
$('apply-manifest').onclick = applyProject;
$('plate').onchange = renderFilaments;
$('release-mode').onchange = invalidatePreview;
$('filament-mismatch').onchange = invalidatePreview;
$('printer').oninput = () => { for (const field of document.querySelectorAll('[data-target-input]')) field.disabled = !$('printer').value.trim(); invalidatePreview(); };
function controls(receipt) {
  const terminal = ['created', 'failed', 'cancelled'].includes(receipt.status);
  $('release').hidden = !(receipt.status === 'held' && receipt.requiredActions?.some((a) => a.code === 'manual_release_required'));
  $('cancel').hidden = terminal;
  $('release').disabled = busy; $('cancel').disabled = busy;
  return terminal;
}
function renderJob(receipt) {
  const read = receipt.jobRead;
  $('job-details').hidden = receipt.status !== 'created';
  $('waiting-reasons').replaceChildren(); $('waiting-json').textContent = '[]';
  $('job-state').textContent = ''; $('job-printer').textContent = ''; $('job-read-error').textContent = ''; $('waiting-summary').textContent = '';
  if (receipt.status !== 'created') return false;
  if (read?.kind === 'missing') { $('job-read-error').textContent = 'The job is no longer available. The original creation receipt remains valid.'; return false; }
  if (read?.kind !== 'available') {
    $('job-read-error').textContent = read?.code === 'sdk_job_read_unavailable' ? 'This installed SDK cannot read jobs. Install the updated local SDK build to follow filament waiting.' : read?.code === 'job_read_forbidden' ? `Job access was refused with HTTP ${read.upstreamStatus}. Check the server API credential before refreshing. Creation succeeded; do not resubmit.` : 'The job snapshot could not be read. Creation succeeded; refresh status instead of submitting another job.';
    return shouldPollJob(read);
  }
  const job = read.job;
  $('job-state').textContent = job.status ?? 'Unknown job status';
  $('job-printer').textContent = job.printer_id ? `Assigned printer: ${job.printer_id}` : 'Smart Queue will choose the physical printer and placement.';
  const reasons = job.filament_waiting_reasons;
  const instructions = waitingFilamentInstructions(reasons);
  $('waiting-json').textContent = JSON.stringify(reasons, null, 2);
  $('waiting-summary').textContent = instructions.length ? 'Hive reports these filament loading requirements. Source slots identify project filaments; only an API-supplied target identifies a printer tray.' : job.filament_route_state === 'waiting' ? 'Hive is still resolving the material route. No loading details are available yet.' : 'No filament waiting reasons are reported. Printer readiness and claim checks still apply.';
  for (const instruction of instructions) {
    const card = element('div', undefined, 'waiting-reason');
    card.append(element('strong', instruction.source), element('p', instruction.instruction));
    if (instruction.explanation) card.append(element('p', instruction.explanation, 'waiting-cause'));
    if (instruction.color) card.append(colorLabel(instruction.color));
    card.append(element('p', instruction.placement, 'hint'), element('code', instruction.code));
    $('waiting-reasons').append(card);
  }
  return shouldPollJob(read);
}
async function poll() {
  clearTimeout(timer);
  if (!active) return;
  try {
    const order = await api(`/orders/${encodeURIComponent(active.id)}`);
    const receipt = order.plates[0];
    $('state').textContent = receipt.status; $('request-id').textContent = receipt.requestId ?? 'Awaiting receipt'; $('job-id').textContent = receipt.job?.id ?? '—';
    $('actions').textContent = JSON.stringify(receipt.requiredActions ?? [], null, 2); $('failure').textContent = receipt.error ? JSON.stringify(receipt.error, null, 2) : 'None'; $('error').textContent = '';
    renderReportedColors($('actions-colors'), receipt.requiredActions); renderReportedColors($('failure-colors'), receipt.error);
    const requestSettled = controls(receipt);
    const followJob = renderJob(receipt);
    if (!requestSettled || followJob) timer = setTimeout(poll, 1000);
  } catch (error) { $('error').textContent = `${error.message}. Status is unknown. Polling will retry.`; timer = setTimeout(poll, 3000); }
}
$('order-form').onsubmit = async (event) => {
  event.preventDefault(); if (busy || !ready) return;
  busy = true; updateButtons(); clearTimeout(timer); $('error').textContent = '';
  try {
    if (!active) {
      const input = currentInput(); const file = $('file').files[0];
      let options;
      if (file) { const body = new FormData(); body.set('order', JSON.stringify(input)); body.set('file', file); options = { method: 'POST', body }; }
      else options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, file: 'cube.3mf' }) };
      active = { id: input.id, plate: input.plates[0], options };
      updateButtons();
    }
    const accepted = await api('/orders', active.options);
    $('empty').hidden = true; $('receipt').hidden = false; $('order-id').textContent = accepted.id; $('request-id').textContent = accepted.requests[0].requestId;
    await poll(); active.options = null; $('submit').textContent = 'Start another order'; $('submit').type = 'button'; $('submit').onclick = () => location.reload();
  } catch (error) { $('error').textContent = active ? `${error.message}. Retry preserves this order ID. To change input, reload the page.` : error.message; $('submit').textContent = active ? 'Retry same order' : 'Submit order'; }
  finally { busy = false; updateButtons(); }
};
for (const action of ['release', 'cancel']) $(action).onclick = async () => {
  if (busy) return;
  busy = true; $('release').disabled = $('cancel').disabled = true; clearTimeout(timer);
  let actionError;
  try { await api(`/orders/${encodeURIComponent(active.id)}/${active.plate}/${action}`, { method: 'POST' }); }
  catch (error) { actionError = `${error.message}. Status refreshed; check before retrying this action.`; }
  finally { busy = false; await poll(); if (actionError) $('error').textContent = actionError; updateButtons(); }
};
$('refresh').onclick = poll;
Promise.all([api('/config'), api('/project-data')]).then(([config, data]) => {
  $('target').textContent = `API destination: ${config.baseUrl}${config.production ? ' · Production' : ' · Custom API'}`;
  bundled = data; ready = true;
  if (!$('file').files.length && !project) { $('manifest').value = JSON.stringify({ plates: data.plates }, null, 2); showProject(data); }
  updateButtons();
}).catch((error) => { $('target').textContent = 'Cannot load API destination and project data. Reload before submitting.'; $('error').textContent = error.message; });
