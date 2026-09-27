// Downloads a logo for every channel and regenerates public/logos.js.
//
//   npm run refresh:logos
//   npm run refresh:logos -- --check   (report coverage, download nothing)
//
// Two sources, because no single one covers both halves of the catalogue:
//
//   1. greektv.live - the same directory the catalogue itself came from. Its
//      /tv page ships the whole channel list as an embedded JSON payload, one
//      entry per channel with a `logo` URL, so 251 TV logos cost one request.
//      The images themselves are hosted in a public GitHub repo.
//   2. PINNED below - the radio stations are not in that directory, so their
//      logos are pinned by hand, from each station's own site or Wikipedia. See the comments
//      on each entry: three of them are not discoverable by scraping, because
//      the page's og:image is the portal's logo rather than the station's.
//      The same map also repairs the handful of directory rows whose logo URL
//      is a 404, which is a typo upstream rather than a missing image.
//
// Images are stored under public/logos/ rather than hot-linked. Hot-linking
// would put 257 requests to two third parties on the critical path of every
// visit, and would break the grid the day either one moves a file.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CHANNELS } from "../public/channels.js";

const DIR = fileURLToPath(new URL("../public/logos/", import.meta.url));
const OUT = fileURLToPath(new URL("../public/logos.js", import.meta.url));
const DIRECTORY = "https://www.greektv.live/tv";
const CHECK = process.argv.includes("--check");

// Logo sources the directory cannot give us, by slug. Found by hand once; this
// is the record of that, so a future run does not have to repeat the search.
//
// The three live24/Attica entries deserve the note: enlefko.fm and pepper966.gr
// advertise their own logo in a <link rel="icon"> and an og:image, but the pages
// the other four stations are listed on belong to a portal, whose og:image is
// the portal's logo. So those URLs are the artwork the portal itself uses for
// the station in its own station list, which is the station's real logo.
const PINNED = {
  // <link rel="icon"> on enlefko.fm - the round EN LEFKO 87.7 mark.
  "en-lefko": "https://mmo.aiircdn.com/342/5e62318b7f017.png",
  // og:image on pepper966.gr.
  pepper: "https://www.pepper966.gr/wp-content/uploads/2020/01/Pepper-radio-new-logo.jpg",
  // The station artwork live24.gr shows on its own player page for sid 289.
  "republic-radio": "https://resources.live24.gr/resources/images/stations/548cc5b1-bf78-4b02-8f88-54af327d9916.png",
  // live24's custom header for the station, still filed under the old "pride986"
  // name. A wide banner rather than a square mark - it is the only Nitro artwork
  // left anywhere, since nitroradio.gr no longer resolves. The plate letterboxes
  // it, which is why it looks smaller than the rest.
  "nitro-radio": "https://live24.gr/resrc/styles/custom-popups/pride986/headerNitro986.png",
  // ERT's Kosmos mark, from the same asset repo greektv.live serves its TV logos
  // from. ertecho.gr only ever shows the ERTecho portal logo.
  "ert-kosmos":
    "https://raw.githubusercontent.com/nickstamp93/GymWorkoutMate/i/app/src/main/assets/img/ch/kosmos_3.webp",
  // Best 92.6's own mark, from the station switcher on atticaradios.gr. The
  // og:image there is a campaign photo, not a logo.
  "best-radio":
    "https://www.atticaradios.gr/Content/ImagesDatabase/p/crop/both/be/beacb687958a453286a9bc7d07333915.svg",
  // The header logo on sport-fm.gr. live24's player page still shows the old
  // Nova-era artwork. A wide banner with the sponsor on the left, but the
  // ΣΠΟΡ FM mark sits in the middle, which is the part a wide plate keeps.
  "sport-fm": "https://www.sport-fm.gr/resrc/images/logos/logo-normal_v3.png",

  // European stations. Where the station has a Wikipedia article, its logo is
  // the Commons file that article uses, as the 330px PNG render - the stations'
  // own sites mostly offer only a favicon or the parent broadcaster's mark
  // (rtve.es, vrt.be and rtp.pt all do). The rest come from the station's site.
  "rne-radio-3": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/RNE_Radio_3_2026.svg/330px-RNE_Radio_3_2026.svg.png",
  // <link rel="icon"> on radarlisboa.fm, the yellow RADAR 97.8fm square.
  "radar-lisboa": "https://radarlisboa.fm/wp-content/uploads/2016/02/icone_teste-1.png",
  "antena-3": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/RTP_Antena_3_2026.svg/330px-RTP_Antena_3_2026.svg.png",
  fip: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/FIP_logo_2021.svg/330px-FIP_logo_2021.svg.png",
  "radio-nova": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Radio_Nova_2024.svg/330px-Radio_Nova_2024.svg.png",
  couleur3: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/RTS_Couleur_3_2024.svg/330px-RTS_Couleur_3_2024.svg.png",
  "studio-brussel":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Studio_Brussel_logo_(2023-).svg/330px-Studio_Brussel_logo_(2023-).svg.png",
  // apple-touch-icon on kink.nl, the white K on black.
  kink: "https://kink.nl/static/apple-touch-icon.png",
  fm4: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/FM4.svg/330px-FM4.svg.png",
  // fluxfm.de's own icons are a bare yellow tab with no lettering.
  fluxfm: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/FluxFM.svg/330px-FluxFM.svg.png",

  // Two directory rows point at a file that is not in the asset repo, both off
  // by a letter: it holds avanti.webp and jakson_palace.webp, while the
  // directory asks for avant.webp and jackson_palace.webp. The images exist, so
  // these spell the names the repo actually uses rather than drop the channels.
  "avanti-tv":
    "https://raw.githubusercontent.com/nickstamp93/GymWorkoutMate/i/app/src/main/assets/img/ch/avanti.webp",
  "jackson-palace":
    "https://raw.githubusercontent.com/nickstamp93/GymWorkoutMate/i/app/src/main/assets/img/ch/jakson_palace.webp",
};

// Banners that must be shown whole rather than cropped to their middle. Each
// is a wordmark across the full width - "FLUX FM", "RTP antena 3", "radio
// nova" - so a cropped plate would show half a word, and a thin whole logo
// reads better.
const NO_CROP = new Set([PINNED.fluxfm, PINNED["antena-3"], PINNED["radio-nova"]]);

// Wikimedia asks for a descriptive user agent and answers a bare one with 429.
const UA = { "user-agent": "greektv-dial/1.0 (logo refresh; https://github.com/tkafkas82/greektv)" };

/** id -> logo URL, from the JSON the directory's /tv page embeds in its markup. */
async function fetchDirectoryLogos() {
  const res = await fetch(DIRECTORY, { headers: UA });
  if (!res.ok) throw new Error(`${DIRECTORY} answered ${res.status}`);
  // The payload is JSON inside a JS string inside a <script>, so it reaches us
  // escaped one level deeper than JSON itself. Unescape once, then read it.
  const plain = (await res.text()).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const map = new Map();
  const re = /"id":"(\d+)","name":"(.*?)","logo":"(https:[^"]*)"/g;
  for (const m of plain.matchAll(re)) {
    if (!map.has(Number(m[1]))) map.set(Number(m[1]), m[3]);
  }
  if (!map.size) throw new Error("no logos found in the directory payload - its markup changed");
  return map;
}

const EXT_BY_TYPE = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** A stable, collision-free file name for a source URL. */
const fileNames = new Map(); // url -> file name
const taken = new Set();
function nameFor(url, ext) {
  if (fileNames.has(url)) return fileNames.get(url);
  const stem =
    (new URL(url).pathname.split("/").pop() || "logo")
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "logo";
  let name = `${stem}.${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}.${ext}`;
  taken.add(name);
  fileNames.set(url, name);
  return name;
}

/**
 * Pixel size from an image's own header, or null for a format we do not read.
 *
 * Only the aspect ratio is wanted - to tell a square channel mark from a wide
 * banner - and reading four headers is cheaper than a dependency that decodes
 * pixels we are never going to look at.
 */
function dimensions(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG IHDR
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fmt = buf.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // Any SOFn frame header carries the size; the three markers in that range
      // that are not frame headers do not.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null; // SVG, or a header we do not parse - treated as square
}

async function download(url) {
  let res = await fetch(url, { headers: UA });
  // upload.wikimedia.org rate-limits bursts; one patient retry is enough for
  // the handful of files this script asks it for.
  for (let n = 0; res.status === 429 && n < 3; n++) {
    await new Promise((r) => setTimeout(r, 5000 * (n + 1)));
    res = await fetch(url, { headers: UA });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new Error(`served ${type || "no content-type"}, not an image`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 100) throw new Error(`only ${bytes.length} bytes`);
  const size = dimensions(bytes);
  // A plate is square. Fitting a banner inside one leaves a sliver a few pixels
  // tall, so anything this wide is marked for the plate to crop instead.
  const wide = Boolean(size && size.w / size.h >= 2) && !NO_CROP.has(url);
  return { bytes, ext, wide };
}

/* -------------------------------------------------------------------- run */

const directory = await fetchDirectoryLogos();
console.log(`Directory lists logos for ${directory.size} channels.`);

const jobs = [];
const missing = [];
for (const ch of CHANNELS) {
  const url = PINNED[ch.slug] || directory.get(ch.id) || null;
  if (url) jobs.push({ ch, url });
  else missing.push(ch);
}

console.log(`${jobs.length} of ${CHANNELS.length} channels have a logo source.`);
if (missing.length) {
  console.log(`\n${missing.length} without one:`);
  for (const ch of missing) console.log(`  ${ch.id}  ${ch.name}`);
  console.log("\nAdd a URL to PINNED in this script for any that should have one.");
}

if (CHECK) {
  const distinct = new Set(jobs.map((j) => j.url)).size;
  console.log(`\n--check: would download ${distinct} distinct images. Nothing written.`);
  process.exit(0);
}

// Rebuild the directory from scratch so a channel that lost its logo upstream
// does not leave an orphan file behind.
await rm(DIR, { recursive: true, force: true });
await mkdir(DIR, { recursive: true });

const got = new Map(); // url -> { file, wide }
const failed = [];
const LIMIT = 8;
let cursor = 0;
let bytes = 0;

const urls = [...new Set(jobs.map((j) => j.url))];
await Promise.all(
  Array.from({ length: Math.min(LIMIT, urls.length) }, async () => {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      try {
        const img = await download(url);
        const name = nameFor(url, img.ext);
        await writeFile(DIR + name, img.bytes);
        got.set(url, { file: name, wide: img.wide });
        bytes += img.bytes.length;
      } catch (err) {
        failed.push({ url, err: err.message });
      }
    }
  })
);

const rows = CHANNELS.map((ch) => {
  const url = PINNED[ch.slug] || directory.get(ch.id);
  const hit = url ? got.get(url) : null;
  return hit ? `  ${JSON.stringify(ch.slug)}: ${JSON.stringify(hit.file)},` : null;
}).filter(Boolean);

const wide = [...new Set([...got.values()].filter((g) => g.wide).map((g) => g.file))].sort();

const file = `// Maps our channel slug -> a file in public/logos/.
//
// Generated by scripts/refresh-logos.mjs on ${new Date().toISOString().slice(0, 10)}.
// Covers ${rows.length} of ${CHANNELS.length} channels. Sources and why the files are
// stored here rather than hot-linked are documented in that script.
//
// Several channels share one file on purpose - a broadcaster's sub-channels
// often have no separate mark - so there are fewer files than entries.

export const LOGOS = {
${rows.join("\n")}
};

// Logos that are banners rather than square marks (wider than 2:1). A plate
// crops these to the middle instead of shrinking them into a sliver between two
// empty bands.
export const WIDE = new Set([${wide.map((f) => JSON.stringify(f)).join(", ")}]);

/**
 * A channel's logo - where it is and how a plate should fit it - or null.
 *
 * The path is root-absolute for the same reason app.js's imports are: a
 * /c/<slug> deep link would otherwise resolve a relative one to /c/logos/...
 */
export function logoFor(ch) {
  const file = LOGOS[ch.slug];
  return file ? { url: \`/logos/\${file}\`, wide: WIDE.has(file) } : null;
}
`;

await writeFile(OUT, file, "utf8");

const files = await readdir(DIR);
console.log(
  `\nWrote ${files.length} images (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/logos/ ` +
    `and ${rows.length} mappings to public/logos.js.`
);

if (failed.length) {
  console.log(`\n${failed.length} downloads failed:`);
  for (const f of failed) console.log(`  ${f.err}  ${f.url}`);
}
