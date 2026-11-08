import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrintJobCreateStoppedError } from "@printhive/api";
import { createOrders, waitForJob } from "../src/orders.mjs";

async function setup(t, create) {
  const dir = await mkdtemp(join(tmpdir(), "orders-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "cube.3mf");
  await writeFile(file, "synthetic test bytes");
  const order = {
    id: "test",
    file,
    plates: [1, 2],
    filaments: [{ sourceSlot: 0, material: "PETG", color: "#112233" }],
  };
  const hive = {
    printJobs: {
      create,
      getCreateRequest: async (requestId) => ({
        requestId,
        status: "preparing",
      }),
    },
  };
  return { dir, order, hive, orders: createOrders(hive, dir) };
}
test("one durable key per plate; no printer required; concurrent retries do not duplicate", async (t) => {
  const calls = [];
  const s = await setup(t, async (input) => {
    const saved = JSON.parse(await readFile(join(s.dir, "test.json"), "utf8"));
    assert(saved.plates.some((p) => p.idempotencyKey === input.idempotencyKey));
    assert.equal(await readFile(input.file, "utf8"), "synthetic test bytes");
    calls.push(input);
    return { requestId: `request-${input.plate}` };
  });
  await Promise.all([s.orders.submit(s.order), s.orders.submit(s.order)]);
  assert.deepEqual(
    calls.map((c) => c.plate),
    [1, 2],
  );
  assert.equal(new Set(calls.map((c) => c.idempotencyKey)).size, 2);
  assert.equal("printer_id" in calls[0], false);
  assert.equal(calls[0].release, "manual");
  assert.deepEqual(
    (await s.orders.status("test")).plates.map((p) => p.status),
    ["preparing", "preparing"],
  );
});
test("lost response survives restart with same key and original bytes", async (t) => {
  const calls = [];
  const s = await setup(t, async (input) => {
    calls.push(input);
    throw new Error("response lost");
  });
  await assert.rejects(s.orders.submit(s.order));
  const restarted = createOrders(
    {
      printJobs: {
        create: async (input) => {
          calls.push(input);
          return { requestId: `request-${input.plate}` };
        },
      },
    },
    s.dir,
  );
  await restarted.submit(s.order);
  assert.deepEqual(calls.map(call => call.plate), [1, 2, 1, 2]);
  assert.equal(calls[0].idempotencyKey, calls[2].idempotencyKey);
  assert.equal(calls[1].idempotencyKey, calls[3].idempotencyKey);
  await assert.rejects(
    restarted.submit({ ...s.order, printer_id: "changed" }),
    /conflicts/,
  );
  await writeFile(s.order.file, "changed bytes");
  await assert.rejects(restarted.submit(s.order), /conflicts/);
});
test("printer and manual authorization map to every plate", async (t) => {
  const calls = [];
  const s = await setup(t, async (input) => {
    calls.push(input);
    return { requestId: String(input.plate) };
  });
  await s.orders.submit({
    ...s.order,
    printer_id: "mock-printer",
    release: "manual",
  });
  assert(
    calls.every(
      (c) => c.printer_id === "mock-printer" && c.release === "manual",
    ),
  );
});
for (const status of ["held", "failed", "cancelled"]) {
  test(`SDK polling exposes ${status} receipt`, async () => {
    const receipt = {
      requestId: "00000000-0000-4000-8000-000000000001",
      status,
      requiredActions:
        status === "held" ? [{ code: "project_review_required" }] : [],
      job: null,
      failure: status === "failed" ? { code: "slice_failed" } : null,
    };
    const hive = {
      printJobs: {
        waitUntilCreated: async () => {
          throw new PrintJobCreateStoppedError(receipt);
        },
      },
    };
    assert.deepEqual(await waitForJob(hive, receipt.requestId), receipt);
  });
}
test("created with deleted job is retained receipt; network timeout stays unsettled", async () => {
  const receipt = { status: "created", job: null };
  assert.deepEqual(
    await waitForJob(
      { printJobs: { waitUntilCreated: async () => receipt } },
      "r",
    ),
    receipt,
  );
  await assert.rejects(
    waitForJob(
      {
        printJobs: {
          waitUntilCreated: async () => {
            throw new Error("timeout");
          },
        },
      },
      "r",
    ),
    /timeout/,
  );
});
test("invalid plates fail before a call", async (t) => {
  const s = await setup(t, () => assert.fail("must not submit"));
  await assert.rejects(
    s.orders.submit({ ...s.order, plates: [1, 1] }),
    /Invalid order/,
  );
});

test("registry SDK sends multipart and raises stopped errors through real polling", async () => {
  const { PrintHive } = await import("@printhive/api");
  const id = "00000000-0000-4000-8000-000000000001";
  const receipt = {
    requestId: id,
    status: "held",
    externalId: null,
    createdAt: "2026-01-01T00:00:00Z",
    job: null,
    requiredActions: [{ code: "manual_release_required" }],
    error: null,
  };
  let calls = 0;
  const hive = new PrintHive({
    apiKey: "test-only",
    baseUrl: "http://127.0.0.1:1",
    maxRetries: 0,
    fetch: async (url, init) => {
      calls++;
      if (init.method === "POST") {
        assert(init.body instanceof FormData);
        assert.equal(init.body.get("plate"), "1");
        assert.equal(init.body.get("release"), "manual");
        assert.equal(init.headers.get("Idempotency-Key"), "saved-before-call");
        return Response.json(
          { ...receipt, status: "preparing" },
          { status: 202 },
        );
      }
      return Response.json(receipt);
    },
  });
  const accepted = await hive.printJobs.create({
    file: new Uint8Array([1, 2, 3]),
    filename: "test.3mf",
    plate: 1,
    filaments: [{ sourceSlot: 0, material: "PETG", color: "#112233" }],
    release: "manual",
    idempotencyKey: "saved-before-call",
  });
  assert.equal(accepted.requestId, id);
  assert.deepEqual(await waitForJob(hive, id), receipt);
  assert.equal(calls, 2);
});
