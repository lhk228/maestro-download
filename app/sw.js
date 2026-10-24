// 연결 앱 — 화면 파일만 저장해 두고(오프라인에서도 열리게), 나머지는 그대로 네트워크로.
// 터널(PC) 쪽 요청은 다른 주소라 여기서 다루지 않는다
const CACHE = "maestro-app-v2";
const SHELL = ["./", "./index.html", "./app.js", "./jsQR.js", "./manifest.webmanifest", "./icon-192.png", "./apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // 새 버전을 먼저 받고, 안 되면 저장해 둔 것
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
