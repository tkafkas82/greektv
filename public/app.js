// Greek TV Dial - grid, search, guide overlay and player.

// Root-absolute so a /c/<slug> deep link doesn't resolve this to /c/channels.js.
import { CHANNELS, CATEGORIES, CATEGORY_ORDER, RELAY_ONLY_HOSTS } from "/channels.js";
import { RESOLVERS, acceptableUrl } from "/resolvers.js";

const EPG_REFRESH_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;
// Tracks change far faster than programmes, but each poll reads a live stream
// server-side, so this is as tight as is polite to the stations.
const SONG_REFRESH_MS = 35 * 1000;
// How long a stream stays written off after it fails. Public IPTV URLs come
// back as often as they go away, so this is a memory with a short fuse, not a
// permanent verdict.
const DEAD_TTL_MS = 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- storage */
// Any of these can throw (private windows, blocked site data), so every access
// is guarded and the page renders correctly when storage is unavailable.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* nothing to do - favourites are a convenience, not state we own */
    }
  },
};

const favs = new Set(Array.isArray(store.get("greektv.favs", [])) ? store.get("greektv.favs", []) : []);

/* ---------------------------------------------------- dead-stream memory --
   13 of the 65 shipped stream URLs were already dead when this was written,
   and which ones will differ by the time you read it. Rather than freeze a
   verdict into the catalogue, the app remembers what failed on this machine:
   a channel whose stream dies goes straight to its embedded page next time,
   and its card stops promising direct video. Entries expire after
   DEAD_TTL_MS, and a stream that plays clears its own entry, so recovery
   needs no intervention. */
let dead = store.get("greektv.deadStreams", {});
if (!dead || typeof dead !== "object" || Array.isArray(dead)) dead = {};

function saveDead() {
  store.set("greektv.deadStreams", dead);
}

/** Drop entries that have outlived the TTL, so those streams get another go. */
function pruneDead() {
  const now = Date.now();
  let changed = false;
  for (const [id, at] of Object.entries(dead)) {
    if (typeof at !== "number" || now - at >= DEAD_TTL_MS) {
      delete dead[id];
      changed = true;
    }
  }
  if (changed) saveDead();
}
pruneDead();

const isDead = (id) => typeof dead[id] === "number" && Date.now() - dead[id] < DEAD_TTL_MS;

function markDead(id) {
  dead[id] = Date.now();
  saveDead();
}

function clearDead(id) {
  if (dead[id] === undefined) return;
  delete dead[id];
  saveDead();
}

/** True when we expect this channel to play video rather than an embed. */
const playsDirect = (ch) => Boolean(ch.stream) && !isDead(ch.id);
const directCount = () => CHANNELS.filter(playsDirect).length;

/* ------------------------------------------------------------ text utils */
// Greek keyboard -> Latin, so typing "σκαι" finds "Skai".
const GREEK_LATIN = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
  κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s",
  ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const latinise = (s) => fold(s).replace(/[α-ως]/g, (c) => GREEK_LATIN[c] || c);

const STOPWORDS = new Set(["of", "the", "tv", "and", "la", "de", "channel"]);
function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  const meaty = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const use = meaty.length ? meaty : words;
  if (!use.length) return "TV";
  if (use.length === 1) return use[0].slice(0, 2).toUpperCase();
  return (use[0][0] + use[1][0]).toUpperCase();
}

const clock = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

for (const ch of CHANNELS) {
  ch.searchKey = `${fold(ch.name)} ${ch.slug.replace(/-/g, " ")}`;
  ch.initials = initials(ch.name);
}

/* ------------------------------------------------------------------ state */
const state = {
  query: "",
  category: null,
  sort: "cat",
  onlyPlayable: true,
  onlyGuide: false,
};

/** channel id -> { now, next } from /api/epg */
let guide = new Map();
let guideMeta = null;

function visible() {
  const raw = state.query.trim();
  const terms = [];
  if (raw) {
    terms.push(fold(raw));
    const lat = latinise(raw);
    if (lat !== fold(raw)) terms.push(lat);
  }

  return CHANNELS.filter((ch) => {
    if (state.category !== null && ch.cat !== state.category) return false;
    if (state.onlyPlayable && !playsDirect(ch)) return false;
    if (state.onlyGuide && !guide.has(ch.id)) return false;
    if (!terms.length) return true;
    return terms.some((t) => ch.searchKey.includes(t));
  });
}

/* ------------------------------------------------------------------ cards */
const out = document.getElementById("out");
const countEl = document.getElementById("count");

function card(ch) {
  const cat = CATEGORIES[ch.cat];
  const el = document.createElement("article");
  el.className = "ch";
  el.style.setProperty("--h", cat.hue);
  el.dataset.id = ch.id;

  // The whole card opens the in-page player. The small ↗ is the only way out
  // to greektv.live, so an ordinary click never navigates the tab away.
  el.innerHTML =
    `<button class="hit" type="button"></button>` +
    `<span class="plate" aria-hidden="true">` +
      `<span class="ini"></span>` +
      `<span class="play"><svg><use href="#i-play"/></svg></span>` +
    `</span>` +
    `<span class="info">` +
      `<span class="nm"></span>` +
      `<span class="sub">` +
        `<span class="cn"></span><span>${cat.label}</span>` +
        `<span class="${playsDirect(ch) ? "live" : "web"}">${playsDirect(ch) ? "LIVE" : "WEB"}</span>` +
      `</span>` +
      `<span class="now none">—</span>` +
    `</span>` +
    `<span class="acts">` +
      `<a class="ext" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-ext"/></svg></a>` +
      `<button class="fav" type="button"><svg><use href="#i-star-o"/></svg></button>` +
    `</span>` +
    `<span class="prog" hidden><span class="track"><span class="fill"></span></span><span class="times"></span></span>`;

  el.querySelector(".ini").textContent = ch.initials;
  el.querySelector(".nm").textContent = ch.name;
  el.querySelector(".cn").textContent = String(ch.id).padStart(3, "0");

  const hit = el.querySelector(".hit");
  hit.setAttribute("aria-label", `Παρακολούθηση ${ch.name}`);
  hit.addEventListener("click", () => (player.hasAttribute("open") ? loadChannel(ch) : openPlayer(ch)));

  const ext = el.querySelector(".ext");
  ext.href = ch.watchUrl;
  ext.setAttribute("aria-label", `${ch.name} στο greektv.live`);
  ext.title = "Άνοιγμα στο greektv.live";
  ext.addEventListener("click", (ev) => ev.stopPropagation());

  const star = el.querySelector(".fav");
  paintFav(star, favs.has(ch.id));
  star.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const on = !favs.has(ch.id);
    if (on) favs.add(ch.id);
    else favs.delete(ch.id);
    store.set("greektv.favs", [...favs]);
    paintFav(star, on);
    if (playing && playing.id === ch.id) paintPlayerFav();
    if (state.sort === "cat") render();
  });

  paintNow(el, ch);
  return el;
}

function paintFav(btn, on) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "Αφαίρεση από τα αγαπημένα" : "Προσθήκη στα αγαπημένα");
  btn.querySelector("use").setAttribute("href", on ? "#i-star" : "#i-star-o");
}

/** Write the now-playing line and progress bar into an existing card. */
function paintNow(el, ch) {
  const nowEl = el.querySelector(".now");
  const progEl = el.querySelector(".prog");

  // Radio is not in Digea's guide and never will be, so the song takes the slot
  // the programme title would occupy. There is no progress bar to draw.
  if (ch.audio) {
    const song = songs.get(ch.id);
    progEl.hidden = true;
    nowEl.className = song && song.text ? "now" : "now none";
    nowEl.textContent = song && song.text ? song.text : "—";
    nowEl.title = song && song.text ? song.text : "";
    return;
  }

  const entry = guide.get(ch.id);
  const now = entry && entry.now;

  if (!now) {
    nowEl.className = "now none";
    nowEl.textContent = guideMeta ? "Χωρίς πρόγραμμα" : "—";
    nowEl.title = guideMeta
      ? "Αυτό το κανάλι δεν καλύπτεται από τον οδηγό της Digea."
      : "";
    progEl.hidden = true;
    return;
  }

  nowEl.className = "now";
  nowEl.innerHTML = `<span class="t"></span>${now.rating ? '<span class="rating"></span>' : ""}`;
  nowEl.querySelector(".t").textContent = now.title;
  nowEl.title = now.title;
  if (now.rating) nowEl.querySelector(".rating").textContent = now.rating;

  progEl.hidden = false;
  const pct = typeof now.progress === "number" ? now.progress : 0;
  progEl.querySelector(".fill").style.width = `${pct}%`;
  progEl.querySelector(".times").textContent = `${clock(now.start)}–${clock(now.stop)}`;
}

function section(title, hue, list) {
  const sec = document.createElement("section");
  sec.className = "sec";
  const head = document.createElement("div");
  head.className = "sechead";
  if (hue !== null) head.style.setProperty("--h", hue);
  head.innerHTML =
    (hue !== null ? '<span class="dot"></span>' : "") +
    '<h2></h2><span class="rule"></span><span class="n"></span>';
  head.querySelector("h2").textContent = title;
  head.querySelector(".n").textContent = list.length;
  sec.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const ch of list) grid.appendChild(card(ch));
  sec.appendChild(grid);
  return sec;
}

function render() {
  const list = visible();

  // Counts derive from the same dead-stream memory the cards do, so they are
  // refreshed here rather than by each caller - the two can't drift apart.
  // Before the early return below, so an empty result still updates them.
  refreshCounts();

  countEl.innerHTML = "";
  const strong = document.createElement("b");
  strong.textContent = list.length;
  countEl.append(
    strong,
    document.createTextNode(
      ` ${list.length === 1 ? "κανάλι" : "κανάλια"}` +
        (state.category !== null ? ` · ${CATEGORIES[state.category].label}` : "") +
        (state.query.trim() ? ` · "${state.query.trim()}"` : "")
    )
  );

  if (!list.length) {
    out.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "<b>Κανένα κανάλι</b>Δοκιμάστε άλλη λέξη ή αφαιρέστε ένα φίλτρο.";
    out.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  if (state.sort === "az") {
    frag.appendChild(section("Αλφαβητικά", null, [...list].sort((a, b) => a.name.localeCompare(b.name, "el"))));
  } else if (state.sort === "num") {
    frag.appendChild(section("Κατά αριθμό καναλιού", null, [...list].sort((a, b) => a.id - b.id)));
  } else {
    const pinned = list.filter((ch) => favs.has(ch.id));
    if (pinned.length) frag.appendChild(section("Αγαπημένα", null, pinned));
    for (const index of CATEGORY_ORDER) {
      const cat = CATEGORIES[index];
      const group = list.filter((ch) => ch.cat === index && !favs.has(ch.id));
      if (group.length) frag.appendChild(section(cat.label, cat.hue, group));
    }
  }

  out.innerHTML = "";
  out.appendChild(frag);

  // Keep the player's reel in step with what the grid is showing.
  if (player.hasAttribute("open")) buildSwitcher();
}

/** Refresh just the guide lines, without rebuilding the grid. */
function repaintGuide() {
  for (const el of out.querySelectorAll(".ch")) {
    const ch = CHANNELS.find((c) => c.id === Number(el.dataset.id));
    if (ch) paintNow(el, ch);
  }
  if (playing) paintPlayerGuide(playing);

  // The switcher shows each channel's current programme too.
  for (const btn of switchList.querySelectorAll(".sw")) {
    const ch = CHANNELS.find((c) => c.id === Number(btn.dataset.id));
    if (!ch) continue;
    const entry = guide.get(ch.id);
    btn.querySelector(".g").textContent =
      entry && entry.now ? entry.now.title : CATEGORIES[ch.cat].label;
  }
}

/* ------------------------------------------------------------------- rail */
const catsEl = document.getElementById("cats");

function buildRail() {
  const rows = [
    { label: "Όλα τα κανάλια", hue: null, index: null, n: CHANNELS.length },
    ...CATEGORY_ORDER.map((index) => ({
      label: CATEGORIES[index].label,
      hue: CATEGORIES[index].hue,
      index,
      n: CHANNELS.filter((ch) => ch.cat === index).length,
    })),
  ];

  for (const row of rows) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat";
    if (row.hue !== null) btn.style.setProperty("--h", row.hue);
    btn.setAttribute("aria-pressed", state.category === row.index ? "true" : "false");
    btn.innerHTML =
      `<span class="dot"${row.hue === null ? ' style="background:var(--muted)"' : ""}></span>` +
      '<span class="lbl"></span><span class="n"></span>';
    btn.querySelector(".lbl").textContent = row.label;
    btn.querySelector(".n").textContent = row.n;
    btn.addEventListener("click", () => {
      state.category = row.index;
      for (const other of catsEl.querySelectorAll(".cat")) other.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-pressed", "true");
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    li.appendChild(btn);
    catsEl.appendChild(li);
  }
}

/* ------------------------------------------------------------------ guide */
const statusEl = document.getElementById("guide-status");
const statusText = document.getElementById("guide-text");

async function loadGuide() {
  try {
    const res = await fetch(`/api/epg?at=${Date.now()}`, { headers: { accept: "application/json" } });

    // A misconfigured deployment serves an HTML error page here, so don't let a
    // JSON parse failure surface as a raw SyntaxError.
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        res.ok
          ? "η απάντηση του /api/epg δεν ήταν JSON — τρέχει ο διακομιστής Node;"
          : `HTTP ${res.status} από το /api/epg`
      );
    }

    if (!res.ok || !data.channels || !Object.keys(data.channels).length) {
      guide = new Map();
      guideMeta = null;
      statusEl.className = "guide-status warn";
      statusText.textContent = res.ok
        ? "Ο οδηγός προγράμματος δεν επέστρεψε δεδομένα. Τα κανάλια λειτουργούν κανονικά."
        : `Ο οδηγός προγράμματος δεν είναι διαθέσιμος (${data.detail || res.status}).`;
      repaintGuide();
      return;
    }

    guide = new Map(Object.entries(data.channels).map(([id, v]) => [Number(id), v]));
    guideMeta = data;

    statusEl.className = "guide-status ok";
    statusText.innerHTML =
      `Πρόγραμμα για <b>${guide.size}</b> από ${CHANNELS.length} κανάλια · πηγή ` +
      `<a href="https://www.digea.gr" target="_blank" rel="noopener">digea.gr</a> · ` +
      `ανανέωση ${clock(data.fetchedAt)}`;
  } catch (err) {
    guide = new Map();
    guideMeta = null;
    statusEl.className = "guide-status warn";
    statusText.textContent = `Ο οδηγός προγράμματος δεν φορτώθηκε (${err}).`;
  }
  repaintGuide();
}

/* ----------------------------------------------------------------- player */
const player = document.getElementById("player");
const video = document.getElementById("p-video");
const frame = document.getElementById("p-frame");
const note = document.getElementById("p-note");
const noteTitle = document.getElementById("p-note-title");
const noteBody = document.getElementById("p-note-body");
const spinner = document.getElementById("p-spin");
const embedNote = document.getElementById("p-embed-note");
const radio = document.getElementById("radio");
const radioStage = document.getElementById("p-radio");
const minibar = document.getElementById("minibar");
const switchList = document.getElementById("p-switch-list");
const switchCount = document.getElementById("p-switch-count");

let hls = null;
let playing = null;
/**
 * The station loaded into the persistent <audio>. It outlives the overlay on
 * purpose - closing the player leaves the radio running and the mini bar up -
 * so it is tracked separately from `playing`, which is only what the overlay is
 * currently showing.
 */
let radioCh = null;
/** channel id -> { artist, title, text } from /api/nowplaying */
let songs = new Map();
/** The URL actually attached, which for a resolved channel is not ch.stream. */
let playingUrl = null;
let usedRelay = false;
let lastFocus = null;
/** The channels the prev/next buttons and the switcher walk through. */
let reel = [];

const relayUrl = (url) => `/api/stream?u=${encodeURIComponent(url)}`;

/** True when this host is known to refuse a fetch made from the page. */
function relayOnly(url) {
  if (!RELAY_ONLY_HOSTS.size) return false;
  try {
    return RELAY_ONLY_HOSTS.has(new URL(url).host.toLowerCase());
  } catch {
    return false;
  }
}

/* ---- routing ------------------------------------------------------------
   /c/<slug> is the canonical deep link. #ch=<id> is kept working because it
   was the first scheme shipped and may already be bookmarked. Both accept an
   id or a slug. */
const DEFAULT_EMBED_NOTE = embedNote.innerHTML;
const BASE_TITLE = document.title;
const channelPath = (ch) => `/c/${ch.slug}`;
const channelLink = (ch) => `${location.origin}${channelPath(ch)}`;

function lookup(key) {
  const k = decodeURIComponent(String(key)).toLowerCase();
  return CHANNELS.find((c) => c.slug === k) || CHANNELS.find((c) => String(c.id) === k) || null;
}

/** The channel the current URL points at, or null for the plain grid. */
function channelFromUrl() {
  const path = /^\/c\/([^/]+)\/?$/.exec(location.pathname);
  if (path) return lookup(path[1]);
  const hash = /^#ch=(.+)$/.exec(location.hash);
  if (hash) return lookup(hash[1]);
  return null;
}

function showNote(title, bodyHtml, { spin = false } = {}) {
  noteTitle.textContent = title;
  noteBody.innerHTML = bodyHtml;
  spinner.style.display = spin ? "" : "none";
  note.setAttribute("open", "");
}
const hideNote = () => note.removeAttribute("open");

function teardown() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.removeAttribute("src");
  video.load();
  // Blanking the iframe matters: an embedded channel page left with its src
  // intact keeps playing audio behind the next channel.
  if (frame.getAttribute("src")) frame.removeAttribute("src");
  frame.hidden = true;
  video.hidden = false;
  embedNote.hidden = true;
  // Deliberately does not stop `radio`: teardown clears the visual stage, and
  // the radio element is meant to survive both a channel switch and a close.
  radioStage.hidden = true;
}

function attach(url, { audio = false } = {}) {
  teardown();

  // Radio is a continuous Icecast stream, not a manifest - hls.js would reject
  // it outright. It also plays through its own element outside the overlay, so
  // that closing the player leaves the sound on.
  if (audio) {
    radioCh = playing;
    // Re-attaching the same URL would restart the stream, which for live radio
    // is a pointless gap in the audio.
    if (radio.getAttribute("src") !== url) {
      radio.src = url;
      radio.play().catch(() => {});
    } else if (radio.paused) {
      radio.play().catch(() => {});
    }
    showRadioStage();
    paintMiniBar();
    return;
  }

  // hls.js first, always. Chrome reports "maybe" for canPlayType of an HLS
  // manifest but cannot actually play one without MSE, so trusting that check
  // ahead of hls.js leaves the element erroring out on a stream that would
  // otherwise have worked.
  if (window.Hls && window.Hls.isSupported()) {
    // Short, shallow retries on purpose. A dead public URL should hand over to
    // the embedded page in a few seconds; hls.js's defaults spend far longer
    // retrying a host that is never going to answer.
    hls = new window.Hls({
      lowLatencyMode: false,
      enableWorker: true,
      backBufferLength: 30,
      manifestLoadingTimeOut: 6000,
      manifestLoadingMaxRetry: 1,
      manifestLoadingRetryDelay: 500,
      levelLoadingTimeOut: 6000,
      levelLoadingMaxRetry: 1,
      fragLoadingTimeOut: 12000,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      hideNote();
      // It answered, so forget any past failure and let the card say LIVE again.
      if (playing && dead[playing.id] !== undefined) {
        clearDead(playing.id);
        render();
      }
      video.play().catch(() => {});
    });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) retryOrFail(data.details || "Η ροή δεν αποκρίνεται");
    });
    return;
  }

  // Safari: native HLS through the media element, no CORS preflight needed.
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.play().catch(() => {});
    return;
  }

  failed("Ο browser δεν υποστηρίζει HLS");
}

/* ------------------------------------------------------------- radio bar */
/** What a station is playing, or an em dash when nothing is published. */
const songText = (ch) => {
  const song = songs.get(ch.id);
  return song && song.text ? song.text : "—";
};

function showRadioStage() {
  video.hidden = true;
  frame.hidden = true;
  radioStage.hidden = false;
  document.getElementById("rs-plate").textContent = playing ? playing.initials : "";
  document.getElementById("rs-name").textContent = playing ? playing.name : "";
  document.getElementById("rs-now").textContent = playing ? songText(playing) : "—";
  hideNote();
}

/** The bar shows only when a station is loaded and the overlay is not up. */
function paintMiniBar() {
  if (!radioCh) {
    minibar.hidden = true;
    document.body.classList.remove("with-bar");
    return;
  }
  minibar.hidden = player.hasAttribute("open");
  document.body.classList.toggle("with-bar", !minibar.hidden);
  minibar.style.setProperty("--h", CATEGORIES[radioCh.cat].hue);
  document.getElementById("mb-plate").textContent = radioCh.initials;
  document.getElementById("mb-name").textContent = radioCh.name;
  document.getElementById("mb-now").textContent = songText(radioCh);

  const toggle = document.getElementById("mb-toggle");
  toggle.textContent = radio.paused ? "▶" : "⏸";
  toggle.setAttribute("aria-label", radio.paused ? "Αναπαραγωγή" : "Παύση");
}

/** Stop the radio outright - switching to another channel, or the ✕ button. */
function stopRadio() {
  if (!radioCh) return;
  radio.pause();
  radio.removeAttribute("src");
  radio.load();
  radioCh = null;
  minibar.hidden = true;
  document.body.classList.remove("with-bar");
}

document.getElementById("mb-toggle").addEventListener("click", () => {
  if (radio.paused) radio.play().catch(() => {});
  else radio.pause();
  paintMiniBar();
});
document.getElementById("mb-stop").addEventListener("click", stopRadio);
document.getElementById("mb-open").addEventListener("click", () => {
  if (radioCh) openPlayer(radioCh);
});
radio.addEventListener("play", paintMiniBar);
radio.addEventListener("pause", paintMiniBar);
radio.addEventListener("error", () => {
  // Only meaningful while a station is actually loaded; removeAttribute("src")
  // in stopRadio() raises a synthetic error we must ignore.
  if (!radioCh || !radio.getAttribute("src")) return;
  if (playing && playing.id === radioCh.id) retryOrFail("Η ροή δεν αποκρίνεται");
  else stopRadio();
});

/* --------------------------------------------------------- what's playing */
async function loadSongs() {
  if (!CHANNELS.some((ch) => ch.audio)) return;
  try {
    const res = await fetch("/api/nowplaying", { headers: { accept: "application/json" } });
    const data = await res.json();
    songs = new Map(
      Object.entries(data.stations || {}).map(([id, v]) => [Number(id), v]).filter(([, v]) => v)
    );
  } catch {
    // Leave the previous answer in place; a blip shouldn't blank every title.
    return;
  }
  repaintSongs();
}

/** Push fresh titles into the three places they appear. */
function repaintSongs() {
  for (const el of out.querySelectorAll(".ch")) {
    const ch = CHANNELS.find((c) => c.id === Number(el.dataset.id));
    if (ch && ch.audio) paintNow(el, ch);
  }
  if (playing && playing.audio) {
    document.getElementById("rs-now").textContent = songText(playing);
    paintPlayerGuide(playing);
  }
  if (radioCh) paintMiniBar();
}

/** A direct hit usually dies on CORS or mixed content; the relay fixes both. */
function retryOrFail(reason) {
  if (!usedRelay && playing) {
    usedRelay = true;
    showNote("Δοκιμή μέσω διακομιστή…", "Η απευθείας σύνδεση απέτυχε.", { spin: true });
    attach(relayUrl(playingUrl), { audio: playing.audio });
    return;
  }
  failed(reason);
}

/**
 * Public IPTV URLs rot, so a dead stream must not be a dead end. Fall back to
 * the channel's own page - the same thing WEB channels use - so the viewer
 * still gets picture without leaving the grid.
 */
function failed(reason) {
  const ch = playing;
  teardown();
  if (!ch) return;

  // Remember it, so the next visit skips the wait and the card stops claiming
  // direct video. render() repaints the LIVE/WEB tags.
  if (ch.stream) {
    markDead(ch.id);
    render();
  }

  showEmbed(ch, reason);
}

function paintPlayerGuide(ch) {
  const entry = guide.get(ch.id);
  const nowEl = document.getElementById("p-now");
  const nextEl = document.getElementById("p-next");

  if (ch.audio) {
    const song = songs.get(ch.id);
    nowEl.className = song && song.text ? "v" : "v dim";
    nowEl.textContent = song && song.text ? song.text : "—";
    nextEl.className = "v dim";
    nextEl.textContent = song && song.artist ? song.artist : "—";
    return;
  }

  if (entry && entry.now) {
    nowEl.className = "v";
    nowEl.textContent =
      `${entry.now.title} · ${clock(entry.now.start)}–${clock(entry.now.stop)}` +
      (entry.now.rating ? ` · ${entry.now.rating}` : "");
  } else {
    nowEl.className = "v dim";
    nowEl.textContent = "Χωρίς πρόγραμμα";
  }

  if (entry && entry.next) {
    nextEl.className = "v";
    nextEl.textContent = `${entry.next.title} · ${clock(entry.next.start)}`;
  } else {
    nextEl.className = "v dim";
    nextEl.textContent = "—";
  }
}

/**
 * The switcher walks whatever the grid is currently showing, so a search or a
 * category filter carries into the player instead of being forgotten there.
 */
/**
 * The reel holds only what is the same kind as the channel playing: the six
 * stations while a station is on, the TV channels otherwise. Stepping from a
 * station straight into a TV channel is never what zapping means, and on radio
 * the list should be the other stations rather than all 71 playable channels.
 */
const reelFor = (ch) => visible().filter((c) => Boolean(c.audio) === Boolean(ch && ch.audio));

function buildSwitcher() {
  reel = reelFor(playing);
  const radio = playing && playing.audio;
  switchCount.textContent = `${radio ? "Σταθμοί" : "Κανάλια"} · ${reel.length}`;

  const frag = document.createDocumentFragment();
  for (const ch of reel) {
    const entry = guide.get(ch.id);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sw";
    btn.style.setProperty("--h", CATEGORIES[ch.cat].hue);
    btn.dataset.id = ch.id;
    btn.setAttribute("aria-current", playing && playing.id === ch.id ? "true" : "false");
    btn.innerHTML =
      '<span class="mini" aria-hidden="true"></span>' +
      '<span class="body"><span class="t"></span><span class="g"></span></span>' +
      `<span class="tag${playsDirect(ch) ? " on" : ""}"></span>`;
    btn.querySelector(".mini").textContent = ch.initials;
    btn.querySelector(".t").textContent = ch.name;
    btn.querySelector(".g").textContent =
      entry && entry.now ? entry.now.title : CATEGORIES[ch.cat].label;
    btn.querySelector(".tag").textContent = playsDirect(ch) ? "LIVE" : "WEB";
    btn.addEventListener("click", () => loadChannel(ch));
    li.appendChild(btn);
    frag.appendChild(li);
  }

  switchList.innerHTML = "";
  switchList.appendChild(frag);
  markCurrent();
}

function markCurrent() {
  for (const btn of switchList.querySelectorAll(".sw")) {
    const on = playing && Number(btn.dataset.id) === playing.id;
    btn.setAttribute("aria-current", on ? "true" : "false");
    if (on) btn.scrollIntoView({ block: "nearest" });
  }
  const at = playing ? reel.findIndex((c) => c.id === playing.id) : -1;
  document.getElementById("p-prev").disabled = at <= 0;
  document.getElementById("p-next-ch").disabled = at < 0 || at >= reel.length - 1;
}

const RESOLVE_TIMEOUT_MS = 6000;

// Whether this browser can reach the broadcaster cross-origin. Unknown until we
// try; once it has failed, stop paying for a request that won't work here, and
// let a reload find out again. Cloudflare sits in front of these endpoints and
// does not always answer a cross-origin fetch the way it answers the player's
// own same-origin one.
let canResolveHere = null;

/** Ask the broadcaster directly. Kept a simple CORS GET so it needs no preflight. */
async function resolveHere(resolver) {
  if (canResolveHere === false) return null;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetch(resolver.endpoint, { signal: abort.signal });
    if (!res.ok) return null;
    const url = acceptableUrl(resolver.pick(await res.json()), resolver);
    // A reachable endpoint that returned something we reject is not a reason to
    // stop asking - the next answer may be fine.
    canResolveHere = true;
    return url;
  } catch {
    canResolveHere = false;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Current URL for a channel whose broadcaster rotates it.
 *
 * The page asks the broadcaster itself before asking our own route, because
 * these endpoints answer per region and the viewer is the one in the right
 * country - the same question from Vercel's Frankfurt region comes back with an
 * "out of Greece" placeholder. /api/resolve covers browsers that can't make the
 * cross-origin request. Either way a failure yields the catalogue URL rather
 * than nothing, so an outage never trips markDead() on its own.
 */
async function resolveStream(ch) {
  const resolver = RESOLVERS[ch.id];
  if (!resolver) return ch.stream;

  const here = await resolveHere(resolver);
  if (here) return here;

  try {
    const res = await fetch(`/api/resolve?ch=${ch.id}`, { headers: { accept: "application/json" } });
    const data = await res.json();
    return data.stream || ch.stream;
  } catch {
    return ch.stream;
  }
}

/**
 * Swap the player over to `ch` without closing it.
 * @param {object} ch
 * @param {{push?: boolean}} opts push=false when replaying a history entry,
 *        so stepping back through channels doesn't append new ones.
 */
async function loadChannel(ch, { push = true } = {}) {
  teardown();
  // Anything other than the station already loaded takes over the audio.
  if (radioCh && (!ch.audio || ch.id !== radioCh.id)) stopRadio();
  playing = ch;

  // The reel is scoped by kind, so crossing between radio and TV - by deep
  // link, or by Back - has to rebuild it. Switching within a kind does not.
  if (player.hasAttribute("open") && reel.some((c) => Boolean(c.audio) !== Boolean(ch.audio))) {
    buildSwitcher();
  }
  playingUrl = ch.stream;
  usedRelay = false;

  const cat = CATEGORIES[ch.cat];
  player.style.setProperty("--h", cat.hue);
  document.getElementById("p-plate").textContent = ch.initials;
  document.getElementById("p-name").textContent = ch.name;
  document.getElementById("p-meta").textContent = `${String(ch.id).padStart(3, "0")} · ${cat.label}`;
  document.getElementById("p-out").href = ch.watchUrl;
  paintPlayerGuide(ch);
  paintPlayerFav();
  markCurrent();

  // Reflect the channel in the URL so it survives a reload, can be shared, and
  // gives the browser's Back button something to step through.
  document.title = `${ch.name} · Greek TV Dial`;
  if (push && location.pathname !== channelPath(ch)) {
    history.pushState({ ch: ch.id }, "", channelPath(ch));
  }

  if (playsDirect(ch)) {
    showNote("Σύνδεση…", "Φόρτωση ροής.", { spin: true });

    const url = await resolveStream(ch);
    // Zapping and Back both re-enter this while a resolve is in flight.
    if (playing !== ch) return;
    playingUrl = url;

    // Skip a direct attempt that cannot work: an http stream never loads on an
    // https page, and a host in RELAY_ONLY_HOSTS refuses the page outright.
    // Either way, going straight to the relay saves the viewer a timeout.
    const mustRelay =
      (url.startsWith("http://") && location.protocol === "https:") || relayOnly(url);
    if (mustRelay) usedRelay = true;
    attach(mustRelay ? relayUrl(url) : url, { audio: ch.audio });
    return;
  }

  // Either the channel never had an open stream, or one failed here recently
  // and we remembered. Straight to the embedded page - no waiting on a host
  // we already know doesn't answer.
  showEmbed(ch, ch.stream ? "remembered" : null);
}

/**
 * Put the channel's own greektv.live page in the stage, which keeps the grid
 * one click away instead of navigating the tab off.
 * @param {object} ch
 * @param {string|null} reason null when the channel simply has no open stream,
 *        "remembered" when one failed here before, otherwise the hls.js detail.
 */
function showEmbed(ch, reason) {
  hideNote();
  video.hidden = true;
  frame.hidden = false;
  embedNote.hidden = false;

  if (reason === null) {
    embedNote.innerHTML = DEFAULT_EMBED_NOTE;
  } else {
    embedNote.textContent = "";
    embedNote.append(
      reason === "remembered"
        ? "Η ροή αυτού του καναλιού απέτυχε πρόσφατα, γι' αυτό φορτώθηκε κατευθείαν η σελίδα του. Πατήστε "
        : `Η ροή δεν αποκρίθηκε (${reason}), γι' αυτό φορτώθηκε η σελίδα του καναλιού. Πατήστε `
    );
    const strong = document.createElement("b");
    strong.textContent = "Δείτε Τώρα";
    embedNote.append(strong, " εκεί για να ξεκινήσει. ");

    // Lets a recovered stream be picked up without waiting out the TTL.
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry";
    retry.textContent = "Δοκιμή ροής ξανά";
    retry.addEventListener("click", () => {
      clearDead(ch.id);
      render();
      loadChannel(ch, { push: false });
    });
    embedNote.append(retry);
  }

  frame.src = ch.watchUrl;
}

function stepChannel(delta) {
  if (!playing || !reel.length) return;
  const at = reel.findIndex((c) => c.id === playing.id);
  if (at < 0) return;
  const next = reel[at + delta];
  if (next) loadChannel(next);
}

function paintPlayerFav() {
  if (!playing) return;
  const btn = document.getElementById("p-fav");
  const on = favs.has(playing.id);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "Αφαίρεση από τα αγαπημένα" : "Προσθήκη στα αγαπημένα");
  btn.querySelector("use").setAttribute("href", on ? "#i-star" : "#i-star-o");
}

function openPlayer(ch, { push = true } = {}) {
  lastFocus = document.activeElement;
  playing = ch;
  player.setAttribute("open", "");
  document.body.style.overflow = "hidden";
  minibar.hidden = true;
  document.body.classList.remove("with-bar");
  buildSwitcher();
  loadChannel(ch, { push });
  document.getElementById("p-close").focus();
}

function closePlayer({ push = true } = {}) {
  teardown();
  player.removeAttribute("open");
  document.body.style.overflow = "";
  playing = null;
  playingUrl = null;
  hideNote();
  // teardown() left the radio running on purpose; the bar takes it from here.
  paintMiniBar();
  document.title = BASE_TITLE;
  if (push && channelFromUrl()) history.pushState({}, "", "/");
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}

// Back and Forward move through the channels visited, and back out of the
// player entirely at the start. Nothing here pushes new entries.
window.addEventListener("popstate", () => {
  const ch = channelFromUrl();
  if (!ch) {
    if (player.hasAttribute("open")) closePlayer({ push: false });
    return;
  }
  if (!player.hasAttribute("open")) openPlayer(ch, { push: false });
  else if (!playing || playing.id !== ch.id) loadChannel(ch, { push: false });
});

document.getElementById("p-close").addEventListener("click", closePlayer);
document.getElementById("p-prev").addEventListener("click", () => stepChannel(-1));
document.getElementById("p-next-ch").addEventListener("click", () => stepChannel(1));
document.getElementById("p-fav").addEventListener("click", () => {
  if (!playing) return;
  if (favs.has(playing.id)) favs.delete(playing.id);
  else favs.add(playing.id);
  store.set("greektv.favs", [...favs]);
  paintPlayerFav();
  render();
});

// Copy the deep link. Falls back to a hidden textarea because the async
// clipboard API needs a secure context, which plain http://localhost has but
// an http:// LAN address would not.
let copyTimer;
document.getElementById("p-copy").addEventListener("click", async () => {
  if (!playing) return;
  const btn = document.getElementById("p-copy");
  const link = channelLink(playing);
  let ok = true;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link);
    } else {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
  } catch {
    ok = false;
  }

  btn.querySelector("use").setAttribute("href", ok ? "#i-check" : "#i-link");
  btn.title = ok ? "Ο σύνδεσμος αντιγράφηκε" : link;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    btn.querySelector("use").setAttribute("href", "#i-link");
    btn.title = "Αντιγραφή συνδέσμου";
  }, 1600);
});

player.addEventListener("click", (ev) => {
  if (ev.target === player) closePlayer();
});
// Native playback - radio, and HLS in Safari - never reaches the hls.js
// MANIFEST_PARSED handler, so this is where those streams clear their own
// dead-stream entry. Without it a station that recovered would stay WEB for a
// day even while it was audibly playing.
video.addEventListener("playing", () => {
  hideNote();
  if (playing && dead[playing.id] !== undefined) {
    clearDead(playing.id);
    render();
  }
});

// Covers the native-playback path: without this a stream the element cannot
// decode would sit on "Σύνδεση…" forever. Ignore the synthetic error that
// teardown() raises when it clears the source.
video.addEventListener("error", () => {
  if (!playing || !video.getAttribute("src")) return;
  retryOrFail("Το βίντεο δεν φορτώθηκε");
});

/* --------------------------------------------------------------- controls */
const input = document.getElementById("q");
const searchWrap = document.getElementById("searchwrap");
let debounce;

input.addEventListener("input", () => {
  searchWrap.classList.toggle("has", input.value.length > 0);
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.query = input.value;
    render();
  }, 90);
});
input.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    input.value = "";
    state.query = "";
    searchWrap.classList.remove("has");
    render();
  }
});

document.addEventListener("keydown", (ev) => {
  if (player.hasAttribute("open")) {
    if (ev.key === "Escape") {
      closePlayer();
      return;
    }
    // Zap through the reel. Skipped while focus is inside the embedded page,
    // which owns its own key handling.
    if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault();
      stepChannel(-1);
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault();
      stepChannel(1);
      return;
    }
    return;
  }
  if (ev.target === input) return;
  if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey) {
    ev.preventDefault();
    input.focus();
    input.select();
  }
  if ((ev.key === "k" || ev.key === "K") && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    input.focus();
    input.select();
  }
});

for (const btn of document.querySelectorAll(".seg button")) {
  btn.addEventListener("click", () => {
    state.sort = btn.dataset.sort;
    for (const other of document.querySelectorAll(".seg button")) other.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-pressed", "true");
    render();
  });
}

document.getElementById("only-playable").addEventListener("change", (ev) => {
  state.onlyPlayable = ev.target.checked;
  render();
});
document.getElementById("only-guide").addEventListener("change", (ev) => {
  state.onlyGuide = ev.target.checked;
  render();
});

// Zapping: a random channel from whatever is on screen, preferring one with an
// open stream so it lands on video rather than an embedded page.
document.getElementById("zap").addEventListener("click", () => {
  const pool = visible();
  if (!pool.length) return;
  const streamable = pool.filter((ch) => ch.stream);
  const from = streamable.length ? streamable : pool;
  const pick = from[Math.floor(Math.random() * from.length)];
  if (player.hasAttribute("open")) loadChannel(pick);
  else openPlayer(pick);
});

/* ------------------------------------------------------------------- boot */
/** The direct-stream count moves as streams die and recover, so it's derived. */
function refreshCounts() {
  const n = directCount();
  const note =
    `Όλα τα κανάλια ανοίγουν στη σελίδα. ${n} παίζουν απευθείας· ` +
    `τα υπόλοιπα φορτώνουν τη σελίδα τους από το ` +
    `<a href="https://www.greektv.live/tv" target="_blank" rel="noopener">greektv.live</a> ενσωματωμένη.`;
  document.getElementById("rail-note").innerHTML = note;
  document.getElementById("rail-note-mobile").innerHTML = note;
  document.getElementById("tagline").textContent =
    `${CHANNELS.length} κανάλια · ${n} με απευθείας ροή`;
}
refreshCounts();

/* -------------------------------------------------------------------- pwa */
// Paint the splash tiles from the same hues as the icon, dismiss it once the
// grid exists, register the worker, and surface an install button only when the
// browser actually offers one.
function splashDown() {
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("gone");
  // Match the CSS transition; removing the node keeps it out of the a11y tree.
  setTimeout(() => el.remove(), 420);
}

function paintSplash() {
  const grid = document.querySelector(".splash-grid");
  if (!grid) return;
  grid.innerHTML = CATEGORIES.slice(0, 9)
    .map((cat, i) => `<i style="background:hsl(${cat.hue} 62% ${i % 2 ? 52 : 44}%);animation-delay:${i * 90}ms"></i>`)
    .join("");
}

function initPwa() {
  paintSplash();

  if ("serviceWorker" in navigator) {
    // True only when a worker is already in charge, i.e. this is a repeat
    // visit. On a first install the page is already running what the new worker
    // would serve, so there is nothing to reload for.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      // Don't yank a running stream out from under the viewer; assets are
      // network-first now, so the next ordinary load picks the new build up
      // anyway. This only makes the current tab catch up sooner.
      if (radioCh || player.hasAttribute("open")) return;
      reloading = true;
      location.reload();
    });

    // After load, so the worker never competes with the first paint or the
    // guide request for bandwidth.
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* an unregistered worker costs nothing - the app is fine without it */
      });
    });
  }

  const btn = document.getElementById("install");
  if (!btn) return;
  let prompt = null;

  window.addEventListener("beforeinstallprompt", (ev) => {
    // Chrome would otherwise show its own mini-infobar; we want the button.
    ev.preventDefault();
    prompt = ev;
    btn.hidden = false;
  });

  btn.addEventListener("click", async () => {
    if (!prompt) return;
    btn.hidden = true;
    prompt.prompt();
    await prompt.userChoice;
    // The event is single-use, so drop it either way and let a later
    // beforeinstallprompt bring the button back if the install was dismissed.
    prompt = null;
  });

  window.addEventListener("appinstalled", () => {
    btn.hidden = true;
    prompt = null;
  });
}

initPwa();

buildRail();
render();
splashDown();
loadGuide();
loadSongs();

// A /c/<slug> path (or a legacy #ch=<id> hash) opens straight into that
// channel, so a reload or a shared link lands back on the same one.
const deepLinked = channelFromUrl();
if (deepLinked) {
  // Canonicalise to /c/<slug> and shed any legacy hash, without adding an
  // entry - Back should leave the site, not re-close the player.
  history.replaceState({ ch: deepLinked.id }, "", channelPath(deepLinked));
  openPlayer(deepLinked, { push: false });
} else if (location.pathname.startsWith("/c/")) {
  // A link to a channel that no longer exists shouldn't leave a dead URL up.
  history.replaceState({}, "", "/");
}

setInterval(loadGuide, EPG_REFRESH_MS);
setInterval(loadSongs, SONG_REFRESH_MS);
// Progress bars creep forward between guide fetches.
setInterval(() => {
  if (!guide.size) return;
  const at = Date.now();
  for (const entry of guide.values()) {
    if (!entry.now) continue;
    const span = entry.now.stop - entry.now.start;
    if (span > 0) {
      entry.now.progress = Math.max(0, Math.min(100, Math.round(((at - entry.now.start) / span) * 100)));
    }
  }
  repaintGuide();
}, TICK_MS);
