// Export the channels that have an open stream as an M3U playlist for VLC.
//
//   node scripts/export-m3u.mjs                        # all 65 in one file
//   node scripts/export-m3u.mjs --check                # probe first, drop dead
//   node scripts/export-m3u.mjs --split channel        # one file per channel
//   node scripts/export-m3u.mjs --split category       # one file per category
//   node scripts/export-m3u.mjs --out path.m3u         # where --split one writes
//   node scripts/export-m3u.mjs --dir path             # where the others write
//
// Entries are named after the channel as this catalogue names it, grouped by
// category so VLC's playlist sidebar is navigable, and carry the iptv-org
// tvg-id so an XMLTV guide can be matched up later.
//
// The URLs themselves come from the openly published iptv-org Greek playlist
// (https://iptv-org.github.io/iptv/countries/gr.m3u); this only renames,
// groups and filters them. Public IPTV URLs rot, so --check is worth the wait.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANNELS, CATEGORIES } from "../public/channels.js";

const args = process.argv.slice(2);
const check = args.includes("--check");

const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

// one | channel | category
const split = flag("--split", "one");
const OUT = flag("--out", fileURLToPath(new URL("../greektv.m3u", import.meta.url)));
const DIR = flag("--dir", fileURLToPath(new URL("../m3u", import.meta.url)));

if (!["one", "channel", "category"].includes(split)) {
  console.error(`--split must be one of: one, channel, category (got "${split}")`);
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const withStream = CHANNELS.filter((c) => c.stream).sort(
  (a, b) => a.cat - b.cat || a.name.localeCompare(b.name, "el")
);

/** Does this URL still serve a playlist? */
async function probe(ch) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 9000);
  try {
    const { host } = new URL(ch.stream);
    const res = await fetch(ch.stream, {
      headers: { "user-agent": UA, referer: `https://${host}/` },
      redirect: "follow",
      signal: ac.signal,
    });
    const body = res.ok ? (await res.text()).slice(0, 300) : "";
    return { ch, ok: res.ok && body.includes("#EXTM3U"), note: `HTTP ${res.status}` };
  } catch (err) {
    return {
      ch,
      ok: false,
      note: err.name === "AbortError" ? "timeout" : err.cause?.code || err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `jobs` with a bounded number in flight. */
async function pool(items, worker, size = 12) {
  const queue = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) results.push(await worker(queue.shift()));
    })
  );
  return results;
}

let live = withStream;
let dead = [];

if (check) {
  process.stdout.write(`Probing ${withStream.length} streams`);
  const results = await pool(withStream, async (ch) => {
    const r = await probe(ch);
    process.stdout.write(r.ok ? "." : "x");
    return r;
  });
  process.stdout.write("\n\n");

  const byId = new Map(results.map((r) => [r.ch.id, r]));
  live = withStream.filter((c) => byId.get(c.id).ok);
  dead = withStream.filter((c) => !byId.get(c.id).ok).map((c) => ({ ch: c, note: byId.get(c.id).note }));
}

function entry(ch) {
  const group = CATEGORIES[ch.cat].label;
  const attrs = [
    ch.tvg ? `tvg-id="${ch.tvg}"` : null,
    `tvg-name="${ch.name}"`,
    `group-title="${group}"`,
  ]
    .filter(Boolean)
    .join(" ");
  return `#EXTINF:-1 ${attrs},${ch.name}\n${ch.stream}`;
}

/** A playlist body for `list`, optionally with `# --- group ---` dividers. */
function playlist(list, title, { dividers = false } = {}) {
  const lines = ["#EXTM3U", `#PLAYLIST:${title}`, ""];
  let currentGroup = null;
  for (const ch of list) {
    const group = CATEGORIES[ch.cat].label;
    if (dividers && group !== currentGroup) {
      lines.push(`# --- ${group} ---`);
      currentGroup = group;
    }
    lines.push(entry(ch));
  }
  lines.push("");
  return lines.join("\n");
}

// Windows forbids \ / : * ? " < > | in a filename. Greek letters are fine.
const safeName = (s) =>
  s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().replace(/\.+$/, "");

const suffix = check ? " (verified)" : "";

if (split === "one") {
  await writeFile(OUT, playlist(live, `Greek TV Dial${suffix}`, { dividers: true }), "utf8");
  console.log(`Wrote ${live.length} channels to ${OUT}`);
} else if (split === "channel") {
  const dir = join(DIR, "channels");
  await mkdir(dir, { recursive: true });
  const used = new Map();
  for (const ch of live) {
    // Two channels can share a display name; keep both by appending the id.
    let base = safeName(ch.name);
    if (used.has(base)) base = `${base} (${ch.id})`;
    used.set(base, ch.id);
    await writeFile(join(dir, `${base}.m3u`), playlist([ch], ch.name), "utf8");
  }
  console.log(`Wrote ${live.length} single-channel playlists to ${dir}`);
} else {
  const dir = join(DIR, "categories");
  await mkdir(dir, { recursive: true });
  let written = 0;
  for (const [index, cat] of CATEGORIES.entries()) {
    const group = live.filter((ch) => ch.cat === index);
    if (!group.length) continue; // no empty playlists
    await writeFile(
      join(dir, `${safeName(cat.label)}.m3u`),
      playlist(group, `${cat.label}${suffix}`),
      "utf8"
    );
    console.log(`  ${cat.label.padEnd(14)} ${group.length}`);
    written++;
  }
  console.log(`Wrote ${written} category playlists to ${dir}`);
}

if (check) {
  console.log(`\nExcluded ${dead.length} that did not answer:`);
  for (const d of dead) console.log(`  ${String(d.ch.id).padEnd(5)} ${d.ch.name.padEnd(22)} ${d.note}`);
}
