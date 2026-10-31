import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { clientFromEnv } from "./client.mjs";
import { createOrders } from "./orders.mjs";
const { hive, control } = clientFromEnv();
const orders = createOrders(hive, process.env.ORDER_DATA_DIR ?? "data");
const designs = resolve(process.env.DESIGN_DIR ?? "fixtures");
const server = createServer(async (req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    const parts = new URL(req.url, "http://localhost").pathname
      .split("/")
      .filter(Boolean);
    if (req.method === "POST" && parts.join("/") === "orders") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536)
          return reply(413, { error: "Order too large" });
      }
      const input = JSON.parse(body);
      if (typeof input.file !== "string")
        return reply(400, { error: "file must name a server-side design" });
      const file = resolve(designs, input.file);
      if (!file.startsWith(designs + sep))
        return reply(400, { error: "File must be inside DESIGN_DIR" });
      const record = await orders.submit({ ...input, file });
      return reply(202, {
        id: record.id,
        requests: record.plates.map(({ plate, requestId }) => ({
          plate,
          requestId,
        })),
      });
    }
    if (req.method === "GET" && parts[0] === "orders" && parts.length === 2)
      return reply(200, await orders.status(parts[1]));
    if (
      req.method === "POST" &&
      parts[0] === "orders" &&
      parts.length === 4 &&
      ["release", "cancel"].includes(parts[3])
    ) {
      const status = await orders.status(parts[1]);
      const item = status.plates.find((p) => p.plate === Number(parts[2]));
      if (!item?.requestId)
        return reply(404, { error: "Plate request not found" });
      return reply(200, await control(item.requestId, parts[3]));
    }
    reply(404, { error: "Not found" });
  } catch (error) {
    reply(error.code === "ENOENT" ? 404 : 400, {
      error: "Order operation failed",
      code: error.code,
      upstreamStatus: error.status,
    });
  }
});
server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      message: "Order backend listening on loopback",
      port: server.address().port,
    }),
  ),
);
