import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename } from "node:fs/promises";
import { join, basename } from "node:path";
import { PrintJobCreateStoppedError } from "@printhive/api";
import { resolveMappedInput, validateMappedInput, validateTargetSlot } from "./project-data.mjs";
import { readCreatedJob } from "./job-status.mjs";

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
    new Set(order.filaments.map((f) => f?.sourceSlot)).size !== order.filaments.length ||
    !order.filaments.every(
      (f) =>
        f &&
        Number.isInteger(f.sourceSlot) &&
        f.sourceSlot >= 0 &&
        f.sourceSlot <= 255 &&
        typeof f.material === "string" &&
        f.material.length > 0 &&
        /^#[a-fA-F0-9]{6}$/.test(f.color),
    ) ||
    (order.printer_id !== undefined &&
      (typeof order.printer_id !== "string" || !order.printer_id.trim())) ||
    (order.release !== undefined &&
      !["manual", "automatic"].includes(order.release)) ||
    (order.on_filament_mismatch !== undefined && !["wait", "reject"].includes(order.on_filament_mismatch))
  ) {
    throw new Error(
      "Invalid order: supply id, file, unique positive plates, and typed filaments",
    );
  }
  for (const filament of order.filaments) validateTargetSlot(filament.targetSlot);
  return order;
}

// One process owns this directory. Calls serialize, including concurrent HTTP retries.
// Each immutable intent includes a private copy of the source bytes.
export function createOrders(hive, directory = "data", onReceipt = () => {}, catalog) {
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
    const mapped = input?.projectData !== undefined || input?.mappings !== undefined;
    if (mapped) validateMappedInput(input);
    else validateOrder(input);
    const bytes = await readFile(input.file);
    if (mapped) {
      const { projectData, mappings, targetSlots } = validateMappedInput(input);
      if (createHash("sha256").update(bytes).digest("hex") !== projectData.sha256 || basename(input.file) !== projectData.filename)
        throw new Error("Project data belongs to a different file");
      let saved;
      try { saved = await load(input.id); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (saved) {
        const sort = (entries) => entries.sort(([left], [right]) => left - right);
        const placement = (target) => target ? [target.ams_id, target.slot_id] : null;
        const retained = saved.intent.catalogSelections?.map(({ sourceSlot, id }) => [sourceSlot, id.toLowerCase(), placement(saved.intent.filaments.find((f) => f.sourceSlot === sourceSlot)?.targetSlot)]);
        const requested = [...mappings].map(([slot, id]) => [slot, id.toLowerCase(), placement(targetSlots.get(slot))]);
        if (!retained || JSON.stringify(sort(retained)) !== JSON.stringify(sort(requested)))
          throw new Error("Order id conflicts with stored intent");
        input = { ...input, projectData, filaments: saved.intent.filaments, catalogSelections: saved.intent.catalogSelections };
      } else {
        if (!catalog) throw new Error("Hive catalog is unavailable");
        input = await resolveMappedInput(input, catalog);
      }
    }
    const order = validateOrder(input);
    const intent = {
      filename: basename(order.file),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      plates: order.plates,
      filaments: order.filaments,
      ...(order.projectData ? { projectData: order.projectData, catalogSelections: order.catalogSelections } : {}),
      release: order.release ?? "automatic",
      on_filament_mismatch: order.on_filament_mismatch ?? "wait",
      ...(order.printer_id ? { printer_id: order.printer_id } : {}),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let record;
    try {
      record = await load(order.id);
      const comparable = ({ on_filament_mismatch, ...value }) => ({ ...value, on_filament_mismatch: on_filament_mismatch ?? "wait" });
      if (JSON.stringify(comparable(record.intent)) !== JSON.stringify(comparable(intent)))
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
        filename: record.intent.filename,
        plate: item.plate,
        filaments: record.intent.filaments,
        release: record.intent.release,
        ...(record.intent.on_filament_mismatch ? { on_filament_mismatch: record.intent.on_filament_mismatch } : {}),
        ...(record.intent.printer_id ? { printer_id: record.intent.printer_id } : {}),
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
          record.plates.map(async (item) => {
            const receipt = item.requestId ? await hive.printJobs.getCreateRequest(item.requestId) : { status: "pending_submission" };
            return { plate: item.plate, ...receipt, jobRead: await readCreatedJob(hive, receipt) };
          }),
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
