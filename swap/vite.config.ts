import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "@curtain/sdk": fileURLToPath(new URL("../backend/packages/sdk/src/index.ts", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api/curtain-v3": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/curtain-v3/, "") },
      "/api/curtain": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/curtain/, "") },
    },
  },
});
