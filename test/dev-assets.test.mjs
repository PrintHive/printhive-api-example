import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

test("Vite serves the React entry and shared browser helpers without exposing order storage or backend source", async (t) => {
  await mkdir(resolve("data"), { recursive: true });
  const directory = await mkdtemp(resolve("data/dev-boundary-"));
  const marker = "OWNED-PRIVATE-VITE-BOUNDARY-CANARY";
  await writeFile(join(directory, "order.json"), marker);
  await writeFile(join(directory, "upload.3mf"), marker);
  const server = await createServer({
    envFile: false,
    logLevel: "silent",
    server: { port: 0, strictPort: false, host: "127.0.0.1" },
  });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const entry = await fetch(base);
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /main\.tsx/);
  assert.equal((await fetch(base + "/mark.svg")).status, 200);
  for (const file of ["order.json", "upload.3mf"]) {
    for (const path of [
      `/data/${directory.split("/").at(-1)}/${file}`,
      `/@fs${directory}/${file}`,
    ]) {
      const response = await fetch(base + path);
      assert.ok(
        [403, 404].includes(response.status),
        `${path} must be refused`,
      );
      assert.equal((await response.text()).includes(marker), false);
    }
  }
  for (const file of ["client.mjs", "server.mjs", "orders.mjs"])
    assert.equal(
      (await fetch(base + "/@fs" + resolve("src", file))).status,
      403,
    );
  for (const file of ["project-data.mjs", "job-status.mjs"])
    assert.equal(
      (await fetch(base + "/@fs" + resolve("src", file))).status,
      200,
    );
});

test('dev proxy supports the local session and rewrites Host while checking browser Origin', async t => {
  const { createOrderServer } = await import('../src/server.mjs');
  const { once } = await import('node:events');
  const backend = createOrderServer({ hive: {}, browserOrigin: 'http://127.0.0.1:5173' });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const previous = process.env.API_PORT;
  process.env.API_PORT = String(backend.address().port);
  const vite = await createServer({ envFile: false, logLevel: 'silent', server: { port: 0, strictPort: false } });
  t.after(async () => {
    await vite.close(); backend.closeAllConnections(); backend.close();
    if (previous === undefined) delete process.env.API_PORT; else process.env.API_PORT = previous;
  });
  await vite.listen();
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { token } = await (await fetch(url + '/session')).json();
  assert.match(token, /^[a-f0-9]{64}$/);
  const response = await fetch(url + '/config', { headers: { 'x-printhive-session': token, Origin: 'http://127.0.0.1:5173' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sdk.version, '0.6.0');
  assert.equal((await fetch(url + '/config')).status, 403);
  assert.equal((await fetch(url + '/session', { headers: { Origin: 'https://example.invalid' } })).status, 403);
});
