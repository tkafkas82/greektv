// Digea EPG adapter.
//
// Digea is the Greek DTT network operator. Its site backs the public schedule
// grid at https://www.digea.gr/el/epg with two form-encoded POST endpoints:
//
//   POST /el/api/epg/get-channels   action=get_chanels&lang=el
//   POST /el/api/epg/get-events     action=get_events&date=YYYY-M-D
//
// get-events returns every event for that calendar day across all channels, so
// one request covers the whole grid. Times come back as Europe/Athens wall
// clock ("2026-09-17 21:00:00"), which we convert to epoch ms below.
//
// We keep only what the UI shows - title, start, stop and the age rating that
// Digea prefixes onto the title - and drop the long synopsis field.

const EVENTS_URL = "https://www.digea.gr/el/api/epg/get-events";
const CHANNELS_URL = "https://www.digea.gr/el/api/epg/get-channels";
const ATHENS = "Europe/Athens";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Offset of `timeZone` from UTC, in ms, at the instant `ms`. */
function zoneOffset(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(ms)) p[type] = value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - ms;
}

/**
 * "2026-09-17 21:00:00" as Europe/Athens wall time -> epoch ms.
 * Two passes so the hour that DST shifts still resolves correctly.
 */
export function athensToEpoch(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(local || ""));
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s] = m.map(Number);
  const guess = Date.UTC(Y, Mo - 1, D, h, mi, s);
  const first = zoneOffset(guess, ATHENS);
  let ms = guess - first;
  const second = zoneOffset(ms, ATHENS);
  if (second !== first) ms = guess - second;
  return ms;
}

/** Digea wants the date unpadded: 2026-9-17. */
export function athensDateParam(ms) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHENS,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(ms)) p[type] = value;
  return `${p.year}-${Number(p.month)}-${Number(p.day)}`;
}

async function post(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": UA,
      accept: "application/json, text/plain, */*",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`digea ${url} -> HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`digea ${url} -> response was not JSON`);
  }
}

// Digea writes the age rating into the title: "[K12] Some Show". The scale runs
// [K] (all ages) through [K8], [K12], [K16], [K18], so the digits are optional.
const RATING = /^\s*\[\s*(K\s?\d{0,2})\s*\]\s*/i;

function splitRating(raw) {
  const title = String(raw || "").trim();
  const m = RATING.exec(title);
  if (!m) return { title, rating: null };
  return { title: title.slice(m[0].length).trim(), rating: m[1].replace(/\s+/g, "").toUpperCase() };
}

/**
 * Every event Digea lists for the Athens calendar day containing `ms`.
 * @returns {Promise<Array<{digeaId:number,title:string,rating:string|null,start:number,stop:number}>>}
 */
export async function fetchDigeaDay(ms = Date.now()) {
  const rows = await post(EVENTS_URL, { action: "get_events", date: athensDateParam(ms) });
  if (!Array.isArray(rows)) return [];

  const out = [];
  for (const r of rows) {
    const start = athensToEpoch(r.actual_time);
    const stop = athensToEpoch(r.end_time);
    if (start == null || stop == null || stop <= start) continue;
    const { title, rating } = splitRating(r.title);
    if (!title) continue;
    out.push({ digeaId: Number(r.channel_id), title, rating, start, stop });
  }
  return out;
}

/** Digea's own channel list - only needed when refreshing lib/epg-map.js. */
export async function fetchDigeaChannels() {
  const rows = await post(CHANNELS_URL, { action: "get_chanels", lang: "el" });
  return Array.isArray(rows) ? rows.map((c) => ({ id: Number(c.id), name: String(c.name).trim() })) : [];
}

export const DIGEA_TIMEZONE = ATHENS;
