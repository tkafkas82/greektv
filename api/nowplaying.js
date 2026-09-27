// GET /api/nowplaying            -> every radio station
// GET /api/nowplaying?ch=<id>    -> one of them
//
// What a station is playing right now. Two kinds of source, because no single
// one covers them all:
//
//   icy  - the stream's own in-band metadata. Requires Icy-MetaData: 1, then
//          reading icy-metaint bytes of audio before each metadata block. The
//          browser's media element does not expose any of this, which is why
//          this has to happen server-side at all.
//   json - a station's own now-playing endpoint, where it has one.
//
// Not every station publishes anything usable:
//
//   ERT Kosmos sends no StreamTitle and its site's endpoint returns empty, so it
//   has no source here at all and the client shows nothing rather than a guess.
//
//   Best answers, but with "-" placeholders whenever nothing is queued.
//
//   Nitro is the odd one: read from Greece it names the track immediately, but
//   read from Vercel it never does. Its stream inserts a preroll ad on the
//   connection (adw_ad='true', insertionType='preroll', ~50s), and StreamTitle
//   stays empty for the duration - longer than this read's budget, and longer
//   than the function may run at all. Not worth chasing; it degrades to an em
//   dash like the rest.
//
// Answers are cached in module scope for TTL_MS. An icy read opens a real
// connection to the stream and pulls audio until a title shows up, so polling
// it per viewer would be rude to the station and slow for us.

import { CHANNELS, BY_ID } from "../lib/channels.js";

const TTL_MS = 25 * 1000;
const ICY_TIMEOUT_MS = 8000;
const JSON_TIMEOUT_MS = 6000;
// A title normally arrives in the first block. This is the ceiling for stations
// that interleave silence or ads first, and it bounds both time and bandwidth.
const ICY_MAX_BYTES = 96 * 1024;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** channel id -> source. Radio channels with no entry fall back to icy. */
const SOURCES = {
  // Pepper's stream carries no StreamTitle, but its site runs on Radiojar,
  // whose API is public and sends Access-Control-Allow-Origin: *.
  901: {
    kind: "json",
    url: "https://www.radiojar.com/api/stations/pepper/now_playing/",
    pick: (d) => ({ artist: d.artist, title: d.title }),
  },
  // Best's stream carries no StreamTitle either. Attica's own endpoint answers,
  // though it returns "-" placeholders whenever nothing is queued.
  903: {
    kind: "json",
    url: "https://playingnow.atticaradios.gr/nowplaying/best",
    pick: (d) => ({ artist: d.artist, title: d.song }),
  },
  // ERT Kosmos deliberately absent: no in-band title, no working endpoint.
  902: { kind: "none" },
  // Sport FM is talk and commentary, and its stream sends icy-metaint: 0.
  906: { kind: "none" },

  // Europe. RNE Radio 3, Radar, Antena 3 and Nova all send StreamTitle='' or no
  // title block at all, and Studio Brussel's in-band title is only ever its own
  // name - so none of those five have a source.
  907: { kind: "none" },
  908: { kind: "none" },
  909: { kind: "none" },
  911: { kind: "none" },
  913: { kind: "none" },
  // FIP's stream carries no metadata, but Radio France's livemeta feed is public
  // and sends Access-Control-Allow-Origin: *. Station 7 is FIP. It returns a
  // short timeline of steps; the one spanning now is what is on air.
  910: {
    kind: "json",
    url: "https://api.radiofrance.fr/livemeta/pull/7",
    pick: (d) => {
      const now = Date.now() / 1000;
      const step = Object.values(d.steps || {}).find((st) => st.start <= now && now < st.end);
      if (!step || step.embedType !== "song") return { artist: "", title: "" };
      const artist = (step.highlightedArtists || []).join(", ") || step.authors || step.performers;
      return { artist, title: step.title };
    },
  },
  // FluxFM's in-band title is mostly "FluxFM - Livestream", with the track
  // only showing up ~20s into the stream - past ICY_TIMEOUT_MS. Its app backend
  // (Radiosphere) has a public current-track endpoint instead; the id is the
  // FluxFM channel's own.
  916: {
    kind: "json",
    url: "https://fluxmusic.api.radiosphere.io/channels/7efc3ff2-4804-431f-aaa9-7d1f8a7727c7/current-track",
    pick: (d) => ({ artist: d.trackInfo?.artistCredits, title: d.trackInfo?.title }),
  },
};

/** channel id -> { at, entry } */
const cache = new Map();

const clean = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  // These endpoints use "-" and "n/a" as "nothing queued".
  return !s || s === "-" || s.toLowerCase() === "n/a" ? "" : s;
};

/** Normalise either source into one shape, or null when there's nothing to show. */
function entryFrom({ artist, title, text }) {
  const a = clean(artist);
  const t = clean(title);
  const raw = clean(text);

  if (!a && !t && !raw) return null;
  if (a && t) return { artist: a, title: t, text: `${a} – ${t}` };
  if (raw) {
    // In-band titles are conventionally "Artist - Title", but plenty of
    // stations send just a track name, so only split on a real separator.
    const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(raw);
    if (m) return { artist: m[1].trim(), title: m[2].trim(), text: raw };
    return { artist: "", title: raw, text: raw };
  }
  const only = a || t;
  return { artist: a, title: t, text: only };
}

/** Pull the stream far enough to see a non-empty StreamTitle. */
async function readIcy(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ICY_TIMEOUT_MS);
  let reader = null;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "Icy-MetaData": "1", accept: "*/*" },
      redirect: "follow",
      signal: abort.signal,
    });
    const metaint = Number(res.headers.get("icy-metaint") || 0);
    if (!res.ok || !metaint || !res.body) {
      if (res.body) await res.body.cancel().catch(() => {});
      return null;
    }

    reader = res.body.getReader();
    let buf = new Uint8Array(0);
    let read = 0;

    while (read < ICY_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length;

      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;

      // The byte at metaint holds the metadata length in 16-byte units; zero
      // means "unchanged since last block", which is the common case.
      while (buf.length > metaint) {
        const len = buf[metaint] * 16;
        if (buf.length < metaint + 1 + len) break;
        if (len) {
          const meta = new TextDecoder("utf-8").decode(buf.slice(metaint + 1, metaint + 1 + len));
          const m = /StreamTitle='([^']*)'/.exec(meta);
          if (m && m[1].trim()) return m[1].trim();
        }
        buf = buf.slice(metaint + 1 + len);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
  }
}

async function readJson(source) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), JSON_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": UA, accept: "application/json, */*" },
      redirect: "follow",
      signal: abort.signal,
    });
    if (!res.ok) return null;
    return source.pick(JSON.parse(await res.text()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(ch) {
  const now = Date.now();
  const hit = cache.get(ch.id);
  if (hit && now - hit.at < TTL_MS) return hit.entry;

  const source = SOURCES[ch.id] || { kind: "icy" };
  let entry = null;

  if (source.kind === "json") {
    const got = await readJson(source);
    if (got) entry = entryFrom(got);
  } else if (source.kind === "icy") {
    const text = await readIcy(ch.stream);
    if (text) entry = entryFrom({ text });
  }

  cache.set(ch.id, { at: now, entry });
  return entry;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const raw = url.searchParams.get("ch");

  let wanted;
  if (raw === null) {
    wanted = CHANNELS.filter((c) => c.audio);
  } else {
    const ch = BY_ID.get(Number(raw));
    if (!ch || !ch.audio) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not a radio channel", channel: Number(raw) || null }));
      return;
    }
    wanted = [ch];
  }

  const entries = await Promise.all(wanted.map((ch) => lookup(ch).catch(() => null)));
  const stations = {};
  wanted.forEach((ch, i) => {
    stations[ch.id] = entries[i];
  });

  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    // The module cache above does the throttling; a CDN copy would only add lag
    // to something whose whole point is being current.
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ fetchedAt: Date.now(), stations }));
}
