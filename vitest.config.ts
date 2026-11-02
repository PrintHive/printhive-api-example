import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./client", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["client/**/*.test.ts", "client/**/*.test.tsx"],
    setupFiles: ["client/test-setup.ts"],
  },
});
