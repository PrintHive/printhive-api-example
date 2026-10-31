import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clientFromEnv } from "./client.mjs";
import { createOrders, validateOrder } from "./orders.mjs";

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

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

export function createOrderServer({ hive, control, directory = "data", designs = "fixtures", baseUrl = "https://api.printhiv3d.com" }) {
  const orders = createOrders(hive, directory);
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
      if (req.method === "GET" && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        const bytes = await readFile(join(publicDir, file));
        res.writeHead(200, {
          "content-type": type,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        return res.end(bytes);
      }
      if (req.method === "GET" && pathname === "/config")
        return reply(200, { baseUrl: displayUrl, production, maxUploadBytes: MAX_UPLOAD_BYTES });
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
          validateOrder({ ...input, file: filename });
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
      reply(error.code === "ENOENT" ? 404 : error.status === 413 ? 413 : 400, {
        error: error.status === 413 ? "Request too large" : "Order operation failed; check input or read status before retrying",
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
