import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join, basename } from "node:path";
import { PrintJobCreateStoppedError } from "@printhive/api";

export function validateOrder(order) {
  if (
    !order ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(order.id ?? "") ||
    typeof order.file !== "string" ||
    !Array.isArray(order.plates) ||
    !order.plates.length ||
    new Set(order.plates).size !== order.plates.length ||
    !order.plates.every((p) => Number.isInteger(p) && p > 0) ||
    !Array.isArray(order.filaments) ||
    !order.filaments.length ||
    !order.filaments.every(
      (f) =>
        f &&
        Number.isInteger(f.sourceSlot) &&
        f.sourceSlot >= 0 &&
        typeof f.material === "string" &&
        f.material.length > 0 &&
        /^#[a-fA-F0-9]{6}$/.test(f.color),
    ) ||
    (order.printer_id !== undefined &&
      (typeof order.printer_id !== "string" || !order.printer_id.trim())) ||
    (order.release !== undefined &&
      !["manual", "automatic"].includes(order.release))
  ) {
    throw new Error(
      "Invalid order: supply id, file, unique positive plates, and typed filaments",
    );
  }
  return order;
}

// One process owns this directory. Calls serialize, including concurrent HTTP retries.
// Each immutable intent includes a private copy of the source bytes.
export function createOrders(hive, directory = "data", onReceipt = () => {}) {
  let queue = Promise.resolve();
  const path = (id) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid order id");
    return join(directory, `${id}.json`);
  };
  async function load(id) {
    return JSON.parse(await readFile(path(id), "utf8"));
  }
  async function save(record) {
    const target = path(record.id);
    const temporary = `${target}.tmp`;
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(record, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async function submit(input) {
    const order = validateOrder(input);
    const bytes = await readFile(order.file);
    const intent = {
      filename: basename(order.file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      plates: order.plates,
      filaments: order.filaments,
      release: order.release ?? "automatic",
      ...(order.printer_id ? { printer_id: order.printer_id } : {}),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let record;
    try {
      record = await load(order.id);
      if (JSON.stringify(record.intent) !== JSON.stringify(intent))
        throw new Error("Order id conflicts with stored intent");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const source = join(directory, `${order.id}.3mf`);
      const f = await open(source, "w", 0o600);
      try {
        await f.writeFile(bytes);
        await f.sync();
      } finally {
        await f.close();
      }
      record = {
        id: order.id,
        intent,
        source,
        plates: intent.plates.map((plate) => ({
          plate,
          idempotencyKey: randomUUID(),
        })),
      };
      await save(record); // Durable keys BEFORE any outbound call.
    }
    for (const item of record.plates) {
      if (item.requestId) continue;
      const receipt = await hive.printJobs.create({
        file: record.source,
        filename: intent.filename,
        plate: item.plate,
        filaments: intent.filaments,
        release: intent.release,
        ...(intent.printer_id ? { printer_id: intent.printer_id } : {}),
        idempotencyKey: item.idempotencyKey,
      });
      item.requestId = receipt.requestId;
      onReceipt(receipt);
      await save(record);
    }
    return record;
  }
  return {
    submit(input) {
      const result = queue.then(() => submit(input));
      queue = result.catch(() => {});
      return result;
    },
    async status(id) {
      const record = await load(id);
      return {
        id,
        plates: await Promise.all(
          record.plates.map(async (item) => ({
            plate: item.plate,
            ...(item.requestId
              ? await hive.printJobs.getCreateRequest(item.requestId)
              : { status: "pending_submission" }),
          })),
        ),
      };
    },
  };
}

export async function waitForJob(hive, requestId, options) {
  try {
    return await hive.printJobs.waitUntilCreated(requestId, options);
  } catch (error) {
    if (error instanceof PrintJobCreateStoppedError) return error.request;
    throw error; // A timeout or transport error is unsettled, never success.
  }
}
