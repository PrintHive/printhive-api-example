import { engineReviewSchema } from "./engine-review.mjs";
import { readUpload } from "./upload.mjs";
import { serveWebAsset } from "./web-assets.mjs";
import { createCatalogSync, catalogSyncError } from "./catalog-sync.mjs";
import { createSearch } from "./search.mjs";
import { sdkInfo } from "./sdk-info.mjs";
import { mappedPlateInputs, resolveMappedPlates } from "./mapped-plates.mjs";
import { inspectProject } from "./project-inspection.mjs";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { validateCatalogQuery } from "./catalog.mjs";
import { resolveMappedInput, validateMappedInput } from "./project-data.mjs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientFromEnv } from "./client.mjs";
import { createOrders, validateOrder } from "./orders.mjs";

export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const builtFrontend = fileURLToPath(new URL("../dist/", import.meta.url));

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createOrderServer({ hive, control, catalog, directory = "data", designs = "fixtures", baseUrl = "https://api.printhiv3d.com", frontendDirectory = builtFrontend, browserOrigin }) {
  const orders = createOrders(hive, directory);
  const sync = createCatalogSync(hive);
  const searchAdapter = createSearch(hive);
  designs = resolve(designs);
  // Show the destination without URL credentials, query strings, or fragments.
  const target = new URL(baseUrl);
  const displayUrl = target.origin + target.pathname.replace(/\/$/, "");
  const production = target.hostname === "api.printhiv3d.com";
  const sessionToken = randomBytes(32).toString("hex");
  let uploading = false;
  const server = createServer({ requestTimeout: 10 * 60 * 1000 }, async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    let temporary;
    let ownsUpload = false;
    const upload = async () => {
      if (uploading) throw Object.assign(new Error("Another upload is in progress"), { status: 429 });
      uploading = ownsUpload = true;
      temporary = await mkdtemp(join(tmpdir(), "printhive-upload-"));
      return readUpload(req, temporary, MAX_UPLOAD_BYTES);
    };
    try {
      const port = req.socket.localPort;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!hosts.has(req.headers.host)) return reply(403, { error: "Untrusted Host" });
      const origins = new Set([...hosts].map(host => `http://${host}`));
      if (browserOrigin) origins.add(browserOrigin);
      if (req.headers.origin && !origins.has(req.headers.origin)) return reply(403, { error: "Untrusted Origin" });
      if (req.headers["sec-fetch-site"] === "cross-site") return reply(403, { error: "Cross-site request refused" });
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && pathname === "/session") return reply(200, { token: sessionToken });
      const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (req.method === "GET" && await serveWebAsset(pathname, res, frontendDirectory)) return;
      if (req.headers["x-printhive-session"] !== sessionToken) return reply(403, { error: "Missing or invalid session header", code: "invalid_session" });
      if (pathname.startsWith("/catalog-sync/")) {
        try {
          if (req.method === "POST" && ["/catalog-sync/preview", "/catalog-sync/upsert"].includes(pathname)) {
            if (!req.headers["content-type"]?.startsWith("application/json")) return reply(400, { error: "Use application/json for catalog records" });
            let input;
            try { input = JSON.parse(await readBody(req, 65536)); }
            catch (error) { if (error instanceof SyntaxError) return reply(400, { error: "Catalog input must be valid JSON" }); throw error; }
            return reply(200, pathname === "/catalog-sync/preview" ? sync.preview(input) : await sync.upsert(input));
          }
          if (req.method === "GET" && pathname === "/catalog-sync/list") return reply(200, await sync.list(new URL(req.url, "http://localhost").searchParams));
          if (req.method === "GET" && parts.length === 3 && parts[1] === "filaments") return reply(200, await sync.get(parts[2]));
          return reply(404, { error: "Catalog sync operation not found" });
        } catch (error) {
          if (error.status === 413) return reply(413, { error: "Catalog input exceeds 64 KiB" });
          const failure = catalogSyncError(error); return reply(failure.status, { error: failure.error });
        }
      }
      if (req.method === "GET" && pathname === "/catalog") {
        if (!catalog) return reply(503, { error: "Hive catalog is unavailable" });
        const search = new URL(req.url, "http://localhost").searchParams;
        try { validateCatalogQuery(search); } catch (error) { return reply(400, { error: error.message }); }
        try { return reply(200, await catalog.search(search)); }
        catch { return reply(502, { error: "Hive catalog lookup failed. Retry the search or check the filament ID." }); }
      }
      if (req.method === "GET" && pathname === "/printers") {
        const search = new URL(req.url, "http://localhost").searchParams;
        try { validateCatalogQuery(search); } catch (error) { return reply(400, { error: error.message }); }
        try { return reply(200, await searchAdapter.printers(search)); }
        catch (error) { return reply(error.status === 503 ? 503 : 502, { error: error.status === 503 ? error.message : "Printer search failed. Retry the search." }); }
      }
      if (req.method === "POST" && pathname === "/project-data/inspect") {
        if (!req.headers["content-type"]?.startsWith("multipart/form-data")) return reply(400, { error: "Upload the project as multipart/form-data" });
        const { file, filename } = await upload();
        try { return reply(200, await inspectProject(await readFile(file), filename)); }
        catch (error) { return reply(422, { error: error.message }); }
      }
      if (req.method === "GET" && pathname === "/project-data") {
        const bytes = await readFile(join(designs, "cube.3mf"));
        return reply(200, { filename: "cube.3mf", sha256: createHash("sha256").update(bytes).digest("hex"), plates: [{ number: 1, filaments: [{ sourceSlot: 0, name: "Cube", material: "PETG", color: "#39FF14" }] }] });
      }
      if (req.method === "POST" && pathname === "/orders/preview") {
        const input = JSON.parse(await readBody(req, 65536));
        if (input.plateMappings !== undefined) {
          const resolved = resolveMappedPlates(input);
          return reply(200, { plates: resolved.plateRequirements.map(({ plate, filaments }) => ({ plate, filaments })) });
        }
        return reply(200, { plate: input.plates[0], filaments: resolveMappedInput(input).filaments });
      }
      if (req.method === "GET" && pathname === "/config")
        return reply(200, { baseUrl: displayUrl, production, maxUploadBytes: MAX_UPLOAD_BYTES, sdk: sdkInfo(hive) });
      if (req.method === "POST" && pathname === "/orders") {
        const type = req.headers["content-type"] ?? "";
        let input;
        if (type.startsWith("multipart/form-data")) {
          const uploaded = await upload();
          input = JSON.parse(uploaded.order);
          const filename = uploaded.filename;
          if (input?.plateMappings !== undefined) mappedPlateInputs(input);
          else if (input?.projectData !== undefined || input?.mappings !== undefined) validateMappedInput(input);
          else validateOrder({ ...input, file: filename });
          input = { ...input, file: uploaded.file };
        } else if (type.startsWith("application/json")) {
          input = JSON.parse(await readBody(req, 65536));
          if (typeof input?.file !== "string")
            return reply(400, { error: "file must name a server-side design" });
          const file = resolve(designs, input.file);
          if (!file.startsWith(designs + sep))
            return reply(400, { error: "File must be inside DESIGN_DIR" });
          input = { ...input, file };
        } else return reply(400, { error: "Use application/json or multipart/form-data" });
        if (input.release === "automatic" && (input.automaticConfirmed !== true ||
          input.confirmedDestination !== (input.printer_id ?? "smart-queue")))
          return reply(400, { error: "Confirm automatic printing and its exact destination" });
        if (input?.projectData !== undefined || input?.mappings !== undefined) {
          if (input.plateMappings !== undefined) mappedPlateInputs(input);
          else validateMappedInput(input);
          const bytes = await readFile(input.file);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (sha256 !== input.projectData.sha256.toLowerCase() || basename(input.file) !== input.projectData.filename)
            return reply(400, { error: "Project data belongs to a different file; load the current plate data" });
        }
        const record = await orders.submit(input);
        return reply(202, {
          id: record.id,
          requests: record.plates.map(({ plate, requestId }) => ({ plate, requestId: requestId ?? null })),
        });
      }
      if (req.method === "POST" && parts[0] === "orders" && parts.length === 3 && parts[2] === "retry") {
        const record = await orders.retry(parts[1]);
        return reply(202, { id: record.id, requests: record.plates.map(({ plate, requestId }) => ({ plate, requestId: requestId ?? null })) });
      }
      if (req.method === "GET" && parts[0] === "orders" && parts.length === 2)
        return reply(200, await orders.status(parts[1]));
      if (req.method === "POST" && parts[0] === "orders" && parts.length === 4 && ["release", "cancel", "approve-review"].includes(parts[3])) {
        const record = await orders.load(parts[1]);
        const item = record.plates.find((p) => p.plate === Number(parts[2]));
        if (!item?.requestId) return reply(404, { error: "Plate request not found" });
        return reply(200, await control(item.requestId, parts[3], parts[3] === "approve-review" ? engineReviewSchema.parse(JSON.parse(await readBody(req, 65536))) : undefined));
      }
      reply(404, { error: "Not found" });
    } catch (error) {
      const upstreamStatus = Number.isInteger(error.status) ? error.status : undefined;
      const code = typeof error.code === "string" && /^[a-z0-9_:.-]{1,80}$/i.test(error.code) ? error.code : undefined;
      const status = error.code === "ENOENT" ? 404 : [413, 422, 429, 503].includes(upstreamStatus) ? upstreamStatus : 400;
      const messages = {
        413: "Request too large",
        422: "Hive rejected this request; no job was accepted. Review the API code and request status before changing or retrying.",
        503: "Print Hive is temporarily unavailable. Read order status before retrying the unchanged request with the same order ID.",
      };
      reply(status, { error: messages[status] ?? "Order operation failed; check input or read status before retrying", code, upstreamStatus });
    } finally {
      if (ownsUpload) uploading = false;
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createOrderServer({
    ...clientFromEnv(),
    browserOrigin: process.env.PRINTHIVE_BROWSER_ORIGIN,
    directory: process.env.ORDER_DATA_DIR ?? "data",
    designs: process.env.DESIGN_DIR ?? "fixtures",
    baseUrl: process.env.PRINTHIVE_BASE_URL ?? "https://api.printhiv3d.com",
  });
  server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
    console.log(JSON.stringify({ message: "Order backend listening on loopback", port: server.address().port })),
  );
}
