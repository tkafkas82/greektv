// GET /api/epg
//
// What is on right now, per channel.
//
//   {
//     "source": "digea.gr",
//     "timezone": "Europe/Athens",
//     "at": 1789638931953,          // instant the answer describes
//     "fetchedAt": 1789638900000,   // when the upstream grid was last pulled
//     "coverage": 56,               // channels that had a programme
//     "catalogue": 251,             // channels in the directory
//     "channels": {
//       "6": {
//         "now":  { "title": "…", "start": 0, "stop": 0, "rating": "K12", "progress": 41 },
//         "next": { "title": "…", "start": 0, "stop": 0 }
//       }
//     }
//   }
//
// Channels missing from "channels" have no guide data - the UI says so rather
// than guessing. Query ?at=<epoch ms> to ask about another instant, ?refresh=1
// to bypass the ten-minute cache.

import { getNowNext, getSchedule } from "../lib/epg.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const atParam = Number(url.searchParams.get("at"));
  const at = Number.isFinite(atParam) && atParam > 0 ? atParam : Date.now();

  try {
    if (url.searchParams.get("refresh") === "1") await getSchedule({ force: true });
    const payload = await getNowNext(at);

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      // The grid only moves when a programme ends, so a minute at the edge is
      // plenty and keeps Digea from seeing our traffic.
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    });
    res.end(JSON.stringify(payload));
  } catch (err) {
    // A guide outage must not take the directory down - the client treats 503
    // as "no guide right now" and still renders all 251 channels.
    res.writeHead(503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        error: "Guide unavailable",
        detail: String(err && err.message ? err.message : err),
        channels: {},
      })
    );
  }
}
