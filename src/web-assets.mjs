import { readFile } from "node:fs/promises";
import { join } from "node:path";

const types = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
]);
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export async function serveWebAsset(pathname, response, directory) {
  let file, type;
  if (pathname === "/") {
    file = "index.html";
    type = "text/html; charset=utf-8";
  } else if (pathname === "/mark.svg") {
    file = "mark.svg";
    type = "image/svg+xml";
  } else if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) {
    const extension = pathname.slice(pathname.lastIndexOf("."));
    type = types.get(extension);
    if (!type) return false;
    file = pathname.slice(1);
  } else return false;
  let bytes;
  try {
    bytes = await readFile(join(directory, file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (pathname !== "/") return false;
    response.writeHead(503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        error:
          "Build the React frontend with npm run build before starting the server.",
      }),
    );
    return true;
  }
  response.writeHead(200, {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "content-security-policy": csp,
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-store",
  });
  response.end(bytes);
  return true;
}
