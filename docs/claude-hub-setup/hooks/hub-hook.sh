#!/bin/bash
# Claude Code hook 입력을 로컬 Hub로 넘기는 얇은 중계 스크립트.
#
# 사용: hub-hook.sh <session-start | pre-tool-use | event | wait>
#   stdin  : Claude Code가 넘겨주는 hook 입력 JSON (session_id, cwd, hook_event_name ...)
#            파싱하지 않고 그대로 Hub에 POST한다. 판단은 Hub가 한다.
#   stdout : Hub 응답 본문을 그대로 출력한다.
#            session-start -> 세션 맥락 텍스트 ([Hub context] 블록)
#            pre-tool-use  -> 막을 때만 판정 JSON, 아니면 빈 응답 (파일 수정 도구와 Bash)
#            event         -> 빈 응답 (UserPromptSubmit에서 본문이 있으면 매 메시지에 맥락으로 붙으니 주의)
#
# Hub가 꺼져 있거나 느리면 아무것도 출력하지 않고 0으로 끝난다. 세션은 막히지 않는다.
# HUB_GUARD=off로 연 세션은 pre-tool-use를 묻지 않는다(급할 때 쓰는 해제 스위치). 기록은 그대로 남긴다.

set -u

kind="${1:-event}"
if [ "$kind" = "pre-tool-use" ] && [ "${HUB_GUARD:-}" = "off" ]; then
  cat > /dev/null
  exit 0
fi
hub_url="${HUB_URL:-http://127.0.0.1:2424}"
token_file="$HOME/.claude/hub-token"

case "$kind" in
  session-start) path="/api/hooks/session-start"; max_time=3 ;;
  pre-tool-use)  path="/api/hooks/pre-tool-use";  max_time=2 ;;
  *)             path="/api/hooks/event";         max_time=2 ;;
esac

headers=(-H "Content-Type: application/json")
if [ -r "$token_file" ]; then
  headers+=(-H "X-Hub-Token: $(tr -d '\n' < "$token_file")")
fi

# wait: 턴이 끝날 때(Stop) asyncRewake로 백그라운드에서 띄운다. 입력 대기 중인 세션에는 hook이 오지 않으므로
# Hub에 대시보드 메시지를 기다렸다가, 오면 stderr로 내고 코드 2로 끝나 세션을 깨운다.
# Hub가 410을 주면(새 대기가 생겼거나 세션이 다시 움직였다) 조용히 끝난다. Hub가 띄운 claude -p 세션에서는 하지 않는다.
if [ "$kind" = "wait" ]; then
  [ -n "${HUB_RUN_ID:-}" ] && { cat > /dev/null; exit 0; }
  sid="$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p' | head -1)"
  [ -z "$sid" ] && exit 0
  body_file="$(mktemp -t hub-wait)"
  trap 'rm -f "$body_file"' EXIT
  deadline=$(( $(date +%s) + ${HUB_WAIT_SECONDS:-21000} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl -s -o "$body_file" -w '%{http_code}' --max-time 260 "${headers[@]}" "${hub_url}/api/hooks/wait?session=${sid}" 2>/dev/null)" || code=000
    case "$code" in
      200) cat "$body_file" >&2; exit 2 ;;
      204) ;;
      410) exit 0 ;;
      *) sleep 30 ;;
    esac
  done
  exit 0
fi

# Hub가 띄운 세션이면 HUB_RUN_ID가, task 실행이면 HUB_TASK_ID도 들어 있다.
query="kind=${kind}&task=${HUB_TASK_ID:-}&run=${HUB_RUN_ID:-}"

body="$(curl -s --fail --max-time "$max_time" -X POST "${headers[@]}" \
  --data-binary @- "${hub_url}${path}?${query}" 2>/dev/null)" || exit 0

if [ -n "$body" ]; then
  printf '%s\n' "$body"
fi
exit 0
