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
