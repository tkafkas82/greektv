// Local dev server. Node builtins only - nothing to install.
//
//   npm start            -> http://localhost:3000
//   PORT=8080 npm start
//
// It serves public/ and hands /api/* to the same handler modules Vercel runs in
// production, so what you see locally is what deploys. Vercel ignores this file.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import epgHandler from "./api/epg.js";
import streamHandler from "./api/stream.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;

const ROUTES = {
  "/api/epg": epgHandler,
  "/api/stream": streamHandler,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".m3u8": "application/vnd.apple.mpegurl",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

/** Resolve a request path inside public/, refusing anything that escapes it. */
async function resolveStatic(pathname) {
  const decoded = decodeURIComponent(pathname);
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  if (rel === ".." || rel.startsWith(`..${sep}`)) return null;

  let filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return null;

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    return null;
  }

  try {
    const body = await readFile(filePath);
    return { body, type: MIME[extname(filePath).toLowerCase()] || "application/octet-stream" };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  const handler = ROUTES[pathname.replace(/\/+$/, "") || "/"];
  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[${pathname}]`, err);
      if (!res.headersSent) send(res, 500, `Handler failed: ${err}`, { "cache-control": "no-store" });
      else res.destroy();
    }
    return;
  }

  if (pathname.startsWith("/api/")) return send(res, 404, "No such API route");

  // /c/<slug> deep-links into a channel. The client reads the path and opens
  // that channel's player, so every such URL serves the same document. Mirrored
  // by the rewrite in vercel.json.
  const deepLink = /^\/c\/[^/]+\/?$/.test(pathname);

  const file = await resolveStatic(deepLink || pathname === "/" ? "/index.html" : pathname);
  if (!file) return send(res, 404, "Not found");

  send(res, 200, file.body, { "content-type": file.type, "cache-control": "no-store" });
});

server.listen(PORT, () => {
  console.log(`Greek TV Dial  ->  http://localhost:${PORT}`);
  console.log(`  guide:  http://localhost:${PORT}/api/epg`);
  if (!process.env.STREAM_PROXY_SECRET) {
    console.log("  note:   STREAM_PROXY_SECRET unset - cross-host stream segments won't relay");
  }
});
