import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { stat, readFile, realpath } from "node:fs/promises";
import { resolve, relative, extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createApiHandler, type ApiOptions } from "./location-api.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};
const inside = (root: string, path: string) => {
  const difference = relative(root, path);
  return (
    difference === "" ||
    (!difference.startsWith("..") && !isAbsolute(difference))
  );
};

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  directory: string,
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://common-table.local").pathname,
    );
  } catch {
    res.writeHead(400);
    res.end("Invalid path");
    return;
  }
  if (
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.split("/").some((segment) => segment.startsWith("."))
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const root = resolve(directory);
  let filename = resolve(root, `.${pathname}`);
  if (!inside(root, filename)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filename).catch(() => null);
    if (!info?.isFile()) {
      if (extname(pathname)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      filename = resolve(root, "index.html");
    }
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(filename);
    if (!inside(canonicalRoot, canonicalFile)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const body = await readFile(canonicalFile);
    res.writeHead(200, {
      "Content-Type":
        MIME_TYPES[extname(canonicalFile)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        extname(canonicalFile) === ".html"
          ? "no-cache"
          : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end("Build the app before starting the preview server.");
  }
}

export function createAppServer(
  options: ApiOptions & { distDir?: string } = {},
) {
  const api = createApiHandler(options);
  const directory = options.distDir ?? resolve("dist");
  return createServer(async (req, res) => {
    try {
      if (!(await api(req, res))) await serveStatic(req, res, directory);
    } catch {
      // Internal request errors are never printed or forwarded.
      if (!res.headersSent)
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("The request could not be completed.");
    }
  });
}

// Importing this module (for tests or another server) has no listening side effect.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  createAppServer().listen(port, host, () => {
    console.log(`Common Table preview listening on port ${port}`);
  });
}
