import { serveWebAsset } from "./web-assets.mjs";
import { createCatalogSync, catalogSyncError } from "./catalog-sync.mjs";
import { createSearch } from "./search.mjs";
import { sdkInfo } from "./sdk-info.mjs";
import { mappedPlateInputs, resolveMappedPlates } from "./mapped-plates.mjs";
import { inspectProject } from "./project-inspection.mjs";
import { createHash } from "node:crypto";
import { validateCatalogQuery } from "./catalog.mjs";
import { resolveMappedInput, validateMappedInput } from "./project-data.mjs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientFromEnv } from "./client.mjs";
import { createOrders, validateOrder } from "./orders.mjs";

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
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

export function createOrderServer({ hive, control, catalog, directory = "data", designs = "fixtures", baseUrl = "https://api.printhiv3d.com", frontendDirectory = builtFrontend }) {
  const orders = createOrders(hive, directory, undefined, catalog);
  const sync = createCatalogSync(hive);
  const searchAdapter = createSearch(hive);
  designs = resolve(designs);
  // Show the destination without URL credentials, query strings, or fragments.
  const target = new URL(baseUrl);
  const displayUrl = target.origin + target.pathname.replace(/\/$/, "");
  const production = target.hostname === "api.printhiv3d.com";
  return createServer(async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    let temporary;
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (req.method === "GET" && await serveWebAsset(pathname, res, frontendDirectory)) return;
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
        const body = await readBody(req, MAX_UPLOAD_BYTES);
        let form;
        try { form = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData(); }
        catch { return reply(400, { error: "Project upload is not valid multipart data" }); }
        const files = form.getAll("file");
        const file = files[0];
        if (files.length !== 1 || !file || typeof file === "string" || !file.size || !/\.3mf$/i.test(file.name)) return reply(400, { error: "Upload one nonempty .3mf project" });
        const filename = basename(file.name.replaceAll("\\", "/"));
        try { return reply(200, await inspectProject(Buffer.from(await file.arrayBuffer()), filename)); }
        catch (error) { return reply(422, { error: error.message }); }
      }
      if (req.method === "GET" && pathname === "/project-data") {
        const bytes = await readFile(join(designs, "cube.3mf"));
        return reply(200, { filename: "cube.3mf", sha256: createHash("sha256").update(bytes).digest("hex"), plates: [{ number: 1, filaments: [{ sourceSlot: 0, name: "Cube", material: "PETG", color: "#39FF14" }] }] });
      }
      if (req.method === "POST" && pathname === "/orders/preview") {
        if (!catalog) return reply(503, { error: "Hive catalog is unavailable" });
        const input = JSON.parse(await readBody(req, 65536));
        if (input.plateMappings !== undefined) {
          mappedPlateInputs(input);
          try {
            const resolved = await resolveMappedPlates(input, catalog);
            return reply(200, { plates: resolved.plateRequirements.map(({ plate, filaments }) => ({ plate, filaments })) });
          } catch { return reply(400, { error: "A selected plate filament cannot form a requirement. Review all selected plate mappings." }); }
        }
        validateMappedInput(input);
        try {
          const resolved = await resolveMappedInput(input, catalog);
          return reply(200, { plate: input.plates[0], filaments: resolved.filaments });
        } catch { return reply(400, { error: "A selected Hive filament cannot form a single-color requirement. Search again and choose a current catalog entry." }); }
      }
      if (req.method === "GET" && pathname === "/config")
        return reply(200, { baseUrl: displayUrl, production, maxUploadBytes: MAX_UPLOAD_BYTES, sdk: sdkInfo(hive) });
      if (req.method === "POST" && pathname === "/orders") {
        const type = req.headers["content-type"] ?? "";
        let input;
        if (type.startsWith("multipart/form-data")) {
          const bytes = await readBody(req, MAX_UPLOAD_BYTES);
          const form = await new Response(bytes, { headers: { "content-type": type } }).formData();
          const file = form.get("file");
          input = JSON.parse(form.get("order"));
          if (!file || typeof file === "string" || !file.size || !/\.3mf$/i.test(file.name))
            return reply(400, { error: "Upload a nonempty .3mf file" });
          // Ignore browser paths and use a private temporary directory per upload.
          const filename = basename(file.name.replaceAll("\\", "/"));
          if (input?.plateMappings !== undefined) mappedPlateInputs(input);
          else if (input?.projectData !== undefined || input?.mappings !== undefined) validateMappedInput(input);
          else validateOrder({ ...input, file: filename });
          temporary = await mkdtemp(join(tmpdir(), "printhive-upload-"));
          const source = join(temporary, filename);
          await writeFile(source, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
          input = { ...input, file: source };
        } else if (type.startsWith("application/json")) {
          input = JSON.parse(await readBody(req, 65536));
          if (typeof input?.file !== "string")
            return reply(400, { error: "file must name a server-side design" });
          const file = resolve(designs, input.file);
          if (!file.startsWith(designs + sep))
            return reply(400, { error: "File must be inside DESIGN_DIR" });
          input = { ...input, file };
        } else return reply(400, { error: "Use application/json or multipart/form-data" });
        if (input?.projectData !== undefined || input?.mappings !== undefined) {
          if (!catalog) return reply(503, { error: "Hive catalog is unavailable" });
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
          requests: record.plates.map(({ plate, requestId }) => ({ plate, requestId })),
        });
      }
      if (req.method === "GET" && parts[0] === "orders" && parts.length === 2)
        return reply(200, await orders.status(parts[1]));
      if (req.method === "POST" && parts[0] === "orders" && parts.length === 4 && ["release", "cancel"].includes(parts[3])) {
        const status = await orders.status(parts[1]);
        const item = status.plates.find((p) => p.plate === Number(parts[2]));
        if (!item?.requestId) return reply(404, { error: "Plate request not found" });
        return reply(200, await control(item.requestId, parts[3]));
      }
      reply(404, { error: "Not found" });
    } catch (error) {
      reply(error.code === "ENOENT" ? 404 : error.status === 413 ? 413 : error.status === 422 ? 422 : 400, {
        error: error.status === 413 ? "Request too large" : error.status === 422 ? "Hive rejected this request; no job was accepted. Review the API code and request status before changing or retrying." : "Order operation failed; check input or read status before retrying",
        code: error.code,
        upstreamStatus: error.status,
      });
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createOrderServer({
    ...clientFromEnv(),
    directory: process.env.ORDER_DATA_DIR ?? "data",
    designs: process.env.DESIGN_DIR ?? "fixtures",
    baseUrl: process.env.PRINTHIVE_BASE_URL ?? "https://api.printhiv3d.com",
  });
  server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
    console.log(JSON.stringify({ message: "Order backend listening on loopback", port: server.address().port })),
  );
}
