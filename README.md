# Greek TV Dial

All **251 Greek TV channels** in one grid, grouped into nine categories, with the
**current programme** for the channels a public guide covers and **in-app
playback** for the channels that have an open stream.

No dependencies, no build step. `npm start` runs it; pushing to GitHub and
importing into Vercel deploys it.

---

## Run it

```bash
npm start           # http://localhost:3000
PORT=8080 npm start
```

`server.mjs` uses only Node builtins (Node 18+) and hands `/api/*` to the very
same handler modules Vercel runs in production, so local behaviour matches the
deployment. Nothing to install — there is no `node_modules`.

## Deploy it

```bash
git init && git add -A && git commit -m "Greek TV Dial"
git remote add origin git@github.com:<you>/greektv-dial.git
git push -u origin main
```

Then **vercel.com → Add New → Project → import the repo → Deploy**. Leave every
build setting empty; `vercel.json` already declares `public/` as the output
directory and `api/*.js` as functions. There is no framework to detect and no
install step to run.

Optionally set `STREAM_PROXY_SECRET` (see [Environment](#environment)).

---

## What actually works, and what doesn't

This is the part worth reading before you judge the feature set.

### Everything stays on one page

Clicking any channel opens it in an overlay player with a channel rail down the
side, so switching channels never leaves the grid. The rail walks whatever the
grid is currently showing, so a search or a category filter carries into the
player. `←`/`→` zap through it, the `‹ ›` buttons do the same, and the open
channel is reflected in the URL as `#ch=<id>` so a reload or a shared link comes
back to it. The only thing that navigates away is the small ↗ on each card.

Channels split into two kinds, marked `LIVE` and `WEB` on every card:

- **`LIVE` (65)** — an open HLS stream, played directly in the overlay.
- **`WEB` (186)** — no open stream, so the channel's own greektv.live page loads
  in an iframe inside the same overlay. Their page permits framing (it sends no
  `X-Frame-Options` and no CSP `frame-ancestors`), and their ads and analytics
  still load inside the frame. You may need to press **Δείτε Τώρα** within it to
  start, which the player says on screen.

### Playback: 65 of 251 channels

greektv.live does **not** expose its stream URLs. Its channel pages ship
`"streams":[]` next to an `"encryptedStreams":["YGMGcA6lxqpM0f3…"]` blob that is
decrypted in an obfuscated client bundle, specifically to stop other sites
embedding the streams. Those streams are therefore not used here at all.

Instead, streams come from the **openly published
[iptv-org Greek playlist](https://iptv-org.github.io/iptv/countries/gr.m3u)**.
Matching its 71 entries against the catalogue by name yields **65 channels** with
a playable HLS URL, marked `LIVE`. The other 186 fall back to the embedded page
described above, so they still play without leaving the grid.

**Public IPTV URLs rot, so the app learns which ones are dead.** A probe of all
65 at the time of writing found **13 already gone** — Ant1 on `403`, both ERT
Sports feeds timing out, four `404`s, two `500`s, two rejected certificate
chains and two unreachable hosts. Rather than freeze that verdict into the
catalogue (a browser may succeed where the probe didn't, and hosts recover), the
behaviour is:

- A stream that fails is recorded in `localStorage` under `greektv.deadStreams`.
- That channel's card drops from `LIVE` to `WEB`, and the direct-stream count in
  the header falls, so nothing promises video it can't deliver.
- The next visit skips the connection attempt and loads the embedded page
  immediately instead of making you wait for a timeout.
- The embed note offers **Δοκιμή ροής ξανά** to force a retry.
- Entries expire after 24 hours, and a stream that does play clears its own
  entry, so a recovered host needs no intervention.

The memory is per browser and never leaves it.

Public IPTV URLs rot. When one dies the player says so and offers the
greektv.live link rather than spinning forever.

### Guide: 56 of 251 channels

greektv.live's own EPG endpoint is token-gated — `GET /api/data/epg?source=gr`
returns `403 {"error":"Invalid request method"}` without the `ts`/`sid`/`ref`/`uid`
signature its page generates — so it is not used either.

The guide instead comes from **[Digea](https://www.digea.gr)**, the Greek DTT
network operator, whose site is backed by a public schedule API:

```
POST /el/api/epg/get-channels   action=get_chanels&lang=el
POST /el/api/epg/get-events     action=get_events&date=YYYY-M-D
```

One `get-events` call returns every programme for a calendar day across all
channels, so the whole grid costs one request. Digea carries 87 channels, **56**
of which map onto this catalogue.

**ERT has no guide here.** ERT broadcasts on its own multiplex and is not carried
in Digea's listings, so ERT 1 / 2 / 3 / News show "Χωρίς πρόγραμμα". That is a
gap in the source, not a bug — the app never invents a programme it doesn't have.

There is no public XMLTV feed covering Greek free-to-air; iptv-org's guide
registry has only 32 Greek entries, nearly all Novasports. If you have rights to
a fuller feed, `lib/epg.js` is the only file that needs to change.

---

## Layout

```
public/
  index.html      markup and the SVG icon sprite
  styles.css      tokens for light/dark, one hue per category via --h
  app.js          grid, search, favourites, player
  channels.js     the catalogue — single source of truth
lib/
  channels.js     re-exports public/channels.js so the API shares one copy
  epg-map.js      our channel id -> Digea channel id (generated)
  digea.js        Digea client, Athens-time conversion, rating extraction
  epg.js          10-minute cache, now/next resolution
api/
  epg.js          GET /api/epg   -> what's on now, per channel
  stream.js       GET /api/stream -> HLS relay
scripts/
  refresh-epg-map.mjs
server.mjs        local static + API server (Vercel ignores it)
```

`public/channels.js` is imported by both the browser and the serverless
functions, so the grid and the guide can never disagree about which channels
exist.

### `GET /api/epg`

```json
{
  "source": "digea.gr",
  "timezone": "Europe/Athens",
  "at": 1789638931953,
  "fetchedAt": 1789638900000,
  "coverage": 56,
  "catalogue": 251,
  "channels": {
    "6": {
      "now":  { "title": "…", "start": 0, "stop": 0, "rating": "K12", "progress": 41 },
      "next": { "title": "…", "start": 0, "stop": 0 }
    }
  }
}
```

Channels absent from `channels` have no guide data. `?at=<epoch ms>` asks about
another instant; `?refresh=1` bypasses the cache. A guide outage returns `503`
with `"channels": {}` — the client renders all 251 channels regardless.

Digea returns Athens wall-clock strings; `lib/digea.js` converts them to epoch ms
with a two-pass `Intl` offset lookup, so the hour DST shifts resolves correctly
without a date library. Age ratings (`[K12] Some Show`) are split off the title
and shown as a chip. Synopses are not stored or served.

### `GET /api/stream`

An HLS relay, needed because 16 of the 65 streams are plain `http:` (mixed
content on an https page) and most stream hosts send no
`Access-Control-Allow-Origin` (hls.js fetches over XHR). For a manifest it
rewrites every referenced URI back through itself; everything else is piped
through.

**It is not an open proxy.** Requests are refused unless the host appears in a
stream URL in `public/channels.js`. Cross-host segments are accepted only with a
valid HMAC signature, which requires `STREAM_PROXY_SECRET`.

The player tries the direct URL first and only falls back to the relay when that
fails, so most playback never touches your Vercel bandwidth. Channels that do
relay push their video through your deployment — worth knowing if you are on a
metered plan.

---

## Environment

Both optional; see `.env.example`.

| Variable | Effect |
| --- | --- |
| `STREAM_PROXY_SECRET` | Lets `/api/stream` sign rewritten segment URLs, enabling the few streams whose segments sit on a different host than their manifest. Without it those channels fall back to the greektv.live link. |
| `PORT` | Local dev port (default `3000`). Ignored by Vercel. |

## Maintenance

```bash
npm run refresh:epg-map    # re-pull Digea's channel list and rebuild lib/epg-map.js
npm run export:m3u         # write greektv.m3u for VLC, probing each URL first
```

### Playlist for VLC

`scripts/export-m3u.mjs` writes the channels that have an open stream as an M3U,
named after each channel as this catalogue names it and grouped by category so
VLC's playlist sidebar is navigable. Each entry keeps its iptv-org `tvg-id`, so
an XMLTV guide can be matched to it later.

```bash
node scripts/export-m3u.mjs --check                   # one file, verified
node scripts/export-m3u.mjs                           # one file, all 65
node scripts/export-m3u.mjs --check --split category  # m3u/categories/*.m3u
node scripts/export-m3u.mjs --check --split channel   # m3u/channels/*.m3u
node scripts/export-m3u.mjs --out other.m3u           # where --split one writes
node scripts/export-m3u.mjs --dir path                # where the others write
```

`--split category` writes one playlist per category, and `--split channel` one
per channel named after it, for adding a single channel to VLC on its own.
Empty categories are skipped, and two channels sharing a display name get the
id appended so neither is overwritten.

`--check` probes every URL first and leaves out the ones that don't answer. Be
aware it is stricter than VLC: a rejected certificate chain fails here but often
plays fine in VLC, so the unverified export is worth trying for anything
`--check` drops. `.m3u` files are gitignored — the URLs go stale, so a committed
copy would only ever be wrong.

It prints any Digea channel it could not place so you can extend the `MANUAL`
table at the top of the script. To refresh streams, re-download the iptv-org
playlist and re-match the `stream` column in `public/channels.js`.

## Interface

- Click anywhere on a card to watch it in the overlay. The ↗ is the only control
  that opens greektv.live in a new tab.
- `←` `→` (or `↑` `↓`, or the `‹ ›` buttons) change channel with the player open.
- `/` or `Ctrl`/`⌘`+`K` — search. Accent-insensitive, and transliterates Greek
  to Latin, so `σκαι` finds *Skai*.
- **Ζάπινγκ** — a random channel from whatever is currently filtered, preferring
  one with an open stream. Swaps the open player rather than reopening it.
- ★ — favourites, pinned to their own band, and also on the player header. Kept
  in `localStorage`, per browser.
- Sort by category, Α–Ω, or channel number; filter to only channels that play or
  only channels with a guide.
- `Esc` closes the player. `#ch=<id>` in the URL opens straight into a channel.

Renders in the viewer's light or dark theme. Works down to phone width.

## Credits and scope

- Directory data (names, ids, categories) was collected from the public category
  pages of **[greektv.live](https://www.greektv.live/tv)**, whose channel pages
  are also what the `WEB` channels embed. Their streams and EPG are deliberately
  protected and are not used.
- Streams: **[iptv-org](https://github.com/iptv-org/iptv)**.
- Guide: **[Digea](https://www.digea.gr)**.

Channel logos are not re-hosted; each card draws a generated monogram tile
coloured by category instead. A personal viewing aid over publicly listed
free-to-air channels — check what your own use allows before publishing it
somewhere public.

MIT.
