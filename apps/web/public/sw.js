/* MazingiraOps service worker: app-shell caching with an offline fallback screen.
 * API responses (/api/...) are never cached; navigations are network-first so a
 * stale shell is never served for a fresh session. */
const CACHE = "mazingira-shell-v2";
const SHELL = [
  "/",
  "/offline",
  "/login",
  "/register",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/branding/nairobi-city-county-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PURGE_SESSION_CACHE") return;
  event.waitUntil(
    caches.delete(CACHE).then(() => caches.open(CACHE).then((cache) => cache.addAll(SHELL))),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline")),
    );
    return;
  }

  const immutableAsset =
    url.pathname.startsWith("/_next/static/") ||
    SHELL.includes(url.pathname);
  if (!immutableAsset) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
