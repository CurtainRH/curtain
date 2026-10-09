import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@curtain/sdk": fileURLToPath(new URL("./src/sdk/index.ts", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api/rpc": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: () => "/rpc" },
      "/api/curtain-v3": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/curtain-v3/, "") },
      "/api/curtain": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/curtain/, "") },
    },
  },
});
