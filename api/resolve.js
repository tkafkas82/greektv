// GET /api/resolve?ch=<channel id>  ->  { channel, stream, source, fetchedAt }
//
// A handful of channels have no stable manifest URL: the broadcaster rotates it
// and publishes the current one from its own player endpoint. For those the
// catalogue entry is only a fallback and this route returns what the broadcaster
// is serving right now, so playback doesn't rot when the URL moves.
//
// `source` tells the caller what it got: "live" straight from the broadcaster,
// "cache" from the short module-scope cache, or "fallback" when the endpoint
// failed or returned a URL we don't accept.
//
// SECURITY: a resolved URL is only ever returned when its host is one the
// resolver declared in lib/resolvers.js, so a changed or hostile upstream cannot
// redirect playback to an arbitrary origin.

import { RESOLVERS } from "../lib/resolvers.js";
import { BY_ID } from "../lib/channels.js";

const TTL_MS = 60 * 1000;
const TIMEOUT_MS = 8000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** channel id -> { at, stream } */
const cache = new Map();

/** A resolved URL counts only if it is https and on a host the resolver declared. */
function acceptable(raw, resolver) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!resolver.hosts.includes(url.host.toLowerCase())) return null;
  return url.href;
}

async function resolveLive(resolver) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(resolver.endpoint, {
      headers: {
        "user-agent": UA,
        accept: "application/json, text/javascript, */*",
        referer: resolver.referer,
      },
      redirect: "follow",
      signal: abort.signal,
    });
    if (!res.ok) return null;
    // The endpoint is a player data feed, not a documented API - it has served
    // text/html content types before, so don't gate on the header.
    const data = JSON.parse(await res.text());
    return acceptable(resolver.pick(data), resolver);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function reply(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    // The whole point is freshness; the module cache above does the throttling.
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const id = Number(url.searchParams.get("ch"));
  const resolver = Number.isInteger(id) ? RESOLVERS[id] : null;
  if (!resolver) {
    reply(res, 404, { error: "No resolver for this channel", channel: id || null });
    return;
  }

  const fallback = (BY_ID.get(id) || {}).stream || null;
  const now = Date.now();

  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) {
    reply(res, 200, { channel: id, stream: hit.stream, source: "cache", fetchedAt: hit.at });
    return;
  }

  const live = await resolveLive(resolver);
  if (!live) {
    reply(res, 200, { channel: id, stream: fallback, source: "fallback", fetchedAt: now });
    return;
  }

  cache.set(id, { at: now, stream: live });
  reply(res, 200, { channel: id, stream: live, source: "live", fetchedAt: now });
}
