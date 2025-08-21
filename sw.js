self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('ssat-cache-v1').then(cache => cache.addAll([
      './', 'index.html', 'style.css', 'app.js', 'words.json', 'manifest.webmanifest'
    ]))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
