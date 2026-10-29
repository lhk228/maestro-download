// 마에스트로 연결 앱 — QR 로 그날의 터널(https://….trycloudflare.com)에 들어가고, 마지막 주소를 기억한다.
// PC 의 QR 은 1회용 로그인 링크(…/api/login/handoff?t=…&next=/m)라, 찍으면 로그인된 채 폰 화면(/m)으로 간다.
// 터널 화면은 이 앱 안 iframe 으로 연다(주소창 없이 앱처럼). 로그인 쿠키는 이 앱 안에서만 쓰이는 Partitioned 쿠키다.
// 폰 푸시 알림 구독도 이 앱에 건다 — 결정 대기 알림을 누르면 이 앱이 열리고 그 화면으로 간다.
// 늘 앱 안(iframe)으로 연다. 준비됨이 안 오면 까닭(PC 꺼짐·QR 만료·앱 안 로그인 막힘)을 보이고 다시 찍게 한다 — 브라우저 창으로 넘기지 않는다
// (예전엔 한 번 실패하면 'maestro.top' 을 남겨 그 뒤로 늘 주소창 있는 창으로 열었다 — 2026-10-25 걷어 냄)
"use strict";

const KEY = "maestro.origin";
/** 옛 버전이 남긴 '브라우저 창으로 열기' 표시 — 읽지 않고 지운다 */
const OLD_TOP = "maestro.top";
/** iframe 안 화면이 '준비됨'(maestro-ready)을 알려 올 때까지 기다리는 시간 — 터널 첫 화면은 느릴 수 있다 */
const READY_MS = 25000;
/** 열어 둔 동안 터널이 살아 있는지 보는 간격 — 끊기면(PC 가 터널을 다시 켜 주소가 바뀌면) 연결 화면으로 */
const WATCH_MS = 30000;
const $ = (id) => document.getElementById(id);
const msg = (text, bad = false) => {
  $("msg").textContent = text;
  $("msg").classList.toggle("bad", bad);
};

/** 마에스트로가 여는 터널 주소만 따라간다 — 다른 사이트로 보내는 QR 은 거른다 */
function tunnelUrl(text) {
  try {
    const u = new URL(text.trim());
    if (u.protocol !== "https:" || !/^[a-z0-9-]+\.trycloudflare\.com$/i.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function go(u) {
  localStorage.setItem(KEY, u.origin);
  msg("연결하는 중…");
  openView(u);
}

// ───────── 앱 안 화면(iframe) ─────────

let viewOrigin = null;
let readyTimer = 0;
let watchTimer = 0;

function openView(u) {
  viewOrigin = u.origin;
  $("view").src = u.href;
  clearTimeout(readyTimer);
  readyTimer = setTimeout(async () => {
    // 준비됨을 못 받았다 — PC 가 꺼졌거나 화면이 아주 느리다
    const origin = viewOrigin;
    closeView();
    const up = origin && (await alive(origin));
    msg(up ? "화면이 열리지 않았어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요." : "PC에 연결할 수 없어요. PC에서 마에스트로와 '휴대폰으로 열기'가 켜져 있는지 확인해 주세요.", true);
  }, READY_MS);
}

/** 앱 안 화면이 로그인 화면에 멈췄다 — QR 이 만료됐거나, 이 브라우저가 앱 안 로그인(쿠키)을 남기지 않는다 */
function loginStuck(error) {
  closeView();
  msg(
    error
      ? "QR 코드가 만료됐거나 이미 사용했어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요."
      : "이 앱에서 로그인이 유지되지 않았어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요. 계속 안 되면 Chrome으로 앱을 설치해 주세요.",
    true,
  );
}

function showView() {
  clearTimeout(readyTimer);
  $("view").classList.add("on");
  document.body.classList.add("framed");
  msg("");
  clearInterval(watchTimer);
  watchTimer = setInterval(checkView, WATCH_MS);
}

function closeView() {
  clearTimeout(readyTimer);
  clearInterval(watchTimer);
  viewOrigin = null;
  $("view").classList.remove("on");
  document.body.classList.remove("framed");
  setTimeout(() => {
    if (!viewOrigin) $("view").removeAttribute("src");
  }, 350);
}

async function checkView() {
  const origin = viewOrigin;
  if (!origin || document.visibilityState !== "visible") return;
  if (await alive(origin)) return;
  if (origin !== viewOrigin) return;
  closeView();
  msg("PC와 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
}

// 터널 화면(/m)이 보내는 말 — 그려졌다(ready)·알림 상태·켜기·끄기. 다른 곳에서 온 메시지는 무시
window.addEventListener("message", (e) => {
  if (!viewOrigin || e.origin !== viewOrigin) return;
  const t = e.data?.type;
  if (t === "maestro-ready") showView();
  else if (t === "maestro-login") loginStuck(e.data.error);
  else if (t === "maestro-push-state") void pushState().then(reply);
  else if (t === "maestro-push-enable" && typeof e.data.key === "string") askPush(e.data.key);
  else if (t === "maestro-push-disable") void disablePush();
});

/** 알림을 누르면(서비스 워커가 알려 온다) 그 화면으로 */
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "maestro-open") openPath(e.data.path);
});

function openPath(path) {
  const p = typeof path === "string" && path.startsWith("/") ? path : "/m";
  const origin = viewOrigin || localStorage.getItem(KEY);
  if (!origin) return msg("아직 PC와 연결한 적이 없어요. QR 코드를 스캔해 연결해 주세요.");
  go(new URL(p, origin));
}

// ───────── 폰 알림(푸시) ─────────
// 구독은 이 앱(주소가 바뀌지 않는 GitHub Pages)에 건다 — PC 가 알림 서버로 바로 보내니 터널이 꺼져 있어도 온다.
// 터널 화면이 PC 의 공개키를 주면, 여기서 권한을 묻고 구독을 만들어 돌려준다(PC 에 저장은 터널 화면이 한다)

function reply(data) {
  if (viewOrigin) $("view").contentWindow?.postMessage(data, viewOrigin);
}

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || isIos()) return "iPad";
  const m = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|\))/);
  return m ? m[1].trim() : /Android/.test(ua) ? "Android" : "휴대폰";
}

async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function pushState() {
  const sub = await currentSub().catch(() => null);
  return {
    type: "maestro-push-state",
    supported: pushSupported(),
    permission: "Notification" in window ? Notification.permission : "denied",
    standalone: standalone(),
    ios: isIos(),
    endpoint: sub?.endpoint ?? null,
  };
}

const keyBytes = (b64u) => {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

let pushKey = null;

function askPush(key) {
  pushKey = key;
  if (!pushSupported()) {
    reply({ type: "maestro-push-error", message: isIos() && !standalone() ? "아이폰에서는 이 앱을 홈 화면에 추가한 뒤 열어야 알림을 받을 수 있어요." : "이 브라우저에서는 알림을 받을 수 없어요." });
    return;
  }
  if (Notification.permission === "denied") {
    reply({ type: "maestro-push-error", message: "알림이 꺼져 있어요. 폰 설정 → 앱(브라우저) → 알림에서 허용해 주세요." });
    return;
  }
  const sheet = $("push");
  sheet.classList.add("on");
  sheet.setAttribute("aria-hidden", "false");
}

function closePush() {
  $("push").classList.remove("on");
  $("push").setAttribute("aria-hidden", "true");
}

async function enablePush() {
  const key = pushKey;
  closePush();
  if (!key) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return reply({ type: "maestro-push-error", message: "알림을 허용하지 않아서 켜지 않았어요." });
    const reg = await navigator.serviceWorker.ready;
    const want = keyBytes(key);
    let sub = await reg.pushManager.getSubscription();
    // 다른 PC 키로 걸린 구독이면 풀고 다시
    if (sub && !sameKey(sub.options?.applicationServerKey, want)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    reply({ type: "maestro-push-subscription", subscription: sub.toJSON(), label: deviceLabel() });
  } catch (err) {
    reply({ type: "maestro-push-error", message: `알림을 켜지 못했어요 — ${err?.message || err}` });
  }
}

async function disablePush() {
  try {
    const sub = await currentSub();
    const endpoint = sub?.endpoint ?? null;
    await sub?.unsubscribe();
    reply({ type: "maestro-push-subscription", subscription: null, endpoint });
  } catch (err) {
    reply({ type: "maestro-push-error", message: `알림을 끄지 못했어요 — ${err?.message || err}` });
  }
}
// 다시 앱으로 돌아오면 바로 한 번 확인
document.addEventListener("visibilitychange", () => void checkView());

/** 터널이 아직 살아 있는지 — 로그인 없이 열리는 아이콘을 불러 본다 (끝난 터널은 오류 화면을 돌려줘 그림이 안 된다) */
function alive(origin) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 6000);
    img.onload = () => (clearTimeout(timer), resolve(true));
    img.onerror = () => (clearTimeout(timer), resolve(false));
    img.src = `${origin}/icons/icon-192.png?probe=${Date.now()}`;
  });
}

// ───────── 카메라로 QR 읽기 ─────────

let stream = null;
let scanning = false;

async function startScan() {
  msg("");
  if (!navigator.mediaDevices?.getUserMedia) return msg("이 브라우저에서는 카메라를 쓸 수 없어요. 폰 카메라 앱으로 QR 코드를 찍어도 열려요.", true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return msg("카메라를 쓸 수 없어요. 설정에서 카메라 권한을 허용하거나 폰 카메라 앱으로 QR 코드를 찍어 주세요.", true);
  }
  const video = $("video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  $("scanner").classList.add("on");
  $("scanner").setAttribute("aria-hidden", "false");
  scanning = true;
  requestAnimationFrame(tick);
}

function stopScan() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("scanner").classList.remove("on");
  $("scanner").setAttribute("aria-hidden", "true");
}

let lastWrong = 0;
function tick() {
  if (!scanning) return;
  const video = $("video");
  if (video.readyState >= 2 && video.videoWidth) {
    // 계산량을 줄이려고 짧은 변 640px 안으로 줄여 읽는다
    const scale = Math.min(1, 640 / Math.min(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = $("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (code?.data) {
      const u = tunnelUrl(code.data);
      if (u) {
        stopScan();
        return go(u);
      }
      if (Date.now() - lastWrong > 2500) {
        lastWrong = Date.now();
        msg("마에스트로 QR 코드가 아니에요. PC의 설정 → '휴대폰으로 열기'에 뜬 QR 코드를 스캔해 주세요.", true);
      }
    }
  }
  requestAnimationFrame(tick);
}

// ───────── 홈 화면에 설치 ─────────
// 스토어 앱이 아니라 PWA — 안드로이드 Chrome 은 설치 창(beforeinstallprompt)을 띄우고, 아이폰은 Safari 공유 → 홈 화면에 추가

let installEvent = null;

function showInstall() {
  if (standalone()) return;
  const box = $("install-box");
  const btn = $("install");
  const hint = $("install-hint");
  box.hidden = false;
  if (isIos()) {
    btn.hidden = true;
    hint.innerHTML = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
      ? "아이폰은 <b>Safari</b>로 이 페이지를 열고 공유 ⬆︎ → <b>홈 화면에 추가</b>를 눌러 주세요."
      : "아래 공유 버튼 ⬆︎ → <b>홈 화면에 추가</b>를 누르면 앱처럼 설치돼요. 알림은 설치한 아이콘으로 열어야 받을 수 있어요.";
  } else if (installEvent) {
    btn.hidden = false;
    hint.textContent = "설치하면 홈 화면 아이콘으로 바로 열 수 있어요.";
  } else {
    btn.hidden = true;
    hint.innerHTML = "Chrome 메뉴 ⋮ → <b>앱 설치</b>(또는 홈 화면에 추가)를 눌러 주세요.";
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  showInstall();
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  $("install-box").hidden = true;
  msg("설치했어요. 홈 화면의 마에스트로 아이콘으로 열어 주세요.");
});

// ───────── 시작 ─────────

async function boot() {
  localStorage.removeItem(OLD_TOP);
  $("scan").addEventListener("click", startScan);
  $("cancel").addEventListener("click", stopScan);
  $("install").addEventListener("click", async () => {
    if (!installEvent) return showInstall();
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    showInstall();
  });
  // 설치 안 한 브라우저에서 열었으면 설치 안내 — 안드로이드는 설치 창 이벤트가 조금 늦게 오면 그때 버튼으로 바뀐다
  showInstall();
  $("push-ok").addEventListener("click", () => void enablePush());
  $("push-no").addEventListener("click", () => {
    closePush();
    reply({ type: "maestro-push-error", message: "", cancelled: true });
  });

  // 알림을 눌러 앱이 새로 열렸다(#open=/m/…) — 지난 연결의 그 화면으로
  const open = new URLSearchParams(location.hash.slice(1)).get("open");
  if (open) {
    history.replaceState(null, "", location.pathname);
    const saved = localStorage.getItem(KEY);
    if (saved && open.startsWith("/")) {
      msg("여는 중…");
      if (await alive(saved)) return go(new URL(open, saved));
      msg("PC와 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
      return;
    }
  }

  // 링크로 넘겨받은 주소(#go=…) — 폰 카메라 앱으로 이 앱 주소를 열었을 때
  // 카톡 메시지 버튼은 해시를 떨굴 수 있어 쿼리(?go=…)로도 받는다
  const hash = new URLSearchParams(location.hash.slice(1)).get("go") || new URLSearchParams(location.search).get("go");
  const handed = hash && tunnelUrl(hash);
  if (handed) {
    history.replaceState(null, "", location.pathname);
    return go(handed);
  }

  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  msg("최근 연결을 확인하고 있어요…");
  if (await alive(saved)) {
    // PC 터널이 그대로면 잠깐 뒤 저절로 이어서 연다 — 그 사이 'QR 코드 스캔'을 누르면 멈춘다
    const resume = $("resume");
    resume.hidden = false;
    const target = new URL(`${saved}/m`);
    resume.onclick = () => go(target);
    msg("PC가 켜져 있어요. 이어서 여는 중…");
    const timer = setTimeout(() => !scanning && go(target), 900);
    $("scan").addEventListener("click", () => clearTimeout(timer), { once: true });
  } else {
    msg("최근 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
  }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
