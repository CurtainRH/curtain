// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin, ProxyOptions } from "vite";
import { handleCurtainApiProxy } from "./src/lib/curtain-proxy";

// Curtain media (images, films, fonts) is hosted by Lovable under /__l5e/. Lovable serves that
// path itself; everywhere else (local dev, preview) proxy it to the published Lovable site.
const devProxies: Record<string, ProxyOptions> = {
  "/__l5e": { target: "https://curtainlah.lovable.app", changeOrigin: true },
};

// Operator API calls run server-side in every environment: in dev/preview this middleware runs
// the same handler src/server.ts uses in production, so the browser only ever talks to
// /api/curtain on its own origin (with the offline /config fallback when no operator is up).
function curtainApi(): Plugin {
  const middleware = async (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    if (!req.url?.startsWith("/api/curtain")) return next();
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
      const request = new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), {
        method: req.method ?? "GET",
        headers,
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleCurtainApiProxy(request, process.env);
      if (!response) return next();
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key !== "content-encoding" && key !== "content-length") res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      next(err);
    }
  };
  return {
    name: "curtain-api",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  vite: {
    plugins: [curtainApi()],
    server: { proxy: devProxies },
    preview: { proxy: devProxies },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
