const CACHE_NAME = "screen-to-inner-time-v30";
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const withBase = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  withBase("/"),
  withBase("/index.html"),
  withBase("/styles.css?v=20260625-session-form-1"),
  withBase("/app.js?v=20260625-session-form-1"),
  withBase("/manifest.webmanifest"),
  withBase("/assets/icon.svg"),
  withBase("/assets/vishvas-meditation-logo.png"),
  withBase("/admin/dashboard/"),
  withBase("/admin/admins/"),
  withBase("/admin/login/"),
  withBase("/admin/media/"),
  withBase("/session/15/"),
  withBase("/session/30/")
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
      fetch(request).catch(() => caches.match(withBase("/index.html")))
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
