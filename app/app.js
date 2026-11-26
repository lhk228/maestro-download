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
/** PC 중계 짝 정보 { topic, key } — 로그인한 터널 화면이 넘겨 준다(maestro-pair). 끊긴 뒤 PC 에 링크를 요청하는 데 쓴다 */
const PAIR = "maestro.pair";
const NTFY = "https://ntfy.sh";
/** PC 답을 기다리는 시간 — PC 가 연결 주소를 새로 여는 중이면 30~40초 걸린다 */
const RELINK_MS = 60000;
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

/**
 * 붙여넣은 글에서 마에스트로 주소를 찾는다 — 카톡 메시지 전체, 1회용 로그인 링크, 연결 앱 링크(?go=…) 모두 받는다
 */
function linkFrom(text) {
  for (const raw of String(text).match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    const direct = tunnelUrl(raw);
    if (direct) return direct;
    try {
      const inner = new URL(raw).searchParams.get("go");
      const u = inner && tunnelUrl(inner);
      if (u) return u;
    } catch {}
  }
  return null;
}

/** 카톡 안 브라우저 — 여기서 열면 홈 화면 앱이 아니라 카톡 창 안에서 열린다 */
const inKakao = () => /KAKAOTALK/i.test(navigator.userAgent);
const isAndroid = () => /Android/i.test(navigator.userAgent);

/**
 * 이 앱 주소(?go=…)를 안드로이드 인텐트로 연다 — 카톡 안 브라우저는 https 링크를 스스로 열어 버리므로 intent:// 로 넘겨야
 * 홈 화면에 설치한 앱(WebAPK, scope 안 주소를 받는다)이 열린다. 앱이 없으면 Chrome 이 연다
 */
function intentUrl(u) {
  const self = new URL(location.href);
  self.search = `?go=${encodeURIComponent(u.href)}`;
  self.hash = "";
  return `intent://${self.host}${self.pathname}${self.search}#Intent;scheme=https;end`;
}

async function pasteLink() {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {}
  // 클립보드를 못 읽으면(권한·브라우저) 직접 붙여넣게 한다
  if (!linkFrom(text)) text = window.prompt("카톡으로 받은 링크를 붙여넣어 주세요") ?? "";
  if (!text.trim()) return;
  const u = linkFrom(text);
  if (!u) return msg("마에스트로 링크가 아니에요. 카톡 '나와의 채팅'에 온 링크를 복사해 붙여넣어 주세요.", true);
  go(u);
}

/**
 * 카톡 버튼으로 넘어왔다 — 홈 화면 앱으로 옮겨 가게 링크를 복사해 준다(1회용 링크는 열 때 쓰이므로 복사만으로는 닳지 않는다).
 * 앱에서 '카톡 링크 붙여넣기'를 누르면 이어진다. 카톡 창에서 그냥 써도 되게 '여기서 바로 열기'도 둔다
 */
function offerHandoff(u) {
  $("handed").hidden = false;
  $("scan").hidden = true;
  if (isAndroid()) {
    // 1회용 링크는 앱에서 열 때 쓰이므로, 넘기기만 해서는 닳지 않는다. 넘어가지 않으면 버튼·복사로 다시
    const open = () => location.assign(intentUrl(u));
    $("open-app").hidden = false;
    $("open-app").onclick = open;
    $("copy-go").classList.add("ghost");
    $("hint").textContent = "설치한 마에스트로 앱으로 여는 중이에요. 앱이 열리지 않으면 '앱으로 열기'를 눌러 주세요.";
    $("open-here").onclick = () => go(u);
    $("copy-go").onclick = () => copyLink(u);
    open();
    return;
  }
  $("hint").textContent = "홈 화면에 설치한 마에스트로 앱에서 열려면 링크를 복사한 뒤, 앱의 '카톡 링크 붙여넣기'를 눌러 주세요.";
  $("open-here").onclick = () => go(u);
  $("copy-go").onclick = () => copyLink(u);
}

async function copyLink(u) {
  try {
    await navigator.clipboard.writeText(u.href);
    msg("복사했어요. 홈 화면의 마에스트로 앱을 열고 '카톡 링크 붙여넣기'를 눌러 주세요.");
  } catch {
    window.prompt("이 링크를 길게 눌러 복사해 주세요", u.href);
  }
}

function go(u) {
  showRelink(false);
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
    if (showRelink(true)) return msg(up ? "화면이 열리지 않았어요. 아래 버튼으로 다시 연결해 주세요." : "PC와 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요.", true);
    msg(up ? "화면이 열리지 않았어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요." : "PC에 연결할 수 없어요. PC에서 마에스트로와 '휴대폰으로 열기'가 켜져 있는지 확인해 주세요.", true);
  }, READY_MS);
}

/** 앱 안 화면이 로그인 화면에 멈췄다 — QR 이 만료됐거나, 이 브라우저가 앱 안 로그인(쿠키)을 남기지 않는다 */
function loginStuck(error) {
  closeView();
  if (showRelink(true)) return msg("로그인이 만료됐어요. 아래 버튼으로 다시 연결해 주세요.", true);
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
  msg(showRelink(true) ? "PC와 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요." : "PC와 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
}

// 터널 화면(/m)이 보내는 말 — 그려졌다(ready)·알림 상태·켜기·끄기. 다른 곳에서 온 메시지는 무시
window.addEventListener("message", (e) => {
  if (!viewOrigin || e.origin !== viewOrigin) return;
  const t = e.data?.type;
  if (t === "maestro-ready") showView();
  else if (t === "maestro-login") loginStuck(e.data.error);
  else if (t === "maestro-pair") savePair(e.data);
  else if (t === "maestro-push-state") void pushState().then(reply);
  else if (t === "maestro-push-enable" && typeof e.data.key === "string") askPush(e.data.key);
  else if (t === "maestro-push-disable") void disablePush();
  else if (t === "maestro-fullscreen") fullscreen();
});

/**
 * 상태 표시줄·아래 내비게이션 바까지 걷어 앱이 화면 전체를 쓰게 한다. manifest 가 fullscreen 이면 이미 전체라 그대로.
 * 'standalone' 으로 깔린 옛 설치·바로가기(브라우저 탭)는 누를 때만 청할 수 있어 손길마다 다시 청한다(뒤로 가기 제스처로 풀린다)
 */
function fullscreen() {
  if (document.fullscreenElement || matchMedia("(display-mode: fullscreen)").matches) return;
  document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
}
// 화면 대부분은 iframe 이라 여기 손길은 연결 화면에서만 온다 — iframe 안 손길은 /m 이 maestro-fullscreen 으로 알린다
window.addEventListener("pointerup", fullscreen);

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
// ───────── PC 에 다시 연결 요청 (중계) ─────────
// 터널 주소가 바뀌면 폰은 PC 에 닿을 수 없다. PC 가 구독하는 공개 중계(ntfy.sh)의 비밀 주제에 암호화한 요청을 올리고,
// PC 는 새 1회용 로그인 링크를 이 요청이 정한 답 주제로 돌려준다(카톡을 고르면 카톡으로). 봉투 꼴은 PC 의 src/lib/relay-crypto.ts 와 같다

function readPair() {
  try {
    const p = JSON.parse(localStorage.getItem(PAIR) || "null");
    return p && typeof p.topic === "string" && typeof p.key === "string" ? p : null;
  } catch {
    return null;
  }
}

function savePair(d) {
  if (typeof d?.topic !== "string" || !/^maestro-[A-Za-z0-9_-]{16,40}$/.test(d.topic)) return;
  if (typeof d.key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(d.key)) return;
  localStorage.setItem(PAIR, JSON.stringify({ topic: d.topic, key: d.key }));
}

/** 끊김 화면의 '다시 연결' 버튼 — 짝 정보가 있을 때만 보인다. 보였으면 true */
function showRelink(on) {
  const show = on && Boolean(readPair());
  $("relink-box").hidden = !show;
  // 주 버튼은 하나만 — 다시 연결이 보이면 QR 스캔은 보조로
  $("scan").classList.toggle("ghost", show);
  return show;
}

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aesKey = (k) => crypto.subtle.importKey("raw", keyBytes(k), "AES-GCM", false, ["encrypt", "decrypt"]);

async function seal(k, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(k), new TextEncoder().encode(JSON.stringify(data))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64u(out);
}

async function unseal(k, blob) {
  try {
    const raw = keyBytes(String(blob).trim());
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, await aesKey(k), raw.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

let relinking = false;

async function relink(kakao) {
  const pair = readPair();
  if (!pair || relinking) return;
  relinking = true;
  $("relink").disabled = $("relink-kakao").disabled = true;
  msg(kakao ? "PC에 카톡 링크를 요청하고 있어요…" : "PC에 연결을 요청하고 있어요…");
  const reply = b64u(crypto.getRandomValues(new Uint8Array(18)));
  const es = new EventSource(`${NTFY}/${reply}/sse`);
  try {
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), RELINK_MS);
      let sent = false;
      // 답 주제를 듣기 시작한 뒤에 요청을 올린다 — 답은 쌓아 두지 않으므로
      es.onopen = async () => {
        if (sent) return;
        sent = true;
        try {
          const r = await fetch(`${NTFY}/${pair.topic}`, { method: "POST", body: await seal(pair.key, { t: Date.now(), r: reply, kakao }) });
          if (!r.ok) throw new Error(String(r.status));
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
      es.onmessage = async (e) => {
        let d;
        try {
          d = JSON.parse(e.data);
        } catch {
          return;
        }
        if (d.event !== "message") return;
        const a = await unseal(pair.key, d.message);
        if (!a) return;
        clearTimeout(timer);
        resolve(a);
      };
    });
    if (answer.error) msg(answer.error, true);
    else if (answer.kakao) msg("카톡 '나와의 채팅'으로 링크를 보냈어요. 메시지의 '휴대폰으로 열기'를 눌러 주세요.");
    else {
      const u = tunnelUrl(String(answer.url || ""));
      if (u) go(u);
      else msg("PC가 보낸 링크를 열 수 없어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.", true);
    }
  } catch {
    msg("PC가 답하지 않아요. PC가 켜져 있고 마에스트로가 실행 중인지 확인해 주세요.", true);
  } finally {
    es.close();
    relinking = false;
    $("relink").disabled = $("relink-kakao").disabled = false;
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
  $("paste").addEventListener("click", () => void pasteLink());
  $("relink").addEventListener("click", () => void relink(false));
  $("relink-kakao").addEventListener("click", () => void relink(true));
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

  // 다른 앱의 '공유하기'로 넘겨받은 글(manifest share_target) — 그 속 주소를 지난 연결의 영상 수집함에 바로 넣는다
  const q = new URLSearchParams(location.search);
  const sharedLink = /https?:\/\/\S+/.exec([q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" "))?.[0];
  if (q.has("text") || q.has("url")) {
    history.replaceState(null, "", location.pathname);
    const saved = localStorage.getItem(KEY);
    if (!sharedLink) return msg("공유한 내용에 영상 주소가 없어요. 영상의 '링크 복사'로 다시 공유해 주세요.", true);
    if (saved) {
      msg("수집함에 넣는 중…");
      if (await alive(saved)) return go(new URL(`/m/inbox?add=${encodeURIComponent(sharedLink)}`, saved));
    }
    msg(showRelink(true) ? "PC와 연결이 끊겨 수집함에 넣지 못했어요. 다시 연결한 뒤 한 번 더 공유해 주세요." : "PC와 연결이 끊겨 수집함에 넣지 못했어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.", true);
    return;
  }

  // 알림을 눌러 앱이 새로 열렸다(#open=/m/…) — 지난 연결의 그 화면으로
  const open = new URLSearchParams(location.hash.slice(1)).get("open");
  if (open) {
    history.replaceState(null, "", location.pathname);
    const saved = localStorage.getItem(KEY);
    if (saved && open.startsWith("/")) {
      msg("여는 중…");
      if (await alive(saved)) return go(new URL(open, saved));
      msg(showRelink(true) ? "PC와 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요." : "PC와 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
      return;
    }
  }

  // 링크로 넘겨받은 주소(#go=…) — 폰 카메라 앱으로 이 앱 주소를 열었을 때
  // 카톡 메시지 버튼은 해시를 떨굴 수 있어 쿼리(?go=…)로도 받는다
  const hash = new URLSearchParams(location.hash.slice(1)).get("go") || new URLSearchParams(location.search).get("go");
  const handed = hash && tunnelUrl(hash);
  if (handed) {
    history.replaceState(null, "", location.pathname);
    // 카톡 안에서 열렸으면 바로 열지 않고 앱으로 옮길지 고르게 한다
    if (inKakao() && !standalone()) return offerHandoff(handed);
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
    msg(showRelink(true) ? "PC와 연결이 끊겼어요. 아래 버튼으로 다시 연결해 주세요." : "최근 연결이 끊겼어요. PC에서 새 QR 코드를 띄우고 다시 스캔해 주세요.");
  }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
