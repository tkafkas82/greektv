// Service worker for Greek TV & Radio.
//
// Deliberately narrow. It caches the app shell so the grid opens instantly and
// survives a flaky connection, and stays out of the way of everything live:
//
//   - /api/* is never cached. The guide is time-sensitive and /api/resolve
//     exists precisely to avoid a stale URL, so serving either from a cache
//     would undo the point of both.
//   - The 234 channel logos are not precached. They are same-origin, so the
//     fetch handler below caches each one as it is actually requested, which
//     fills the cache with the logos a viewer has really seen instead of
//     spending a megabyte of their data on the first visit.
//   - Cross-origin requests are passed straight through. Streams, segments and
//     fonts are someone else's bytes; caching megabytes of live video per
//     viewer would be worse than useless.
//   - Only GET is touched.
//
// Everything same-origin is network-first with a cache fallback, NOT cache-first.
// Cache-first pinned /app.js and /styles.css to whatever was cached on the first
// visit while navigations kept fetching fresh HTML, so a deploy produced a page
// running new markup against old script - which looks like a UI bug and is not
// one. The cache here is for going offline, not for speed.
//
// Bump VERSION to invalidate the shell. Old caches are dropped on activate.

const VERSION = "v4";
const SHELL = `greektv-shell-${VERSION}`;

const ASSETS = [
  "/",
  "/app.js",
  "/channels.js",
  "/logos.js",
  "/resolvers.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One missing asset shouldn't fail the whole install, so each is added on
      // its own and a failure is tolerated.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations, including every /c/<slug> deep link, resolve to the same
  // document. Cache under "/" rather than the requested path, because a deep
  // link was never cached under its own URL.
  const isNav = req.mode === "navigate";
  const key = isNav ? "/" : req;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (isNav || res.type === "basic")) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error()))
  );
});
