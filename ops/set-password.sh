#!/bin/bash
# 대시보드 로그인 비밀번호를 정하거나 바꾼다. 바꾸면 모든 기기가 로그아웃된다.
# 정하기 전에는 Hub 토큰(~/.claude/hub-token)으로 로그인한다.
set -euo pipefail
read -r -s -p "새 비밀번호 (4자 이상): " pw; echo
read -r -s -p "한 번 더: " pw2; echo
[[ "$pw" == "$pw2" ]] || { echo "두 번 입력한 값이 다릅니다." >&2; exit 1; }
body=$(PW="$pw" node -e 'process.stdout.write(JSON.stringify({ password: process.env.PW }))')
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "X-Hub-Token: $(cat ~/.claude/hub-token)" -H 'Content-Type: application/json' \
  --data "$body" "http://127.0.0.1:${HUB_PORT:-2424}/api/auth/password")
[[ "$code" == 204 ]] && echo "비밀번호를 정했습니다." || { echo "실패 (HTTP $code)" >&2; exit 1; }
