// Service worker for Greek TV Dial.
//
// Deliberately narrow. It caches the app shell so the grid opens instantly and
// survives a flaky connection, and stays out of the way of everything live:
//
//   - /api/* is never cached. The guide is time-sensitive and /api/resolve
//     exists precisely to avoid a stale URL, so serving either from a cache
//     would undo the point of both.
//   - Cross-origin requests are passed straight through. Streams, segments and
//     fonts are someone else's bytes; caching megabytes of live video per
//     viewer would be worse than useless.
//   - Only GET is touched.
//
// Bump VERSION to invalidate the shell. Old caches are dropped on activate.

const VERSION = "v1";
const SHELL = `greektv-shell-${VERSION}`;

const ASSETS = [
  "/",
  "/app.js",
  "/channels.js",
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
  // document. Try the network so a deploy is picked up, and fall back to the
  // cached shell when offline - falling back to "/" rather than the requested
  // path, because that path was never cached under its own URL.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
