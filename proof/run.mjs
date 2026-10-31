import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrintHive } from "@printhive/api";
import { createOrders, waitForJob } from "../src/orders.mjs";
import { clientFromEnv } from "../src/client.mjs";
const url = new URL(process.env.PRINTHIVE_BASE_URL);
assert(
  ["127.0.0.1", "localhost"].includes(url.hostname),
  "Proof requires an owned loopback stack",
);
assert(process.env.MOCK_PRINTER_ID, "Supply a mock-only printer fixture");
const log = (value) => console.log(JSON.stringify(value));
const hive = new PrintHive({
  apiKey: process.env.PRINTHIVE_API_KEY,
  baseUrl: url.href,
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    const body = await response.clone().json();
    log({
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      http: response.status,
      requestId: body.requestId,
      status: body.status,
      job: body.job
        ? {
            id: body.job.id,
            printer_id: body.job.printer_id,
            status: body.job.status,
          }
        : undefined,
      requiredActions: body.requiredActions,
      error: body.error,
    });
    return response;
  },
});
const { control } = clientFromEnv();
const directory = await mkdtemp(join(tmpdir(), "sample-proof-"));
const orders = createOrders(hive, directory);
const base = {
  file: "fixtures/cube.3mf",
  plates: [1],
  filaments: [{ sourceSlot: 0, material: "PETG", color: "#39FF14" }],
  printer_id: process.env.MOCK_PRINTER_ID,
};
async function submit(name, extra = {}) {
  const order = { ...base, ...extra, id: `${name}-${randomUUID()}` };
  const saved = await orders.submit(order);
  const replay = await createOrders(hive, directory).submit(order);
  assert.equal(replay.plates[0].requestId, saved.plates[0].requestId);
  log({
    check: "restart replay",
    order: name,
    requestId: saved.plates[0].requestId,
  });
  return saved.plates[0].requestId;
}
async function wait(id) {
  return waitForJob(hive, id, { intervalMs: 1000, timeoutMs: 300000 });
}
const failures = [];
let backend;
async function submitThroughBackend() {
  const httpDirectory = join(directory, "http");
  backend = spawn(process.execPath, ["src/server.mjs"], {
    env: { ...process.env, PORT: "0", ORDER_DATA_DIR: httpDirectory },
    stdio: ["ignore", "pipe", "ignore"],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Proof backend startup timed out")),
      20000,
    );
    backend.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(chunk.toString()).port);
      } catch (error) {
        reject(error);
      }
    });
    backend.once("error", reject);
    backend.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Proof backend exited"));
    });
  });
  const backendUrl = `http://127.0.0.1:${port}`;
  const input = { ...base, id: `http-${randomUUID()}`, file: "cube.3mf" };
  const send = () =>
    fetch(`${backendUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const response = await send();
  const body = await response.json();
  log({ check: "POST /orders", http: response.status, ...body });
  assert.equal(response.status, 202, JSON.stringify(body));
  assert.deepEqual(await (await send()).json(), body);
  const status = await fetch(`${backendUrl}/orders/${input.id}`);
  assert.equal(status.status, 200);
  log({ check: "GET /orders", ...(await status.json()) });
  return body.requests[0].requestId;
}
try {
  const automatic = await submitThroughBackend();
  const result = await wait(automatic);
  if (result.status !== "created")
    failures.push({ scenario: "automatic", receipt: result });
  else {
    assert(result.job?.id);
    assert.equal(result.job.printer_id, base.printer_id);
  }
  log({
    check: `automatic ${result.status === "created" ? "PASS" : "FAIL"}`,
    requestId: automatic,
    jobId: result.job?.id,
    mockPrinterId: result.job?.printer_id,
  });
  const manual = await submit("manual", { release: "manual" });
  const held = await wait(manual);
  if (held.status === "held") {
    assert(held.requiredActions.length);
    log({
      check: "manual held PASS",
      requestId: manual,
      requiredActions: held.requiredActions,
    });
    log({
      check: "release",
      requestId: manual,
      response: await control(manual, "release"),
    });
    const released = await wait(manual);
    if (released.status !== "created")
      failures.push({ scenario: "manual released", receipt: released });
    log({
      check: `manual released ${released.status === "created" ? "PASS" : "FAIL"}`,
      requestId: manual,
      jobId: released.job?.id,
    });
  } else failures.push({ scenario: "manual hold", receipt: held });
  const cancelled = await submit("cancel", { release: "manual" });
  log({
    check: "cancel",
    requestId: cancelled,
    response: await control(cancelled, "cancel"),
  });
  assert.equal((await wait(cancelled)).status, "cancelled");
  log({ check: "cancelled PASS", requestId: cancelled });
  // No explicit printer: slicing uses the project's qualified model; Smart Queue owns later assignment.
  const queued = await submit("smart-queue", { printer_id: undefined });
  const queueResult = await wait(queued);
  if (queueResult.status !== "created")
    failures.push({ scenario: "optional printer", receipt: queueResult });
  else assert.equal(queueResult.job.printer_id, null);
  log({
    check: `optional printer ${queueResult.status === "created" ? "PASS" : "FAIL"}`,
    requestId: queued,
    jobId: queueResult.job?.id,
  });
  if (failures.length) {
    log({ result: "FAIL", failures });
    process.exitCode = 1;
  } else
    log({
      result: "PASS",
      scope:
        "Job creation and queue admission only. No printer connection or motion.",
    });
} finally {
  if (backend && backend.exitCode === null) {
    backend.kill("SIGTERM");
    await new Promise((resolve) => backend.once("exit", resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
