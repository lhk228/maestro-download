#!/bin/zsh
# 마에스트로 맥 설치 — 터미널에 한 줄:  curl -fsSL https://lhk228.github.io/maestro-download/install.sh | zsh
# 브라우저로 받은 앱은 macOS 가 '인터넷에서 받은 파일'로 표시해 서명 검사(Gatekeeper)로 막는다. curl 로 받으면 그 표시가 없어
# '그래도 열기' 없이 바로 열린다. 받은 dmg 에서 앱을 응용 프로그램 폴더로 옮기고 연다 — 그 뒤는 앱의 첫 설치 창이 이어 간다.
set -euo pipefail
URL="https://github.com/lhk228/maestro-download/releases/latest/download/Maestro-mac-arm64.dmg"

[[ "$(uname -m)" == "arm64" ]] || { print "지금은 Apple Silicon(M1 이상) 맥만 지원합니다."; exit 1; }

TMP="$(mktemp -d)"
MNT="$TMP/mnt"
cleanup() { hdiutil detach -quiet "$MNT" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

print "마에스트로 내려받는 중…"
curl -fL --progress-bar -o "$TMP/Maestro.dmg" "$URL"

mkdir -p "$MNT"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$TMP/Maestro.dmg"

# 응용 프로그램 폴더에 쓸 수 없으면(관리자가 아닌 계정) 내 응용 프로그램 폴더(~/Applications)에 둔다
DEST="/Applications"
[[ -w "$DEST" ]] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
if [[ -d "$DEST/Maestro.app" ]]; then
  print "있던 Maestro.app 을 새 버전으로 바꿉니다 (내 프로젝트·대화 기록은 그대로)"
  rm -rf "$DEST/Maestro.app"
fi
ditto "$MNT/Maestro.app" "$DEST/Maestro.app"
xattr -dr com.apple.quarantine "$DEST/Maestro.app" 2>/dev/null || true

print "설치했습니다: $DEST/Maestro.app — 앱을 엽니다"
open "$DEST/Maestro.app"
