/* Ritual PWA — Service Worker (Wave 5) */

const CACHE_VERSION = 'ritual-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/apple-touch-icon.png',
];

// ── Install: pre-cache static shell ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: tiered caching strategy ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET requests entirely (POST/PATCH/DELETE go straight to network)
  if (request.method !== 'GET') return;

  // 2. Supabase API calls — network-first, no caching
  //    (never serve stale DB data; silently fail offline — the app handles it)
  if (url.hostname.includes('supabase.co')) return;

  // 3. Google Fonts — network-first with cache fallback (no offline font = OK)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 4. Everything else (app shell, JS bundles, CSS, icons) — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(response => {
          // Only cache valid responses
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Navigation requests (HTML pages) → serve offline fallback
          if (request.destination === 'document') {
            return caches.match('/offline.html');
          }
          // Other resources (images, scripts) → nothing, browser handles gracefully
        });
    })
  );
});
