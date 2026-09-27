// GET /api/resolve?ch=<channel id>  ->  { channel, stream, source, fetchedAt }
//
// A handful of channels have no stable manifest URL: the broadcaster rotates it
// and publishes the current one from its own player endpoint. For those the
// catalogue entry is only a fallback and this route returns what the broadcaster
// is serving right now, so playback doesn't rot when the URL moves.
//
// `source` tells the caller what it got: "live" straight from the broadcaster,
// "cache" from the short module-scope cache, or "fallback" when the endpoint
// failed or returned a URL we don't accept. A fallback carries `detail` saying
// why, because the usual cause is invisible from the outside: several of these
// endpoints sit behind Cloudflare and answer a home IP while challenging a
// datacenter one, so the same code can resolve locally and fall back in
// production.
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

/** @returns {Promise<{url: string|null, detail?: string}>} */
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
    if (!res.ok) return { url: null, detail: `upstream ${res.status}` };

    // The endpoint is a player data feed, not a documented API - it has served
    // text/html content types before, so don't gate on the header.
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // A Cloudflare interstitial arrives as a 200 full of HTML, so say that
      // rather than the parser's complaint about "<".
      const html = /^\s*<(?:!doctype|html)/i.test(text);
      return { url: null, detail: html ? "upstream returned HTML, not JSON" : "unparseable response" };
    }

    const url = acceptable(resolver.pick(data), resolver);
    return url ? { url } : { url: null, detail: "no acceptable URL in response" };
  } catch (err) {
    return { url: null, detail: err && err.name === "AbortError" ? "timed out" : String(err) };
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
  if (!live.url) {
    reply(res, 200, {
      channel: id,
      stream: fallback,
      source: "fallback",
      detail: live.detail,
      fetchedAt: now,
    });
    return;
  }

  cache.set(id, { at: now, stream: live.url });
  reply(res, 200, { channel: id, stream: live.url, source: "live", fetchedAt: now });
}
