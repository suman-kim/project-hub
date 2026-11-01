#!/bin/bash
# Hub 서버와 DB 백업을 launchd LaunchAgent로 등록한다. 로그인하면 자동으로 뜬다.
# 다시 실행하면 빌드한 뒤 새 설정으로 재시작한다. 해제는 uninstall-launchd.sh.
#
#   com.claude-hub.server  Hub 서버. 죽으면 launchd가 다시 띄운다.
#   com.claude-hub.backup  한 시간마다 backup.sh. 하루 한 번만 실제로 백업한다.
#   로그: ~/Library/Logs/hub/server.log, backup.log
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
agents="$HOME/Library/LaunchAgents"
logs="$HOME/Library/Logs/hub"
domain="gui/$(id -u)"
port="${HUB_PORT:-2424}"

# launchd는 로그인 셸의 PATH를 모른다. 지금 셸에서 찾은 도구들의 폴더로 PATH를 만든다.
path=""
for bin in node claude gh git docker; do
  found="$(command -v "$bin")" || { echo "$bin 을 찾을 수 없습니다. 설치하거나 PATH를 확인하세요." >&2; exit 1; }
  d="$(dirname "$found")"
  case ":$path:" in *":$d:"*) ;; *) path="${path:+$path:}$d" ;; esac
done
path="$path:/usr/bin:/bin:/usr/sbin:/sbin"

echo "빌드"
# corepack enable을 하지 않았으면 pnpm 대신 corepack pnpm으로 부른다.
if command -v pnpm >/dev/null; then pnpm=(pnpm); else pnpm=(corepack pnpm); fi
(cd "$repo" && "${pnpm[@]}" -r build >/dev/null)

mkdir -p "$agents" "$logs"

# plist <label> <script> <추가 키...>
plist() {
  local label="$1" script="$2" extra="$3"
  cat > "$agents/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$repo/ops/$script</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$path</string>
    <key>LANG</key>
    <string>${LANG:-en_US.UTF-8}</string>
    <key>NO_COLOR</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
$extra
</dict>
</plist>
PLIST
  plutil -lint "$agents/$label.plist" >/dev/null
}

# 서버는 claude 실행, 빌드, 테스트를 대신 돌리므로 앱과 같은 자원 제한(Interactive)으로 띄운다.
plist com.claude-hub.server hub-server.sh "  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$logs/server.log</string>
  <key>StandardErrorPath</key>
  <string>$logs/server.log</string>"

plist com.claude-hub.backup backup.sh "  <key>StartInterval</key>
  <integer>3600</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$logs/backup.log</string>
  <key>StandardErrorPath</key>
  <string>$logs/backup.log</string>"

for label in com.claude-hub.server com.claude-hub.backup; do
  if launchctl print "$domain/$label" >/dev/null 2>&1; then
    launchctl bootout "$domain/$label" || true
    # 이전 프로세스가 완전히 내려가기 전에 bootstrap하면 실패한다.
    for _ in $(seq 1 20); do
      launchctl print "$domain/$label" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi
done

if pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)" && [[ -n "$pid" ]]; then
  echo "포트 $port을 다른 프로세스(pid $pid)가 쓰고 있습니다. 개발용 서버라면 먼저 끄세요." >&2
  exit 1
fi

for label in com.claude-hub.server com.claude-hub.backup; do
  launchctl bootstrap "$domain" "$agents/$label.plist"
done

printf 'Hub 기동 확인'
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    echo " → http://127.0.0.1:$port 정상"
    exit 0
  fi
  printf '.'
  sleep 1
done
echo
echo "60초 안에 뜨지 않았습니다. $logs/server.log를 확인하세요." >&2
exit 1
