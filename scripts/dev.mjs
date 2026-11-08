import { spawn } from "node:child_process";
const apiPort = process.env.API_PORT ?? "3078";
const children = [
  spawn(process.execPath, ["src/server.mjs"], {
    stdio: "inherit",
    env: { ...process.env, PORT: apiPort, PRINTHIVE_BROWSER_ORIGIN: "http://127.0.0.1:5173" },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    env: { ...process.env, API_PORT: apiPort },
  }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => close());
for (const child of children) {
  child.on("error", () => close(1));
  child.on("exit", (code) => close(code ?? 1));
}
