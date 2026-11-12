// Miracle GYM service worker: 네트워크 우선, 실패 시 캐시 (오프라인에서도 앱이 열리도록)
const CACHE = 'mg-v23';
const SHELL = ['./', './index.html', './app.js', './data.js', './menus.js', './config.js', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // 데이터 요청은 캐시하지 않음
  const isImg = url.pathname.includes('/img/');
  if (isImg) { e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; }))); return; }
  e.respondWith(fetch(url.origin === location.origin ? new Request(req, { cache: 'no-cache' }) : req).then(res => { if (res.ok && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; }).catch(() => caches.match(req)));
});
