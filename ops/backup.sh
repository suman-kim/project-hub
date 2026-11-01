#!/bin/bash
# Hub DB 일일 백업.
#
# launchd가 한 시간마다 부르고, 오늘(서울 시간) 백업이 이미 있으면 바로 끝난다.
# 정해진 시각에 한 번만 돌리면 맥북이 잠들어 있거나 Docker가 꺼져 있을 때 그날 백업을 놓친다.
#
# 사용: backup.sh [--force]   --force는 오늘 백업이 있어도 다시 뜬다.
# 복원: docker compose exec -T postgres pg_restore -U hub -d hub --clean --if-exists < ~/.hub/backups/hub-YYYY-MM-DD.dump
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="${HUB_BACKUP_DIR:-$HOME/.hub/backups}"
keep_days="${HUB_BACKUP_KEEP_DAYS:-14}"
out="$dir/hub-$(TZ=Asia/Seoul date +%F).dump"
compose=(docker compose -f "$repo/docker-compose.yml")

mkdir -p "$dir" && chmod 700 "$dir"
if [[ -s "$out" && "${1:-}" != "--force" ]]; then
  exit 0
fi

# 호스트의 pg_dump는 서버(16)와 버전이 다를 수 있어 컨테이너 안의 pg_dump를 쓴다.
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT
"${compose[@]}" exec -T postgres pg_dump -U hub -d hub -Fc > "$tmp"
# 끝까지 써진 덤프인지 목차를 읽어 확인한 뒤에 이름을 바꾼다.
"${compose[@]}" exec -T postgres pg_restore -l < "$tmp" > /dev/null
mv "$tmp" "$out"
chmod 600 "$out"
echo "$(date '+%F %T') 백업 $out ($(du -h "$out" | cut -f1))"

find "$dir" -name 'hub-*.dump' -mtime "+$keep_days" -print -delete | sed 's/^/  오래된 백업 삭제: /'
