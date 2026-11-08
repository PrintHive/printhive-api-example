import { readFileSync } from "node:fs";
import { PrintHive } from "@printhive/api";
import { createCatalog } from "./catalog.mjs";
export function clientFromEnv() {
  let apiKey;
  if (process.env.PRINTHIVE_API_KEY_FILE) {
    try { apiKey = readFileSync(process.env.PRINTHIVE_API_KEY_FILE, "utf8").trim(); }
    catch { throw new Error("Cannot read PRINTHIVE_API_KEY_FILE"); }
  } else apiKey = process.env.PRINTHIVE_API_KEY?.trim();
  if (!apiKey) throw new Error("Set PRINTHIVE_API_KEY_FILE or PRINTHIVE_API_KEY on the server");
  const baseUrl =
    process.env.PRINTHIVE_BASE_URL ?? "https://api.printhiv3d.com";
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error("Use HTTPS or a loopback development API");
  }
  const hive = new PrintHive({ apiKey, baseUrl });
  async function control(requestId, action) {
    if (action === "release") return hive.printJobs.releaseCreateRequest(requestId);
    if (action === "cancel") return hive.printJobs.cancelCreateRequest(requestId);
    throw new Error("Invalid action");
  }
  return { hive, control, catalog: createCatalog(hive) };
}
