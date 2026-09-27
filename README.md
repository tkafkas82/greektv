# Greek TV & Radio

All **251 Greek TV channels** plus **17 radio stations** — 7 Greek and 10
European music stations — in one grid, grouped into eleven categories, with the **current programme** for the channels a public guide
covers and **in-app playback** for everything that has an open stream.

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
git init && git add -A && git commit -m "Greek TV & Radio"
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

- **`LIVE` (71)** — an open stream, played directly in the overlay.
- **`WEB` (186)** — no open stream, so the channel's own greektv.live page loads
  in an iframe inside the same overlay. Their page permits framing (it sends no
  `X-Frame-Options` and no CSP `frame-ancestors`), and their ads and analytics
  still load inside the frame. You may need to press **Δείτε Τώρα** within it to
  start, which the player says on screen.

### Playback: 82 of 268 channels

greektv.live does **not** expose its stream URLs. Its channel pages ship
`"streams":[]` next to an `"encryptedStreams":["YGMGcA6lxqpM0f3…"]` blob that is
decrypted in an obfuscated client bundle, specifically to stop other sites
embedding the streams. Those streams are therefore not used here at all.

Instead, streams come from the **openly published
[iptv-org Greek playlist](https://iptv-org.github.io/iptv/countries/gr.m3u)**.
Matching its 71 entries against the catalogue by name yields 65 channels with a
playable HLS URL, minus Ant1 (below) and plus Open Beyond, so **65** are marked
`LIVE`. The other 186 fall back to the embedded page described above, so they
still play without leaving the grid.

**Ant1 is deliberately `null`** although iptv-org lists a URL for it. Two
separate things block it, and neither is fixable in code:

- The stream is geo-restricted to Greece. The relay runs in Vercel’s Frankfurt
  region and gets a `403`; the same URL returns `200` from Greece. Vercel has no
  Greek region.
- The browser can’t fetch it directly either — that CDN rejects our `Origin`.

Keeping the URL only bought viewers a timeout before the embed loaded, so the
entry is `null` and Ant1 goes straight to its embedded page. Running the server
from inside Greece (`npm start`) does play it, via the relay.

One channel is added on top of that: **Open Beyond**, which iptv-org does not
carry. Its broadcaster publishes the current manifest itself, from the JSON the
tvopen.gr embed player reads, so nothing here decrypts anyone else’s bundle.
Because that URL rotates, the catalogue entry is only a fallback and the live one
is fetched at play time — see [`GET /api/resolve`](#get-apiresolve).

**Public IPTV URLs rot, so the app learns which ones are dead.** A probe of all
65 at the time of writing found **13 already gone** — Ant1 on `403` (see below),
both ERT
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

### Defaults

**Μόνο με αναπαραγωγή is checked on load**, so the grid opens on the channels
that play in-app rather than on all 268. Untick it to see the whole catalogue.
The `checked` attribute in `index.html` and `state.onlyPlayable` in `app.js` have
to agree — they are the same setting written twice.

Deep links ignore the filter: `/c/ant1` still opens Ant1 even though its card is
filtered out of the grid.

### Radio: 17 stations

Seven Greek stations sit in **Ραδιόφωνο** and ten European ones in **Ευρώπη
FM**. Both categories are audio (`AUDIO` in `channels.js`), and a station
behaves like any other
card — search, favourites, deep links, the `LIVE`/`WEB` tag and the dead-stream
memory all apply unchanged.

| Station | Stream | Format |
|---|---|---|
| En Lefko 87.7 | `stream.rcs.revma.com` | AAC |
| Pepper 96.6 | `netradio.live24.gr` | MP3 192k |
| ERT Kosmos | `radiostreaming.ert.gr` | MP3 256k |
| Best Radio 92.6 | `best.live24.gr` | MP3 256k |
| Nitro Radio 98.6 | `politismedia-sec.live24.gr` | AAC+ 128k |
| Republic Radio | `netradio.live24.gr` | MP3 128k |
| Sport FM 94.6 | `sportfm.live24.gr` | MP3 128k |

The European stations were picked for being in the spirit of En Lefko — public
or independent, curated and alternative-leaning rather than a chart rotation:

| Station | Country | Stream | Format |
|---|---|---|---|
| RNE Radio 3 | Spain | `dispatcher.rndfnk.com` | MP3 128k |
| Radar 97.8 | Portugal (Lisbon) | `proic1.evspt.com` | AAC 192k |
| RTP Antena 3 | Portugal | `radiocast.rtp.pt` | MP3 |
| FIP | France | `icecast.radiofrance.fr` | AAC 192k |
| Radio Nova | France | `novazz.ice.infomaniak.ch` | MP3 128k |
| RTS Couleur 3 | Switzerland | `stream.srg-ssr.ch` | MP3 128k |
| Studio Brussel | Belgium | `quantumcast.vrtcdn.be` | MP3 128k |
| KINK | Netherlands | `playerservices.streamtheworld.com` | MP3 192k |
| FM4 | Austria | `orf-live.ors-shoutcast.at` | MP3 192k |
| FluxFM | Germany (Berlin) | `streams.fluxfm.de` | MP3 320k |

Their URLs are the broadcasters' entry points, not the CDN edges those redirect
to: RNE, Studio Brussel and FluxFM hand out tokenised edge URLs that expire.
BBC 6 Music was the obvious other pick and is left out because it redirects to
bbc.co.uk from outside the UK; RTÉ 2XM's mount is a 404.

Two things differ from TV, both in code rather than data:

- **They are Icecast, not HLS.** `attach()` takes an `audio` branch that hands
  the URL straight to the media element; hls.js would reject a continuous stream
  that has no manifest. That branch is also why the `playing` listener now clears
  the dead-stream entry — native playback never reaches hls.js’s
  `MANIFEST_PARSED`, so without it a recovered station stayed `WEB` for a day.
- **They are not in the greektv.live directory**, so the derived `watchUrl` would
  be a 404 in an iframe. The row shape gained an optional seventh field, a
  `siteUrl`, pointing at the station’s own site instead.

Every stream URL is verified before it goes in, rather than trusted because it
looked right — public radio directories carry stale mounts that 404 or point
somewhere else entirely. `icy-name` is the check where the stream sends one;
Nitro sends “no name”, so it was confirmed by ADTS framing plus the Live24 page
it came from. Nitro was formerly Pride 98.6, which is why its mount and that page
still read “pride”.

Ids start at 900 so they cannot collide with the TV directory, whose highest id
is 835. All of them are https and play straight from the page with no relay.
CORS does not come into it: the `<audio>` element has no `crossorigin`
attribute, so a media load is never subject to it.

**Radio keeps playing when you close the player.** It runs through its own
`<audio>` element outside the overlay rather than the `<video>` the TV channels
use, so `teardown()` can clear the stage without silencing it. What is left
behind is a mini bar — station, current track, play/pause, stop — which reopens
the player when tapped and is hidden while the overlay is up. Opening any other
channel takes the audio over; reopening the station already playing does not
restart the stream, which would only put a gap in live audio.

The stage itself shows the station and its current track instead of a black
rectangle.

### `GET /api/nowplaying`

What each station is playing, every station in one request, or one with `?ch=<id>`.
Two kinds of source, because no single one covers them:

| Source | Stations | How |
|---|---|---|
| `icy` | En Lefko, Nitro, Republic, Couleur 3, KINK, FM4 | The stream’s own in-band metadata |
| `json` | Pepper (Radiojar), Best (Attica), FIP (Radio France livemeta), FluxFM (Radiosphere) | The station’s own endpoint |
| none | ERT Kosmos, Sport FM, Radio 3, Radar, Antena 3, Nova, Studio Brussel | Publishes neither |

Radio 3, Radar, Antena 3 and Nova send an empty `StreamTitle`; Studio Brussel’s
is only ever its own name. FluxFM’s stream does name the track, but only ~20s in
after a “FluxFM - Livestream” filler — past the read budget — so it goes through
its app backend instead.

Among the Greek stations, three show a track in production. Best answers with `-`
placeholders whenever nothing is queued. Nitro names the track immediately when
read from Greece but never from Vercel: its stream inserts a preroll ad on the
connection (`insertionType='preroll'`, ~50s) and `StreamTitle` stays empty for
the duration — longer than the read budget, and longer than the function may run.
Both degrade to an em dash.

In-band metadata needs an `Icy-MetaData: 1` request, then reading `icy-metaint`
bytes of audio before each metadata block and parsing `StreamTitle`. **The
browser’s media element exposes none of this**, which is why it has to happen
server-side. The read is bounded by bytes and by a timeout, because a station
that never sends a title would otherwise be read forever.

Answers are cached in module scope for 25 seconds: an `icy` lookup opens a real
connection and pulls audio until a title appears, so polling it per viewer would
be both rude to the station and slow. The client polls every 35 seconds and
paints the result in three places — the card (radio has no Digea guide, so the
track takes that line), the player, and the mini bar.

A station with nothing to report shows an em dash rather than a guess.

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

## Installable (PWA)

`manifest.webmanifest` plus `public/sw.js` make it installable; the header shows
an **Εγκατάσταση** button only when the browser fires
`beforeinstallprompt`, so it never advertises an install that cannot happen.

Icons are the nine category hues as a 3×3 grid — the dial itself — rendered to
PNG from `public/icons/`. The launch splash reuses the same nine hues so the
window and the home-screen icon read as one thing, and it is shown **only** by a
`display-mode: standalone` media query, so a normal browser tab never flashes it.

The worker is deliberately narrow:

- **`/api/*` is never cached.** The guide is time-sensitive and `/api/resolve`
  exists precisely to avoid a stale URL — caching either would undo both.
- **Cross-origin is passed straight through.** Streams, segments and fonts are
  someone else’s bytes; caching megabytes of live video per viewer would be
  worse than useless.
- **Everything same-origin is network-first with a cache fallback, not
  cache-first.** Cache-first pinned `/app.js` and `/styles.css` to whatever was
  cached on the first visit while navigations kept fetching fresh HTML, so a
  deploy produced a page running new markup against old script — which looks
  like a UI bug and is not one. The cache is for going offline, not for speed.
- `/sw.js` is served `must-revalidate` so a stale worker can’t pin an old build,
  and a tab whose worker is replaced reloads itself unless a stream is playing.

Bump `VERSION` in `sw.js` to invalidate the shell.

## A trap worth knowing about

`[hidden]{display:none !important}` sits at the top of `styles.css` on purpose.
The UA stylesheet’s `[hidden]{display:none}` loses on specificity to any class
that sets `display`, so `el.hidden = true` sets the property and changes nothing
on screen. Four elements here were affected — the radio stage, the embed iframe,
the video and the install button — and the visible symptom was a radio panel
sitting over a playing TV channel: sound, no picture.

It also defeats testing that asserts on `el.hidden`, which is `true` throughout.
Assert on `getComputedStyle(el).display` instead.

## Layout

```
public/
  index.html      markup and the SVG icon sprite
  styles.css      tokens for light/dark, one hue per category via --h
  app.js          grid, search, favourites, player
  channels.js     the catalogue — single source of truth
  manifest.webmanifest / sw.js / icons/   PWA: install, splash, shell cache
  resolvers.js    broadcasters that publish their own rotating manifest URL
lib/
  channels.js     re-exports public/channels.js so the API shares one copy
  resolvers.js    re-exports public/resolvers.js, same reason
  epg-map.js      our channel id -> Digea channel id (generated)
  digea.js        Digea client, Athens-time conversion, rating extraction
  epg.js          10-minute cache, now/next resolution
api/
  epg.js          GET /api/epg     -> what's on now, per channel
  nowplaying.js   GET /api/nowplaying -> what each station is playing
  resolve.js      GET /api/resolve -> current URL for a rotating stream
  track.js        GET /api/track   -> a played song as a Deezer link
  stream.js       GET /api/stream  -> HLS relay
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
  "catalogue": 257,
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
with `"channels": {}` — the client renders all 257 channels regardless.

Digea returns Athens wall-clock strings; `lib/digea.js` converts them to epoch ms
with a two-pass `Intl` offset lookup, so the hour DST shifts resolves correctly
without a date library. Age ratings (`[K12] Some Show`) are split off the title
and shown as a chip. Synopses are not stored or served.

### `GET /api/resolve`

`?ch=<channel id>` returns the URL a broadcaster is serving right now, for the
few channels that rotate theirs:

```json
{ "channel": 7, "stream": "https://…/chunks.m3u8", "source": "live", "fetchedAt": 1758… }
```

**The page asks the broadcaster itself first, and falls back to this route.**
That ordering matters because these endpoints answer per region: asked from
Vercel’s Frankfurt region, tvopen.gr returns its “out of Greece” placeholder on
`s.tvopen.gr`, which the host allowlist rejects. The viewer’s own browser is in
the right country.

In practice the direct attempt is often blocked: Cloudflare fronts these
endpoints and does not answer a cross-origin `fetch` the way it answers the
player’s own same-origin one, so the browser sees a CORS failure even though the
same request from `curl` returns `200` with `Access-Control-Allow-Origin: *`. The
page therefore tries once per load and, on failure, uses this route for the rest
of the session instead of paying for a request that won’t work there. This route
is also where the 60-second cache lives.

Both paths can fail, and then the catalogue URL is used as-is. That is the
honest state of it: when neither path resolves, a rotated URL is caught by the
dead-stream memory above and the channel falls back to its embedded page.

`source` is `live` (fetched from the broadcaster), `cache` or `fallback`. A
fallback carries `detail` saying why, because the usual causes are invisible from
outside:

```json
{ "source": "fallback", "detail": "undeclared host: s.tvopen.gr", "stream": "https://…" }
```

It falls back to the catalogue URL whenever the endpoint is unreachable, returns
a non-200, fails to parse, or hands back a URL whose host the resolver did not
declare in `public/resolvers.js`. That allowlist is the point: a regional
placeholder — or a compromised upstream — cannot be played as if it were the
channel.

Channels without a resolver return `404`, and the player only resolves ids listed
in `RESOLVERS`, so the other 250 cards open with no extra request. A failed
resolve yields the catalogue URL rather than nothing, so it never trips the
dead-stream memory on its own.

### `GET /api/track`

`?q=<what a station is playing>` turns the free text a station broadcasts into a
real track, so a song you liked is saved as a link rather than a string to
retype:

```json
{ "query": "CANNONS - FIRE FOR YOU",
  "track": { "artist": "Cannons", "title": "Fire for You",
             "deezer": "https://www.deezer.com/track/1033112652", "cover": "…" },
  "youtube": "https://music.youtube.com/search?q=…" }
```

**Deezer, because its search needs no credentials at all.** Spotify’s equivalent
answers `401` without a client id and secret, and YouTube’s Data API answers
`403` without a key; Deezer answers. It sends no
`Access-Control-Allow-Origin`, so the page cannot call it directly — hence the
route. The YouTube Music link is built rather than looked up, since a search URL
needs no key, and it is the fallback for anyone not on Deezer.

Three forms are tried in order: the fielded one (`artist:"…" track:"…"`), which
avoids matching a cover or a remix album; the plain query; and finally a
loosened one with the punctuation and collaboration markers stripped.
“Neiked X Portugal. The Man - Glide” finds nothing as written — the `X` and the
full stop in the artist both break it — but the same words loosened find the
track. The word boundaries in that regex are load-bearing: without them it eats
the `x` inside “Next”.
Station titles arrive in odd shapes — shouty caps, `Feat.` in the artist — and
both resolved correctly in testing. No match is a real outcome, not an error: the
song still saves, with the YouTube link and a **Χωρίς Deezer** marker.

Saved songs live in `localStorage` under `greektv.songs`, like the favourites and
the dead-stream memory — no account, nothing leaves the device. ♥ on the player
stage or the radio bar saves what is on; **Τραγούδια** in the header lists them,
and once a song is saved that same button opens the list rather than sitting
there as a dead end.
The song is stored the moment you press ♥, before the lookup returns, so a slow
or failed resolve never loses it — the link is an enrichment, not the point.

### `GET /api/stream`

An HLS relay, needed because 16 of the 65 streams are plain `http:` (mixed
content on an https page) and most stream hosts send no
`Access-Control-Allow-Origin` (hls.js fetches over XHR). For a manifest it
rewrites every referenced URI back through itself; everything else is piped
through.

Some edges allowlist the referer their own player sends and reject everything
else — *including the stream host’s own name*, which is what the relay builds by
default. Ant1’s CDN answers `200` to `watch.antennaplus.gr` and `403` to
`mcdn.antennaplus.gr`, so a perfectly good URL looked dead. `HOST_REFERER` holds
the per-host value (taken from the iptv-org playlist’s `http-referrer` hints),
and `Origin` is derived from whichever referer is used so the pair can never
disagree — a mismatch is itself grounds for a `403` on these edges.

`RELAY_ONLY_HOSTS` in `public/channels.js` lets the player skip a direct attempt
that cannot work and relay immediately. It is **empty**, and measured rather than
assumed: a probe of all 40 https stream hosts in the catalogue found every
reachable one already sends `Access-Control-Allow-Origin`, so none of them need
it. The 16 plain-http streams are forced through the relay on scheme alone.

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
npm run refresh:logos      # re-download every channel logo and rebuild public/logos.js
npm run export:m3u         # write greektv.m3u for VLC, probing each URL first
```

### Channel logos

Every one of the 268 channels has its real logo, stored in `public/logos/` —
245 files, 1.4 MB, because sub-channels of one broadcaster often share a mark.
`scripts/refresh-logos.mjs` rebuilds both the folder and the `slug -> file` map
in `public/logos.js`; `npm run refresh:logos:check` reports coverage without
downloading anything.

Two sources, because neither covers the whole catalogue:

- **TV** — the greektv.live `/tv` page ships its whole channel list as an
  embedded JSON payload, one `logo` URL per channel, so all 251 cost a single
  request. The images themselves live in a public GitHub repo.
- **Radio** — the stations are not in that directory, so their logos are
  pinned by hand in the script's `PINNED` table, from each station's own site
  or, for most European ones, the Commons file its Wikipedia article uses.
  Half of them are not scrapeable: the page a station is listed on belongs to a
  portal (live24, Attica Radios, ERTecho), whose `og:image` is the portal's own
  logo, so those entries point at the artwork the portal uses for the station
  in its station list. The same table repairs two directory rows whose URL
  404s on a typo upstream (`avant`, `jackson_palace`).

The files are downloaded rather than hot-linked: hot-linking would put 268
requests to two third parties on the critical path of every visit, and would
break the grid the day either one moved a file. They are not precached by the
service worker either — each is cached as it is actually requested, so a first
visit doesn't spend a megabyte on logos nobody scrolled to.

A plate shows the channel's monogram while its logo loads, and keeps the
monogram if the file never arrives, so no tile is ever blank. Logos sit on a
light tile in both themes: channel marks are drawn for white backgrounds and
most are dark ink on transparency, which on a dark plate would be ink on ink.
The one banner-shaped logo in the set — Nitro 98.6, whose only surviving
artwork is a 1000×140 page header — is cropped to its middle rather than fitted
whole, which would leave a sliver three pixels tall. The script measures each
image from its own header and flags anything wider than 2:1, so that stays a
rule rather than a special case.

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

- Every plate — card, player header, channel rail, radio stage, mini bar — shows
  the channel's own logo, with its monogram as the fallback.

Renders in the viewer's light or dark theme. Works down to phone width.

## Credits and scope

- Directory data (names, ids, categories) was collected from the public category
  pages of **[greektv.live](https://www.greektv.live/tv)**, whose channel pages
  are also what the `WEB` channels embed. Their streams and EPG are deliberately
  protected and are not used.
- Streams: **[iptv-org](https://github.com/iptv-org/iptv)**.
- Guide: **[Digea](https://www.digea.gr)**.

- Logos: each broadcaster's own mark, via the directory above for TV and each
  station's own site for radio. See [Channel logos](#channel-logos). Trade marks
  belong to the broadcasters; they are here to identify channels, and a card
  falls back to a monogram tile where no logo is available.

A personal viewing aid over publicly listed free-to-air channels — check what
your own use allows before publishing it somewhere public.

MIT.
