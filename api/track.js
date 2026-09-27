// GET /api/track?q=<what a station is playing>  ->  { query, track }
//
// Turns the free text a radio station broadcasts - "Artist - Title", or often
// just a track name in shouty caps - into a real track, so a song you liked can
// be saved as a link rather than a string you have to retype later.
//
// Deezer is used because its search needs no credentials at all: Spotify's
// equivalent answers 401 without a client id and secret, and YouTube's needs an
// API key. Deezer sends no Access-Control-Allow-Origin, so the page cannot call
// it directly - hence this route.
//
// The YouTube Music link is built, not looked up: a search URL needs no key, and
// it is the fallback for anyone who doesn't use Deezer.

const TTL_MS = 12 * 60 * 60 * 1000; // a track's identity doesn't change
const MAX_ENTRIES = 500;
const TIMEOUT_MS = 6000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** normalised query -> { at, track } */
const cache = new Map();

const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** "Artist - Title" is the convention, but plenty of stations send only a name. */
function split(query) {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(query.trim());
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "", title: query.trim() };
}

async function deezer(q) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const url = `https://api.deezer.com/search?limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    const hit = Array.isArray(data.data) ? data.data[0] : null;
    if (!hit || !hit.link) return null;
    return {
      title: hit.title || "",
      artist: (hit.artist && hit.artist.name) || "",
      album: (hit.album && hit.album.title) || "",
      cover: (hit.album && (hit.album.cover_medium || hit.album.cover)) || "",
      deezer: hit.link,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolve(query) {
  const key = norm(query);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.track;

  const { artist, title } = split(query);
  // The fielded form is stricter and avoids matching a cover or a remix album
  // when the station gave us both halves; the plain query is the fallback.
  let track = null;
  if (artist && title) track = await deezer(`artist:"${artist}" track:"${title}"`);
  if (!track) track = await deezer(query);

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, track });
  return track;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const query = (url.searchParams.get("q") || "").trim();

  const reply = (status, body) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

  if (!query || query.length > 300) {
    reply(400, { error: "Missing or oversized ?q=" });
    return;
  }

  let track = null;
  try {
    track = await resolve(query);
  } catch {
    track = null;
  }

  reply(200, {
    query,
    track,
    // Always available, needs no lookup, and covers anyone not on Deezer.
    youtube: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  });
}
