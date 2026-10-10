import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@curtain/sdk": new URL("./src/sdk/index.ts", import.meta.url).pathname } },
  server: {
    proxy: {
      "/api/rpc": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: () => "/rpc" },
      "/api/curtain": { target: "https://operator.curtainrh.com", changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/curtain/, "") },
    },
  },
});
