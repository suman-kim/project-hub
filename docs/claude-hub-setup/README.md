# Claude Code ↔ Hub 연결 설정 (초안)

맥북에서 도는 모든 Claude Code 세션이 Hub를 알고, 내 규칙을 자동으로 읽고, 활동을 Hub에 보고하게 만드는 설정 묶음이다.
Hub가 직접 띄우는 세션(`claude -p`)과 내가 터미널에서 연 세션 모두에 똑같이 적용된다.

## 파일

| 파일 | 설치 위치 | 역할 |
|---|---|---|
| `rules/hub.md` | `~/.claude/rules/hub.md` | Hub가 무엇이고 어떻게 쓰는지 (모든 세션이 시작할 때 읽음) |
| `rules/hub-rules.md` | `~/.claude/rules/hub-rules.md` | 내 작업 규칙. 초안이니 직접 고칠 것. 나중에는 Hub 규칙 화면이 이 파일을 써 준다 |
| `hooks/hub-hook.sh` | `~/.claude/hooks/hub-hook.sh` | hook 입력을 Hub로 넘기고, Hub 응답을 Claude Code에 돌려주는 중계 스크립트 |
| `settings.hub.json` | `~/.claude/settings.json`에 합침 | hook 등록과 금지 규칙 |
| `mock-hub.mjs` | 아무 데나 | 진짜 Hub 전에 연결을 시험하는 가짜 Hub |

## 설치

```bash
mkdir -p ~/.claude/rules ~/.claude/hooks
cp rules/hub.md rules/hub-rules.md ~/.claude/rules/
cp hooks/hub-hook.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/hub-hook.sh
```

`settings.json`은 덮어쓰지 말고 합친다.

- `~/.claude/settings.json`이 없으면: `cp settings.hub.json ~/.claude/settings.json`
- 이미 있으면: 백업한 뒤 jq로 합친다 (`brew install jq`).

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] as $a | .[1] as $b | ($a * $b)
  | .permissions.deny = ((($a.permissions.deny // []) + ($b.permissions.deny // [])) | unique)' \
  ~/.claude/settings.json settings.hub.json > /tmp/settings.merged.json \
  && mv /tmp/settings.merged.json ~/.claude/settings.json
```

기존 설정에 같은 이벤트(SessionStart 등)의 hook이 이미 있으면 위 명령이 그 배열을 덮어쓰니, 그 경우엔 손으로 합친다.

선택: Hub에 토큰을 걸려면 `~/.claude/hub-token` 파일에 값을 넣는다. 스크립트가 `X-Hub-Token` 헤더로 보낸다.

## 시험해 보기 (가짜 Hub)

1. 가짜 Hub 실행: `node mock-hub.mjs`
2. `mock-hub.mjs`의 `APPS`에 실제 저장소 폴더 이름을 맞춘다 (`chat`, `daily-work` 등).
3. 저장소에서 task를 붙여 세션을 연다: `HUB_TASK_ID=LK-57 claude`
4. 세션에서 물어본다: "세션 시작할 때 들어온 Hub context를 그대로 보여줘"
5. 가짜 Hub 터미널과 `http://127.0.0.1:2424` 에 이벤트가 찍히는지 본다.
6. 가드 시험: `GUARD=1 node mock-hub.mjs`로 다시 띄우고 `HUB_TASK_ID` 없이 `claude`를 연 뒤 파일 수정을 시켜 본다. 거부되면 정상.
7. Hub를 끄고 `claude`를 연다. 세션이 평소처럼 시작되면 정상 (hook은 조용히 넘어간다).

## Hub가 구현해야 할 API

| 요청 | 받는 것 | 돌려줄 것 |
|---|---|---|
| `POST /api/hooks/session-start?kind=&task=` | hook 입력 JSON (`session_id`, `cwd`, `source`) | `text/plain` 맥락. 사실 문장으로, 8,000자 이내 |
| `POST /api/hooks/pre-tool-use?kind=&task=&run=` | hook 입력 JSON (`tool_name`, `tool_input`) | 막을 때만 deny JSON, 아니면 204 |
| `POST /api/hooks/event?kind=&task=&run=` | hook 입력 JSON (`hook_event_name`으로 구분) | 204. 본문을 주면 UserPromptSubmit에서 매 메시지에 맥락으로 붙는다 |

- `task`, `run` 쿼리는 Hub가 세션을 띄울 때 넣은 `HUB_TASK_ID`, `HUB_RUN_ID`다. 직접 연 세션이면 비어 있고, 앱은 `cwd`로 판별한다.

## task 강제 (가드)

- Bash와 파일 수정 도구(Edit, Write, MultiEdit, NotebookEdit)를 부르기 전에 Hub에 묻는다. 읽기 도구와 MCP 도구는 막지 않는다.
- 가드가 켜진 앱(새 앱은 기본으로 켜짐, 앱 설정에서 끔)에서는 이 세션에 진행 중(doing)이나 답변 대기(input) task가 연결되어 있어야 통과한다.
- 세션이 `update_task_status`로 task를 doing·input으로 바꾸면 PostToolUse 기록을 보고 Hub가 그 세션에 task를 연결한다. review·done·cancelled로 바꾸면 연결을 푼다. `/hub-task <ID>`도 이 방식으로 연결된다.
- 앱으로 등록되지 않은 폴더라도 프로젝트 폴더 위치(새 앱 기획 설정의 `projectRoot`, 기본 `~/project`) 안이면 막는다. 밖의 폴더는 막지 않는다.
- Hub가 띄운 세션(`HUB_TASK_ID`, `HUB_RUN_ID`)은 막지 않는다.
- Hub가 꺼져 있으면 막지 않는다(규칙 6번: 연결할 수 없으면 task 갱신을 건너뛰고 작업을 계속한다).
- 급할 때는 `HUB_GUARD=off claude`로 세션을 열면 묻지 않는다.
- SessionStart 맥락은 1만 자가 상한이다. 넘으면 파일로 빠지고 앞 2,000자만 보이니 핵심을 앞에 둔다.
- deny JSON 형식은 `mock-hub.mjs`의 pre-tool-use 응답을 참고한다.

## 알아둘 점

- 규칙과 hook은 새 세션부터 적용된다. 이미 돌고 있는 세션에는 반영되지 않는다.
- Hub가 세션을 띄울 때 `--bare`를 쓰지 않는다. `--bare`는 rules, hooks, MCP를 전부 건너뛴다.
- `rules/*.md`는 지침이라 어길 수 있다. 꼭 막아야 하는 것은 `permissions.deny`나 PreToolUse hook으로 막는다.
- `permissions.deny`는 안전망이다. `git -C . push origin main`처럼 돌아가는 명령까지 다 막지는 못하니, main 보호는 GitHub 브랜치 보호 규칙으로도 걸어 둔다. `Read(./.env)` 거부는 Read 도구만 막고 Bash의 `cat .env`는 막지 않는다.
- `hub.md`에 적은 MCP 도구 이름은 Hub MCP를 만들 때 실제 이름과 맞춘다. Hub MCP를 만든 뒤 등록: `claude mcp add --transport http --scope user hub http://127.0.0.1:2424/mcp --header "X-Hub-Token: $(cat ~/.claude/hub-token)"`
- task를 Hub로 옮긴 뒤에는 각 저장소의 Task Master MCP 설정을 꺼 둔다. 둘 다 켜져 있으면 Claude가 어느 쪽에 기록할지 헷갈린다.
