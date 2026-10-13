// The service worker, for play offline and an install on a phone. The game is one HTML file. A
// request goes to the network first, so a new version shows at once, and the cache answers offline.
const CACHE = 'bauplan';

self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'manifest.webmanifest']))),
);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (res.ok) e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        // A page at another address of the game, such as index.html, is the same page.
        return hit ?? (req.mode === 'navigate' && (await caches.match('./'))) ?? Response.error();
      }),
  );
});
