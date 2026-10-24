// 마에스트로 연결 앱 — QR 로 그날의 터널(https://….trycloudflare.com)에 들어가고, 마지막 주소를 기억한다.
// PC 의 QR 은 1회용 로그인 링크(…/api/login/handoff?t=…&next=/m)라, 찍으면 로그인된 채 폰 화면(/m)으로 간다.
"use strict";

const KEY = "maestro.origin";
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
  location.href = u.href;
}

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
  if (!navigator.mediaDevices?.getUserMedia) return msg("이 브라우저는 카메라를 쓸 수 없습니다. 폰 카메라 앱으로 QR 을 찍어도 열립니다.", true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return msg("카메라를 쓸 수 없습니다. 설정에서 카메라 권한을 허용하거나, 폰 카메라 앱으로 QR 을 찍으세요.", true);
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
        msg("마에스트로 QR 이 아닙니다. PC 설정 → 휴대폰으로 열기의 QR 을 찍으세요.", true);
      }
    }
  }
  requestAnimationFrame(tick);
}

// ───────── 시작 ─────────

async function boot() {
  $("scan").addEventListener("click", startScan);
  $("cancel").addEventListener("click", stopScan);

  // 링크로 넘겨받은 주소(#go=…) — 폰 카메라 앱으로 이 앱 주소를 열었을 때
  const hash = new URLSearchParams(location.hash.slice(1)).get("go");
  const handed = hash && tunnelUrl(hash);
  if (handed) {
    history.replaceState(null, "", location.pathname);
    return go(handed);
  }

  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  $("last").textContent = `지난 연결: ${saved.replace(/^https:\/\//, "")}`;
  msg("지난 연결을 확인하는 중…");
  if (await alive(saved)) {
    // PC 터널이 그대로면 잠깐 뒤 저절로 이어서 연다 — 그 사이 'QR 찍어서 연결'을 누르면 멈춘다
    const resume = $("resume");
    resume.hidden = false;
    const target = new URL(`${saved}/m`);
    resume.onclick = () => go(target);
    msg("PC 가 켜져 있습니다. 이어서 여는 중…");
    const timer = setTimeout(() => !scanning && go(target), 900);
    $("scan").addEventListener("click", () => clearTimeout(timer), { once: true });
  } else {
    msg("지난 연결이 끝났습니다 (PC 에서 터널을 다시 켜면 주소가 바뀝니다). QR 을 다시 찍으세요.");
  }
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
