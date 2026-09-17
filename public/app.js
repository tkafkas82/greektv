// Greek TV Dial - grid, search, guide overlay and player.

// Root-absolute so a /c/<slug> deep link doesn't resolve this to /c/channels.js.
import { CHANNELS, CATEGORIES } from "/channels.js";

const PLAYABLE = CHANNELS.filter((c) => c.stream).length;
const EPG_REFRESH_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

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
  onlyPlayable: false,
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
    if (state.onlyPlayable && !ch.stream) return false;
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
        `<span class="${ch.stream ? "live" : "web"}">${ch.stream ? "LIVE" : "WEB"}</span>` +
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
    CATEGORIES.forEach((cat, index) => {
      const group = list.filter((ch) => ch.cat === index && !favs.has(ch.id));
      if (group.length) frag.appendChild(section(cat.label, cat.hue, group));
    });
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
    ...CATEGORIES.map((cat, index) => ({
      label: cat.label,
      hue: cat.hue,
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
const switchList = document.getElementById("p-switch-list");
const switchCount = document.getElementById("p-switch-count");

let hls = null;
let playing = null;
let usedRelay = false;
let lastFocus = null;
/** The channels the prev/next buttons and the switcher walk through. */
let reel = [];

const relayUrl = (url) => `/api/stream?u=${encodeURIComponent(url)}`;

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
}

function attach(url) {
  teardown();

  // hls.js first, always. Chrome reports "maybe" for canPlayType of an HLS
  // manifest but cannot actually play one without MSE, so trusting that check
  // ahead of hls.js leaves the element erroring out on a stream that would
  // otherwise have worked.
  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: false, enableWorker: true, backBufferLength: 30 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      hideNote();
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

/** A direct hit usually dies on CORS or mixed content; the relay fixes both. */
function retryOrFail(reason) {
  if (!usedRelay && playing) {
    usedRelay = true;
    showNote("Δοκιμή μέσω διακομιστή…", "Η απευθείας σύνδεση απέτυχε.", { spin: true });
    attach(relayUrl(playing.stream));
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

  hideNote();
  video.hidden = true;
  frame.hidden = false;
  embedNote.hidden = false;

  embedNote.textContent = "";
  embedNote.append(
    `Η ανοιχτή ροή δεν αποκρίθηκε (${reason}), γι' αυτό φορτώθηκε η σελίδα του καναλιού. Πατήστε `
  );
  const strong = document.createElement("b");
  strong.textContent = "Δείτε Τώρα";
  embedNote.append(strong, " εκεί για να ξεκινήσει.");

  frame.src = ch.watchUrl;
}

function paintPlayerGuide(ch) {
  const entry = guide.get(ch.id);
  const nowEl = document.getElementById("p-now");
  const nextEl = document.getElementById("p-next");

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
function buildSwitcher() {
  reel = visible();
  switchCount.textContent = `Κανάλια · ${reel.length}`;

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
      `<span class="tag${ch.stream ? " on" : ""}"></span>`;
    btn.querySelector(".mini").textContent = ch.initials;
    btn.querySelector(".t").textContent = ch.name;
    btn.querySelector(".g").textContent =
      entry && entry.now ? entry.now.title : CATEGORIES[ch.cat].label;
    btn.querySelector(".tag").textContent = ch.stream ? "LIVE" : "WEB";
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

/**
 * Swap the player over to `ch` without closing it.
 * @param {object} ch
 * @param {{push?: boolean}} opts push=false when replaying a history entry,
 *        so stepping back through channels doesn't append new ones.
 */
function loadChannel(ch, { push = true } = {}) {
  teardown();
  playing = ch;
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

  embedNote.innerHTML = DEFAULT_EMBED_NOTE;

  if (ch.stream) {
    showNote("Σύνδεση…", "Φόρτωση ροής.", { spin: true });
    // http streams can never load on an https page - go straight to the relay.
    const mustRelay = ch.stream.startsWith("http://") && location.protocol === "https:";
    if (mustRelay) usedRelay = true;
    attach(mustRelay ? relayUrl(ch.stream) : ch.stream);
    return;
  }

  // No open stream: show the channel's own greektv.live page in place, which
  // keeps the grid one click away instead of navigating the tab away.
  hideNote();
  video.hidden = true;
  frame.hidden = false;
  embedNote.hidden = false;
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
  buildSwitcher();
  loadChannel(ch, { push });
  document.getElementById("p-close").focus();
}

function closePlayer({ push = true } = {}) {
  teardown();
  player.removeAttribute("open");
  document.body.style.overflow = "";
  playing = null;
  hideNote();
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
video.addEventListener("playing", hideNote);

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
const note1 =
  `Όλα τα κανάλια ανοίγουν στη σελίδα. ${PLAYABLE} παίζουν απευθείας· ` +
  `τα υπόλοιπα φορτώνουν τη σελίδα τους από το ` +
  `<a href="https://www.greektv.live/tv" target="_blank" rel="noopener">greektv.live</a> ενσωματωμένη.`;
document.getElementById("rail-note").innerHTML = note1;
document.getElementById("rail-note-mobile").innerHTML = note1;
document.getElementById("tagline").textContent =
  `${CHANNELS.length} κανάλια · ${PLAYABLE} με απευθείας ροή`;

buildRail();
render();
loadGuide();

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
