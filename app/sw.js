// 연결 앱 — 화면 파일만 저장해 두고(오프라인에서도 열리게), 나머지는 그대로 네트워크로.
// 터널(PC) 쪽 요청은 다른 주소라 여기서 다루지 않는다.
// 푸시 알림도 여기서 받는다 — PC 마에스트로(server/push.ts)가 결정 대기가 생기면 보낸다. 누르면 앱을 열고 그 화면(path)으로
const CACHE = "maestro-app-v4";
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

// ───────── 푸시 알림 ─────────

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "마에스트로", {
      body: d.body || "",
      tag: d.tag || undefined,
      icon: "icon-192.png",
      badge: "icon-192.png",
      lang: "ko",
      data: { path: typeof d.path === "string" && d.path.startsWith("/") ? d.path : "/m/decisions" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const path = e.notification.data?.path || "/m/decisions";
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = wins.find((w) => new URL(w.url).origin === location.origin);
      if (app) {
        app.postMessage({ type: "maestro-open", path });
        return app.focus();
      }
      return self.clients.openWindow(`./#open=${encodeURIComponent(path)}`);
    })(),
  );
});
