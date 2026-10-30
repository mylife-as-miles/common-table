import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createApiHandler } from "./server/location-api";
export default defineConfig(() => {
  const api = createApiHandler();
  return {
    plugins: [
      react(),
      {
        name: "common-table-location-api",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            void api(req, res, next);
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            void api(req, res, next);
          });
        },
      },
    ],
  };
});
