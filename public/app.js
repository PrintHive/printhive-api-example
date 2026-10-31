const $ = (id) => document.getElementById(id);
let active;
let timer;
let busy = false;
let ready = false;

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
function addFilament() {
  const row = $('filament-template').content.firstElementChild.cloneNode(true);
  row.querySelector('[data-field=sourceSlot]').value = $('filaments').children.length;
  row.querySelector('button').onclick = () => {
    row.remove();
    updateRemoveButtons();
  };
  $('filaments').append(row);
  updateRemoveButtons();
}
function updateRemoveButtons() {
  for (const button of $('filaments').querySelectorAll('button'))
    button.disabled = $('filaments').children.length === 1;
}
function controls(receipt) {
  const terminal = ['created', 'failed', 'cancelled'].includes(receipt.status);
  $('release').hidden = !(receipt.status === 'held' && receipt.requiredActions?.some((a) => a.code === 'manual_release_required'));
  $('cancel').hidden = terminal;
  $('release').disabled = busy;
  $('cancel').disabled = busy;
  return terminal;
}
async function poll() {
  clearTimeout(timer);
  if (!active) return;
  try {
    const order = await api(`/orders/${encodeURIComponent(active.id)}`);
    const receipt = order.plates[0];
    $('state').textContent = receipt.status;
    $('request-id').textContent = receipt.requestId ?? 'Awaiting receipt';
    $('job-id').textContent = receipt.job?.id ?? '—';
    $('actions').textContent = JSON.stringify(receipt.requiredActions ?? [], null, 2);
    $('failure').textContent = receipt.error ? JSON.stringify(receipt.error, null, 2) : 'None';
    $('error').textContent = '';
    if (!controls(receipt)) timer = setTimeout(poll, 1000);
  } catch (error) {
    $('error').textContent = `${error.message}. Status is unknown. Polling will retry.`;
    timer = setTimeout(poll, 3000);
  }
}
$('add-filament').onclick = addFilament;
addFilament();
$('order-form').onsubmit = async (event) => {
  event.preventDefault();
  if (busy || !ready) return;
  busy = true;
  $('submit').disabled = true;
  clearTimeout(timer);
  $('error').textContent = '';
  // Retain the same ID on an uncertain submission, so Retry cannot create a duplicate.
  if (!active) {
    const input = {
      id: `browser-${crypto.randomUUID()}`,
      plates: [Number($('plate').value)],
      filaments: [...$('filaments').children].map((row) => ({
        sourceSlot: Number(row.querySelector('[data-field=sourceSlot]').value),
        material: row.querySelector('[data-field=material]').value.trim(),
        color: row.querySelector('[data-field=color]').value,
      })),
      release: $('release-mode').value,
      ...($('printer').value.trim() ? { printer_id: $('printer').value.trim() } : {}),
    };
    const file = $('file').files[0];
    if (file && file.size > 16 * 1024 * 1024 - 65536) {
      $('error').textContent = 'File too large. Choose a 3MF smaller than 16 MiB including form data.';
      busy = false;
      $('submit').disabled = false;
      return;
    }
    let options;
    if (file) {
      const body = new FormData();
      body.set('order', JSON.stringify(input));
      body.set('file', file);
      options = { method: 'POST', body };
    } else options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, file: 'cube.3mf' }) };
    active = { id: input.id, plate: input.plates[0], options };
  }
  try {
    const accepted = await api('/orders', active.options);
    $('empty').hidden = true;
    $('receipt').hidden = false;
    $('order-id').textContent = accepted.id;
    $('request-id').textContent = accepted.requests[0].requestId;
    await poll();
    active.options = null;
    $('submit').textContent = 'Start another order';
    // Starting another order is explicit; the current one keeps polling until then.
    $('submit').type = 'button';
    $('submit').onclick = () => location.reload();
  } catch (error) {
    $('error').textContent = `${error.message}. Retry preserves this order ID. To change the input, reload the page.`;
    $('submit').textContent = 'Retry same order';
  } finally {
    busy = false;
    $('submit').disabled = false;
  }
};
for (const action of ['release', 'cancel']) {
  $(action).onclick = async () => {
    if (busy) return;
    busy = true;
    $('release').disabled = $('cancel').disabled = true;
    clearTimeout(timer);
    let actionError;
    try {
      await api(`/orders/${encodeURIComponent(active.id)}/${active.plate}/${action}`, { method: 'POST' });
    } catch (error) {
      actionError = `${error.message}. Status refreshed; check it before retrying this action.`;
    } finally {
      busy = false;
      await poll();
      if (actionError) $('error').textContent = actionError;
    }
  };
}
$('refresh').onclick = poll;
api('/config').then((config) => {
  $('target').textContent = `API destination: ${config.baseUrl}${config.production ? ' · Production' : ' · Custom API'}`;
  ready = true;
  $('submit').disabled = false;
}).catch(() => { $('target').textContent = 'Cannot load API destination. Reload before submitting.'; });
