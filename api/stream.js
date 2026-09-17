// GET /api/stream?u=<encoded absolute url>
//
// HLS relay. Two problems make direct playback impossible for most channels:
//
//   1. 16 of the 65 streams are plain http:, which an https page refuses to
//      load as mixed content.
//   2. Most stream hosts send no Access-Control-Allow-Origin, and hls.js pulls
//      manifests and segments over XHR, so the browser blocks them.
//
// Relaying fixes both. For a manifest we rewrite every referenced URI back
// through this route so segments follow the same path; anything else is piped
// through untouched.
//
// SECURITY: an unrestricted relay is an open proxy on your Vercel account, so
// requests are refused unless the host is one we actually ship a stream for
// (see ALLOWED_HOSTS below). Streams whose segments live on a *different* host
// than the manifest additionally need STREAM_PROXY_SECRET set, which lets us
// sign the URLs we hand out and accept them back without widening the
// allowlist. Without that variable those few channels simply won't relay.

import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { CHANNELS } from "../lib/channels.js";

const ALLOWED_HOSTS = new Set(
  CHANNELS.filter((c) => c.stream).map((c) => {
    try {
      return new URL(c.stream).host.toLowerCase();
    } catch {
      return null;
    }
  }).filter(Boolean)
);

const SECRET = process.env.STREAM_PROXY_SECRET || "";
const MANIFEST_BYTES = 8 * 1024 * 1024; // a playlist should never approach this
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function sign(raw) {
  if (!SECRET) return null;
  return createHmac("sha256", SECRET).update(raw).digest("base64url");
}

function signatureValid(raw, provided) {
  const expected = sign(raw);
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(provided));
  return a.length === b.length && timingSafeEqual(a, b);
}

function allowed(target, signature) {
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (ALLOWED_HOSTS.has(target.host.toLowerCase())) return true;
  return signatureValid(target.href, signature);
}

/** Our own URL for a downstream resource, signed when we're able to. */
function relayUrl(absolute) {
  const sig = sign(absolute);
  const q = `u=${encodeURIComponent(absolute)}`;
  return sig ? `/api/stream?${q}&s=${sig}` : `/api/stream?${q}`;
}

function looksLikeManifest(url, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("mpegurl") || ct.includes("m3u")) return true;
  return /\.m3u8(\?|$)/i.test(url);
}

const URI_ATTR = /URI="([^"]+)"/i;

/** Point every URI in a playlist back at this route, resolved against `base`. */
function rewriteManifest(text, base) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith("#")) {
      // #EXT-X-KEY, #EXT-X-MAP and #EXT-X-MEDIA carry URI="…" attributes.
      const m = URI_ATTR.exec(trimmed);
      if (m) {
        try {
          out.push(trimmed.replace(URI_ATTR, `URI="${relayUrl(new URL(m[1], base).href)}"`));
          continue;
        } catch {
          /* leave the line alone if it won't resolve */
        }
      }
      out.push(line);
      continue;
    }

    // A bare line is a segment or a nested playlist.
    try {
      out.push(relayUrl(new URL(trimmed, base).href));
    } catch {
      out.push(line);
    }
  }
  return out.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const raw = url.searchParams.get("u");
  if (!raw) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Missing ?u=");
    return;
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Malformed ?u=");
    return;
  }

  if (!allowed(target, url.searchParams.get("s"))) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      `Host not relayable: ${target.host}\n` +
        "Only hosts listed in lib/channels.js are relayed. Cross-host segments " +
        "need STREAM_PROXY_SECRET to be set."
    );
    return;
  }

  const headers = {
    "user-agent": UA,
    accept: "*/*",
    // Several Greek stream hosts check these before serving a manifest.
    referer: `${target.protocol}//${target.host}/`,
    origin: `${target.protocol}//${target.host}`,
  };
  if (req.headers.range) headers.range = req.headers.range;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  res.on("close", () => abort.abort());

  let upstream;
  try {
    upstream = await fetch(target.href, { headers, redirect: "follow", signal: abort.signal });
  } catch (err) {
    clearTimeout(timer);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`Upstream unreachable: ${err && err.name === "AbortError" ? "timed out" : err}`);
    return;
  }

  const contentType = upstream.headers.get("content-type") || "";

  try {
    if (looksLikeManifest(target.href, contentType)) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      clearTimeout(timer);
      if (buf.byteLength > MANIFEST_BYTES) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("Manifest unexpectedly large");
        return;
      }
      const body = rewriteManifest(buf.toString("utf8"), upstream.url || target.href);
      res.writeHead(upstream.status, {
        "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
        "access-control-allow-origin": "*",
        // Live playlists are rewritten every few seconds - never cache them.
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }

    // Segments, keys and init files: pass the bytes straight through.
    const passthrough = {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=30",
    };
    if (contentType) passthrough["content-type"] = contentType;
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) passthrough[h] = v;
    }
    res.writeHead(upstream.status, passthrough);

    if (req.method === "HEAD" || !upstream.body) {
      clearTimeout(timer);
      res.end();
      return;
    }

    const node = Readable.fromWeb(upstream.body);
    node.on("error", () => res.destroy());
    node.on("end", () => clearTimeout(timer));
    node.pipe(res);
  } catch (err) {
    clearTimeout(timer);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Relay failed: ${err}`);
    } else {
      res.destroy();
    }
  }
}

export const RELAY_HOSTS = ALLOWED_HOSTS;
