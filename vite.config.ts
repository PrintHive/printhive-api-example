import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
  root: path("./client"),
  appType: "mpa",
  plugins: [react(), tailwindcss()],
  publicDir: path("./assets-public"),
  resolve: { alias: { "@": path("./client") } },
  build: { outDir: path("./dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      strict: true,
      allow: [
        path("./client"),
        path("./node_modules"),
        path("./assets-public"),
        path("./src/project-data.mjs"),
        path("./src/mapped-plates.mjs"),
        path("./src/job-status.mjs"),
      ],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**"],
    },
    proxy: Object.fromEntries(
      ["/session", "/config", "/project-data", "/orders", "/catalog", "/catalog-sync", "/printers"].map(
        (prefix) => [
          prefix,
          { target: "http://127.0.0.1:" + (process.env.API_PORT || "3078"), changeOrigin: true },
        ],
      ),
    ),
  },
});
