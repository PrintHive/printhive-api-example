import { PrintHive } from "@printhive/api";
import { createCatalog } from "./catalog.mjs";
export function clientFromEnv() {
  const apiKey = process.env.PRINTHIVE_API_KEY;
  if (!apiKey) throw new Error("Set PRINTHIVE_API_KEY on the server");
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
  // SDK 0.2.0 has no release/cancel helpers. Keep credentials on this backend.
  async function control(requestId, action) {
    if (!["release", "cancel"].includes(action))
      throw new Error("Invalid action");
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/print-jobs/create-requests/${encodeURIComponent(requestId)}/${action}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { "x-api-key": apiKey },
      },
    );
    if (!response.ok)
      throw new Error(
        `Print Hive ${action} returned HTTP ${response.status}; read request status before retrying`,
      );
    return response.json();
  }
  return { hive, control, catalog: createCatalog({ baseUrl, apiKey }) };
}
