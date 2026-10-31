import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// A local protocol stub. It never creates a printer connection or calls Hive.
export function fakeApi() {
  const requests = new Map();
  const events = [];
  const server = createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers['x-api-key'] !== 'ui-proof-dummy') return reply(401, { error: 'Dummy key required' });
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
      if (req.method === 'POST' && req.url === '/v1/print-jobs/create') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
        if (!form.get('file')?.size || !form.get('plate') || !form.get('filaments')) return reply(400, { error: 'Missing SDK multipart fields' });
        const requestId = randomUUID();
        const record = { requestId, status: 'preparing', externalId: null, createdAt: new Date().toISOString(), job: null, requiredActions: [], error: null };
        requests.set(requestId, { record, manual: form.get('release') === 'manual', since: Date.now(), printer: form.get('printer_id') });
        events.push({ event: 'submit', release: form.get('release'), plate: form.get('plate'), filename: form.get('file').name });
        return reply(202, record);
      }
      const item = requests.get(parts[3]);
      if (!item) return reply(404, { error: 'Unknown request' });
      if (req.method === 'POST' && parts[4] === 'cancel') {
        item.record.status = 'cancelled'; item.record.requiredActions = [];
      } else if (req.method === 'POST' && parts[4] === 'release') {
        item.manual = false; item.since = Date.now(); item.record.status = 'preparing'; item.record.requiredActions = [];
      } else if (req.method === 'GET' && item.record.status === 'preparing' && Date.now() - item.since > 3000) {
        item.record.status = item.manual ? 'held' : 'created';
        item.record.requiredActions = item.manual ? [{ code: 'manual_release_required' }] : [];
        if (!item.manual) item.record.job = { id: 100 + requests.size, status: 'queued', model_file_id: null, printer_id: item.printer || null, print_options: null };
      }
      events.push({ event: parts[4] ?? 'poll', status: item.record.status });
      reply(200, item.record);
    } catch { reply(400, { error: 'Invalid fake API request' }); }
  });
  return { server, events };
}
