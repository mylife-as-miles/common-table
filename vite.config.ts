import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createApiHandler } from "./server/location-api";
import { readClaudeConfig } from "./server/claude-config";
import { createWaiterApiHandler } from "./server/waiter-api";
import type { IncomingMessage, ServerResponse } from "node:http";
export default defineConfig(({ mode }) => {
  // Read secrets only into server middleware. Validation fails before Vite can
  // expose a prohibited VITE_* credential; no values are printed or returned.
  const config = readClaudeConfig(loadEnv(mode, process.cwd(), ""));
  const api = createApiHandler();
  const waiter = createWaiterApiHandler(config);
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void (async () => {
      if (!(await waiter(req, res))) await api(req, res, next);
    })().catch(() => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ status: "error", code: "unavailable", message: "The request could not be completed." }));
    });
  };
  return {
    plugins: [
      react(),
      {
        name: "common-table-server-api",
        configureServer(server) {
          server.middlewares.use(middleware);
          server.httpServer?.once("close", () => waiter.close());
        },
        configurePreviewServer(server) {
          server.middlewares.use(middleware);
          server.httpServer.once("close", () => waiter.close());
        },
      },
    ],
  };
});
