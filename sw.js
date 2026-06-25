const CACHE_NAME = "screen-to-inner-time-v29";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20260625-session-form-1",
  "/app.js?v=20260625-session-form-1",
  "/manifest.webmanifest",
  "/assets/icon.svg",
  "/assets/vishvas-meditation-logo.png",
  "/admin/dashboard/",
  "/admin/admins/",
  "/admin/login/",
  "/admin/media/",
  "/session/15/",
  "/session/30/"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached)
    )
  );
});
