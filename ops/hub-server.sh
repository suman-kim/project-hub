#!/bin/bash
# launchd가 띄우는 Hub 서버.
#
# 로그인 직후에는 Docker가 아직 안 떠 있을 수 있다. 바로 node를 띄우면 DB 연결에 실패해 종료되고,
# launchd가 10초마다 다시 띄우며 로그를 채운다. 그래서 DB 포트가 열릴 때까지 기다렸다가 node로 바뀐다.
set -u

cd "$(dirname "$0")/../apps/server" || exit 1

url="${HUB_DATABASE_URL:-postgres://hub:hub@127.0.0.1:5434/hub}"
if [[ "$url" =~ @([^:/]+):([0-9]+)/ ]]; then
  host="${BASH_REMATCH[1]}" port="${BASH_REMATCH[2]}"
else
  host=127.0.0.1 port=5432
fi

waited=0
until nc -z "$host" "$port" 2>/dev/null; do
  # 1분에 한 번만 남긴다.
  if (( waited % 60 == 0 )); then
    echo "$(date '+%F %T') DB($host:$port)가 열리기를 기다리는 중 (${waited}초). Docker Desktop이 켜져 있는지 확인하세요."
  fi
  sleep 5
  waited=$((waited + 5))
done

exec node dist/main.js
