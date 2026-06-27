// Service worker: network-first with a cached app-shell fallback, so the console
// keeps working when the network drops on snan days.
const CACHE = "khoya-paya-v1";
const SHELL = ["/", "/index.html", "/dashboard", "/css/app.css", "/js/api.js", "/js/map.js", "/js/app.js", "/js/dashboard.js", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return; // never cache POSTs
  if (new URL(request.url).pathname.startsWith("/api/")) return; // API always live
  e.respondWith(
    fetch(request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); return res; })
      .catch(() => caches.match(request).then((r) => r || caches.match("/index.html")))
  );
});
