// Builds the "what's on now" payload the grid consumes.
//
// One Digea request covers every channel for a calendar day, so we fetch today
// and tomorrow (tomorrow is what makes "next" correct for the last programme of
// the evening) and cache the merged result in module scope. Serverless
// instances stay warm between requests, so this cache does real work on Vercel;
// the HTTP response also carries s-maxage so the CDN absorbs most traffic.

import { CHANNELS } from "./channels.js";
import { CHANNEL_BY_DIGEA } from "./epg-map.js";
import { fetchDigeaDay, DIGEA_TIMEZONE } from "./digea.js";

const TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let cache = { at: 0, payload: null, inflight: null };

function programmesByChannel(events) {
  const byChannel = new Map();
  for (const ev of events) {
    const channelId = CHANNEL_BY_DIGEA[ev.digeaId];
    if (!channelId) continue; // Digea carries channels we don't list
    let list = byChannel.get(channelId);
    if (!list) byChannel.set(channelId, (list = []));
    list.push({ title: ev.title, rating: ev.rating, start: ev.start, stop: ev.stop });
  }
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }
  return byChannel;
}

async function build() {
  const now = Date.now();
  // Tomorrow as well, so the final programme of the day still gets a "next".
  const days = await Promise.allSettled([fetchDigeaDay(now), fetchDigeaDay(now + DAY_MS)]);

  const events = [];
  const failures = [];
  for (const d of days) {
    if (d.status === "fulfilled") events.push(...d.value);
    else failures.push(String(d.reason && d.reason.message ? d.reason.message : d.reason));
  }

  // Both requests failing is an outage, not an empty schedule - say so rather
  // than caching "nothing is on" for ten minutes.
  if (!events.length && failures.length) {
    const err = new Error(failures[0]);
    err.failures = failures;
    throw err;
  }

  const byChannel = programmesByChannel(events);
  return {
    source: "digea.gr",
    timezone: DIGEA_TIMEZONE,
    fetchedAt: now,
    coverage: byChannel.size,
    catalogue: CHANNELS.length,
    partial: failures.length > 0 || null,
    programmes: byChannel,
  };
}

/** Cached schedule, refreshed at most once per TTL. Concurrent calls share one fetch. */
export async function getSchedule({ force = false } = {}) {
  if (!force && cache.payload && Date.now() - cache.at < TTL_MS) return cache.payload;
  if (cache.inflight) return cache.inflight;

  cache.inflight = build()
    .then((payload) => {
      cache = { at: Date.now(), payload, inflight: null };
      return payload;
    })
    .catch((err) => {
      cache.inflight = null;
      // Serve the last good payload through a transient upstream failure.
      if (cache.payload) return cache.payload;
      throw err;
    });

  return cache.inflight;
}

function slice(programme, at) {
  if (!programme) return null;
  const out = {
    title: programme.title,
    start: programme.start,
    stop: programme.stop,
  };
  if (programme.rating) out.rating = programme.rating;
  if (at != null && programme.stop > programme.start) {
    const pct = ((at - programme.start) / (programme.stop - programme.start)) * 100;
    out.progress = Math.max(0, Math.min(100, Math.round(pct)));
  }
  return out;
}

/**
 * now/next per channel id at instant `at`.
 * @returns {Promise<object>} shape documented in api/epg.js
 */
export async function getNowNext(at = Date.now()) {
  const schedule = await getSchedule();
  const channels = {};

  for (const [channelId, list] of schedule.programmes) {
    let current = null;
    let upcoming = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.start <= at && at < p.stop) {
        current = p;
        upcoming = list[i + 1] || null;
        break;
      }
      if (p.start > at) {
        upcoming = p;
        break;
      }
    }
    if (!current && !upcoming) continue;
    channels[channelId] = { now: slice(current, at), next: slice(upcoming, null) };
  }

  return {
    source: schedule.source,
    timezone: schedule.timezone,
    at,
    fetchedAt: schedule.fetchedAt,
    partial: schedule.partial || undefined,
    coverage: Object.keys(channels).length,
    catalogue: schedule.catalogue,
    channels,
  };
}
