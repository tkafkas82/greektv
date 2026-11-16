#!/usr/bin/env node
// Greek TV & Radio launcher - what the "Greek TV" shortcut runs.
//
//   node greektv-launcher.mjs            start the server if needed, open the browser
//   node greektv-launcher.mjs stop       stop the background server
//   node greektv-launcher.mjs update     stop, re-download the app, start again
//   node greektv-launcher.mjs status     say whether it is running
//   add --no-browser to start without opening a browser
//
// It lives in the install folder (%LOCALAPPDATA%\GreekTV on Windows) next to
// app\ and settings.json, and needs nothing but Node 18+: the app is fetched
// from GitHub on first run and refreshed whenever main has a newer commit.
// install-windows.ps1 puts it there; it replaces itself with the copy shipped
// in each app download, so it stays current too.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = "tkafkas82/greektv";
const BRANCH = "main";
const IS_WIN = process.platform === "win32";
const IS_TERMUX = Boolean(process.env.TERMUX_VERSION) || (process.env.PREFIX || "").includes("com.termux");

const HOME = process.env.GREEKTV_HOME || fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = join(HOME, "app");
const SETTINGS = join(HOME, "settings.json");
const PID_FILE = join(HOME, "server.pid");
const LOG_FILE = join(HOME, "server.log");
const SELF = fileURLToPath(import.meta.url);

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-")) || "start";
const noBrowser = args.includes("--no-browser");

const say = (msg) => console.log(`  ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ settings
function loadSettings() {
  let s = {};
  try { s = JSON.parse(readFileSync(SETTINGS, "utf8").replace(/^\uFEFF/, "")); } catch {}
  if (!s.secret) s.secret = randomBytes(32).toString("base64url");
  if (!s.port) s.port = 3000;
  return s;
}
const saveSettings = (s) => writeFileSync(SETTINGS, JSON.stringify(s, null, 2));

// ------------------------------------------------------------------ server state
// /api/lan exists only on this app's own server, so a JSON answer with an
// "origin" key means "ours" and not some other program on the port.
async function lanInfo(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/lan`, { signal: AbortSignal.timeout(2000) });
    const j = await res.json();
    return j && "origin" in j ? j : null;
  } catch { return null; }
}
const isOurs = async (port) => Boolean(await lanInfo(port));

function isFree(port) {
  return new Promise((resolve) => {
    const srv = createServer().once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

async function stopServer(port) {
  if (!(await isOurs(port))) return false;
  try { process.kill(Number(readFileSync(PID_FILE, "utf8")), "SIGTERM"); } catch {}
  for (let i = 0; i < 20 && (await isOurs(port)); i++) await sleep(250);
  if (await isOurs(port)) throw new Error(`Something else is serving Greek TV on port ${port} (started by hand?) - stop it there.`);
  rmSync(PID_FILE, { force: true });
  return true;
}

// ------------------------------------------------------------------ app download
async function remoteSha() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: { accept: "application/vnd.github.sha", "user-agent": "greektv-launcher" },
      signal: AbortSignal.timeout(8000),
    });
    const sha = (await res.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

async function installApp() {
  say(`Downloading the app from github.com/${REPO}...`);
  const ext = IS_WIN ? "zip" : "tar.gz";
  const res = await fetch(`https://codeload.github.com/${REPO}/${ext}/refs/heads/${BRANCH}`);
  if (!res.ok) throw new Error(`GitHub download failed: HTTP ${res.status}`);

  // Unpack next to the install so the final rename never crosses drives.
  const tmp = join(HOME, `tmp-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const archive = join(tmp, `app.${ext}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    // bsdtar ships with Windows 10 1803+ and reads zip; elsewhere tar is a given.
    const tar = IS_WIN ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
    const r = spawnSync(tar, IS_WIN ? ["-xf", archive, "-C", tmp] : ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("Could not unpack the download");
    const top = readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory() && existsSync(join(tmp, d.name, "server.mjs")));
    if (!top) throw new Error("The download has no server.mjs");
    rmSync(APP_DIR, { recursive: true, force: true });
    renameSync(join(tmp, top.name), APP_DIR);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Take the launcher shipped with this version for next time.
  const fresh = join(APP_DIR, "install", "greektv-launcher.mjs");
  if (existsSync(fresh) && fresh !== SELF) { try { copyFileSync(fresh, SELF); } catch {} }
}

// ------------------------------------------------------------------ browser
function openBrowser(url) {
  if (noBrowser) return;
  const [bin, argv] = IS_WIN ? ["explorer.exe", [url]]
    : process.platform === "darwin" ? ["open", [url]]
    : IS_TERMUX ? ["termux-open-url", [url]]
    : ["xdg-open", [url]];
  try { spawn(bin, argv, { detached: true, stdio: "ignore" }).on("error", () => say(`Open ${url} in a browser.`)).unref(); }
  catch { say(`Open ${url} in a browser.`); }
}

// ------------------------------------------------------------------ main
async function main() {
  mkdirSync(HOME, { recursive: true });
  const s = loadSettings();

  if (cmd === "stop") {
    say((await stopServer(s.port)) ? `Stopped the server on port ${s.port}.` : "The server was not running.");
    if (IS_TERMUX) { try { spawn("termux-wake-unlock", [], { stdio: "ignore" }).on("error", () => {}); } catch {} }
    return;
  }
  if (cmd === "status") {
    say((await isOurs(s.port)) ? `Running on http://localhost:${s.port}` : "Not running.");
    return;
  }
  if (cmd !== "start" && cmd !== "update") {
    console.log("usage: greektv-launcher.mjs [start|stop|update|status] [--no-browser]");
    process.exitCode = 2;
    return;
  }

  console.log("\n  Greek TV & Radio\n");
  if (cmd === "update") await stopServer(s.port);

  // 1. Already running? Then there is nothing to do but open it.
  if (cmd === "start" && (await isOurs(s.port))) {
    say(`Already running on http://localhost:${s.port}`);
    openBrowser(`http://localhost:${s.port}`);
    return;
  }

  // 2. App: download on first run, refresh when GitHub has a newer commit.
  const haveApp = existsSync(join(APP_DIR, "server.mjs"));
  const remote = await remoteSha();
  if (!haveApp || cmd === "update" || (remote && remote !== s.sha)) {
    try {
      await installApp();
      if (remote) s.sha = remote;
    } catch (err) {
      if (!haveApp) throw err;
      say(`Update skipped (${err.message}) - starting the copy already installed.`);
    }
  }

  // 3. Port: the saved one, else the first free one from 3000.
  if (!(await isFree(s.port))) {
    let found = null;
    for (let p = 3000; p <= 3020 && !found; p++) if ((await isOurs(p)) || (await isFree(p))) found = p;
    if (!found) throw new Error("No free port between 3000 and 3020");
    s.port = found;
  }
  saveSettings(s);

  // 4. Start the server as its own process, so it outlives this window.
  if (!(await isOurs(s.port))) {
    say(`Starting the server on port ${s.port}...`);
    // On Android the TV pulls a cast through the phone, so Termux must not
    // doze with the screen off. termux-wake-lock keeps it awake (it shows as
    // a notification; "greektv stop" or Termux's own button releases it).
    if (IS_TERMUX) { try { spawn("termux-wake-lock", [], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch {} }
    const log = openSync(LOG_FILE, "w");
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: APP_DIR,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, PORT: String(s.port), STREAM_PROXY_SECRET: s.secret },
    });
    writeFileSync(PID_FILE, String(child.pid));
    child.unref();
    let up = false;
    for (let i = 0; i < 60 && !(up = await isOurs(s.port)); i++) await sleep(500);
    if (!up) {
      let tail = "";
      try { tail = readFileSync(LOG_FILE, "utf8").split("\n").slice(-15).join("\n"); } catch {}
      throw new Error(`The server did not come up on port ${s.port}.\n${tail}`);
    }
  }

  const info = await lanInfo(s.port);
  console.log("");
  say(`Running:  http://localhost:${s.port}`);
  if (info?.origin) say(`Phone / TV on the same Wi-Fi:  ${info.origin}`);
  console.log("");
  openBrowser(`http://localhost:${s.port}`);
}

main().catch(async (err) => {
  console.error(`\n  Greek TV could not start:\n\n  ${err.message}\n`);
  // Keep the window open so the message can be read.
  if (process.stdin.isTTY) {
    console.error("  Press Enter to close.");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  } else {
    process.exitCode = 1;
  }
});
