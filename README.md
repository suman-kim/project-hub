# Hub · 프로젝트 관리

맥북 로컬에서 도는 Hub 서버. 설계와 단계별 계획은 `docs/Hub 서버 뼈대 작업 계획서.md`, Claude Code 연결 설정은 `docs/claude-hub-setup/`에 있다.

## 실행

```bash
corepack enable            # pnpm (packageManager에 고정된 버전)
pnpm install
pnpm db:up                 # PostgreSQL 16, 127.0.0.1:5434 (DB hub, 테스트용 hub_test)
pnpm build
pnpm --filter @hub/server seed     # 앱 4개 등록 (이미 있으면 건너뜀)
node apps/server/dist/main.js      # http://127.0.0.1:2424, 시작할 때 마이그레이션 자동 실행
```

- 포트는 `2424`, `127.0.0.1`에만 바인딩한다. `HUB_PORT`로 바꿀 수 있다.
- 토큰은 `~/.claude/hub-token`(권한 600). 없으면 서버가 처음 뜰 때 만든다. `GET /health`를 뺀 모든 요청에 `X-Hub-Token` 헤더가 필요하다.
- 기존 Task Master task 가져오기: `POST /api/import/taskmaster {"app":"LK"}`. 가능하면 원래 번호를 그대로 쓴다(Task Master 4번 → `LK-4`).

## 상주 실행 (launchd)

```bash
pnpm hub:install     # 빌드 → LaunchAgent 2개 등록 → 기동 확인. 코드를 바꾼 뒤 다시 실행하면 재시작된다
pnpm hub:uninstall   # 내리고 plist 삭제 (로그와 백업은 남김)
```

| LaunchAgent | 하는 일 | 로그 |
| --- | --- | --- |
| `com.claude-hub.server` | 로그인하면 Hub를 띄우고, 죽으면 다시 띄운다. DB 포트가 열릴 때까지 기다렸다가 시작한다(`ops/hub-server.sh`) | `~/Library/Logs/hub/server.log` |
| `com.claude-hub.backup` | 한 시간마다 `ops/backup.sh`. 오늘 백업이 없을 때만 `pg_dump` | `~/Library/Logs/hub/backup.log` |

- launchd는 로그인 셸의 PATH를 모른다. 설치할 때 셸에서 찾은 `node`, `claude`, `gh`, `git`, `docker`의 폴더로 PATH를 만들어 plist에 넣는다. 도구 위치가 바뀌면 다시 설치한다.
- DB가 Docker 안에 있으므로 Docker Desktop의 "Start Docker Desktop when you sign in"을 켜 두어야 재부팅 후 Hub가 뜬다.
- 재시작만 하려면 `launchctl kickstart -k gui/$(id -u)/com.claude-hub.server`.
- 개발 중에 직접 `node dist/main.js`를 띄우려면 먼저 `pnpm hub:uninstall`로 내린다(포트 2424가 겹친다).

## 백업

- `~/.hub/backups/hub-YYYY-MM-DD.dump` (pg_dump custom 형식, 서울 날짜 기준 하루 1개, 14일 보관). 위치와 보관 일수는 `HUB_BACKUP_DIR`, `HUB_BACKUP_KEEP_DAYS`.
- 지금 바로 뜨기: `pnpm db:backup`
- 복원: `docker compose exec -T postgres pg_restore -U hub -d hub --clean --if-exists < ~/.hub/backups/hub-YYYY-MM-DD.dump` (Hub를 먼저 내린다)

## 비용

```bash
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/costs?month=2026-10'   # 월 합계, 앱·종류·날짜별 (month를 빼면 이번 달)
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/costs/monthly?limit=12'
```

- run마다 `claude -p`가 알려 준 `total_cost_usd`를 더해 `runs.cost_usd`에 남긴다(재개한 실행도 합산). 구독으로 실행하면 실제 청구액이 아니라 API로 환산한 값이다.
- 월과 날짜는 run 시작 시각의 서울 시간 기준이다.

## task 실행 (runner)

```bash
T=$(cat ~/.claude/hub-token)
curl -X POST -H "X-Hub-Token: $T" 127.0.0.1:2424/api/tasks/LK-7/run          # 큐에 넣는다
curl -H "X-Hub-Token: $T" 127.0.0.1:2424/api/runs/1                          # 상태, 질문(result.question)
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/runs/1/logs?after=0'           # 로그
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' \
  -d '{"answer":"..."}' 127.0.0.1:2424/api/runs/1/answer                     # 답하면 같은 세션으로 재개
curl -X POST -H "X-Hub-Token: $T" 127.0.0.1:2424/api/runs/1/stop
```

- 흐름: worktree(`~/.hub/worktrees/<앱>/<task>`, 브랜치 `hub/<task>-<slug>`) → `setup_cmd` → `claude -p` → 판정 → 커밋 확인 → push → `gh pr create` → task `review`.
- 동시 실행 2개(`HUB_RUN_CONCURRENCY`). 허용 도구는 `HUB_ALLOWED_TOOLS`로 바꾼다(기본값은 `config/hub-config.ts`). `git push`는 허용하지 않고 Hub가 직접 한다.
- 실행 원본 로그는 `~/.hub/logs/run-<id>.jsonl`. 실시간 이벤트는 `ws://127.0.0.1:2424/ws?token=<토큰>`.
- task가 `done`이나 `cancelled`가 되면 worktree를 지운다(브랜치는 남긴다).

## 기획 (아이디어 생성)

```bash
curl -X POST -H "X-Hub-Token: $T" 127.0.0.1:2424/api/apps/5/ideas/generate        # 즉시 생성 → run
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/ideas?status=pending'                 # 대기 중인 기획
curl -X POST -H "X-Hub-Token: $T" 127.0.0.1:2424/api/ideas/1/approve                # 예상 task 생성 + 기획 명세 저장
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' -d '{"note":"..."}'   127.0.0.1:2424/api/ideas/1/revise
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' -d '{"reason":"..."}' 127.0.0.1:2424/api/ideas/1/reject
```

- 생성은 저장소 원본에서 `--permission-mode dontAsk --allowedTools Read,Grep,Glob`으로 돈다. 입력은 앱 방향성 메모(`directionNote`), 열린 task, 최근 기획과 반려 사유.
- 자동 생성: 앱의 `ideaCron`(5필드, Asia/Seoul)을 `PATCH /api/apps/:id`로 넣으면 등록된다. 마지막으로 받은 사용량이 5시간·7일 창 중 하나라도 80%를 넘으면 건너뛴다.

## 새 앱 기획

저장소가 없는 새 앱을 구상해 제안하고, 승인하면 폴더와 GitHub 저장소를 만들어 Claude 세션으로 작업을 시작한다.

```bash
curl -X PATCH -H "X-Hub-Token: $T" -H 'Content-Type: application/json' \
  -d '{"directionNote":"1인 개발, 3개월 MVP","cron":"0 9 * * 6"}' 127.0.0.1:2424/api/settings/ideation   # 방향과 자동 생성 주기
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' -d '{"note":"..."}' 127.0.0.1:2424/api/concepts/generate
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/ideas?kind=app&status=pending'
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' -d '{"index":0}' 127.0.0.1:2424/api/ideas/7/develop   # 다른 후보를 깊게
curl -X POST -H "X-Hub-Token: $T" -H 'Content-Type: application/json' \
  -d '{"app":{"code":"TL","name":"공구함","folder":"tool-lend"}}' 127.0.0.1:2424/api/ideas/7/approve   # app은 생략하면 기획의 제안값
```

- 생성은 `~/.hub/ideation`에서 `Read,Grep,Glob,WebSearch,WebFetch`로 돈다. 등록된 앱의 README와 CLAUDE.md를 읽어 익숙한 스택을 파악하고, 비슷한 서비스와 시장을 웹에서 조사한다.
- 승인하면 앱 등록과 task 생성 뒤 bootstrap run이 돈다.
  1. `~/project/<폴더>`에 `git init`, README·CLAUDE.md·`docs/concept.md` 첫 커밋
  2. `gh repo create --private --push`. 같은 이름 저장소가 있으면 덮어쓰지 않고 실패
  3. 그 폴더만 `~/.claude.json` 작업 공간 신뢰 목록에 추가 (`claude --bg`는 신뢰하지 않은 폴더에서 시작하지 않는다)
  4. `claude --bg --rc "<코드> <이름>" --permission-mode auto`: 기획 읽기 → UI 디자인 확인 → 첫 task를 `hub/` 브랜치에서 구현 → PR. claude.ai/code나 Claude 앱에서 이어서 본다. 권한 모드는 설정 `sessionPermissionMode`(`auto` 기본, `acceptEdits`)
- 세션을 못 띄우면 runner로 첫 task를 대신 시작한다. 중간에 실패하면 `POST /api/apps/:id/bootstrap`으로 다시 돌린다(끝난 단계는 건너뜀).
- 세션은 Claude Code 백그라운드 데몬 안에서 돌아 터미널 창이나 데스크톱 앱 목록에는 없다. 목록은 `claude agents`, 터미널에서 열려면 `claude attach <ID>`, 최근 출력은 `claude logs <ID>`.

## 통합 관리 (앱 페이지용 API)

```bash
curl -H "X-Hub-Token: $T" 127.0.0.1:2424/api/apps/status              # 앱마다 진행 상태와 점 색(risk/attn/prog/quiet/ok)
curl -H "X-Hub-Token: $T" 127.0.0.1:2424/api/apps/1/overview          # 개요: 숫자, 신호, 저장소별 최근 배포, 최근 히스토리, 다음 할 일
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/activities?app=LK&kind=deploy'   # 히스토리 (kind: task, run, idea, app, deploy, repo, note)
curl -H "X-Hub-Token: $T" '127.0.0.1:2424/api/tasks?app=LK&type=bug'  # 버그 / assignee=me 면 내 할 일
curl -H "X-Hub-Token: $T" 127.0.0.1:2424/api/apps/1/sessions          # Hub 밖 세션(claude --bg) 상태, 허락 대기 명령, 원격 조종 링크
```

- **task**: `type`(feature, bug, chore), `assignee`(claude, me), `priority`(1~3), `dueDate`, `stage`, `repoId`. 버그 정보는 `bug: {severity, steps, expected, actual, env, version}`. 내 할 일은 리뷰 없이 `done`으로 가고 runner가 실행하지 않는다.
- **앱**: `description`, `links`, `stack`, `lifecycle`(developing, operating, paused, archived), `stages`(기본 6단계, 앱마다 편집), `stage`, `checkCmd`(push 전 검사, 실패하면 PR 안 만듦), `worktreeRoot`.
- **저장소 목록**: 앱 폴더가 git 저장소면 그 하나, 아니면 바로 아래 git 저장소들을 찾는다(`POST /api/apps/:id/repos/detect`, 시작할 때 자동). 저장소가 여러 개인 앱은 task에 `repoId`를 정해야 실행된다.
- **배포**: `GET /api/apps/:id/deployments`. Hub가 5분마다 GitHub에서 가져온다(Railway·Vercel이 남긴 배포 기록, 저장소 `deployRules`에 정한 Actions 워크플로). 워크플로 규칙은 처음에 이름으로 짐작해 넣고(`PATCH /api/repos/:id`로 고친다), 지금 바로는 `POST /api/deployments/sync`. 리뷰 중인 task의 PR이 머지되면 task를 `done`으로 바꾼다. 스토어 제출처럼 GitHub에 없는 배포는 `POST /api/apps/:id/deployments`나 MCP `record_deploy`.
- **히스토리**: task·실행·기획·단계·진행 상태·배포·메모가 `activities`에 쌓인다. 직접 메모는 `POST /api/apps/:id/activities {summary}`.
- **Task Master 가져오기**: `{"app":"LK","dryRun":true}`로 미리 보기, `{"update":true}`면 바뀐 task의 제목·설명·의존을 덮어쓴다(상태는 Hub 것).

## 대시보드 로그인

- 화면 로그인은 비밀번호다(30일 유지, 5번 틀리면 10분 잠금). 정하기 전에는 Hub 토큰으로 들어온다. `pnpm hub:password`로 정하거나 바꾼다(바꾸면 모든 기기 로그아웃).
- hook, MCP, 스크립트는 지금처럼 `X-Hub-Token`을 쓴다. 쿠키로 들어온 요청이 데이터를 바꿀 때는 Origin이 Hub 주소인지 확인한다.

## 규칙

- `GET /api/rules`, `PUT /api/rules {"rules":[{"body":"..."},{"app":"LK","body":"..."}]}`. 저장하면 `~/.claude/rules/hub-rules.md`를 원자적으로 다시 쓴다(새 세션부터 적용).
- 처음 뜰 때 DB가 비어 있으면 기존 파일의 번호 목록을 가져온다. 파일은 PUT 전까지 건드리지 않는다.

## Claude Code에 연결

```bash
# hook과 규칙 (docs/claude-hub-setup/README.md의 설치 절차)
# MCP
claude mcp add --transport http --scope user hub http://127.0.0.1:2424/mcp --header "X-Hub-Token: $(cat ~/.claude/hub-token)"
```

### task 강제 (가드)

- 직접 연 세션은 진행 중(doing·input) task가 연결되기 전까지 Bash와 파일 수정 도구가 막힌다. 읽기 도구와 MCP 도구는 막지 않는다. 앱마다 설정의 "task 없는 세션 막기"로 끈다(새 앱은 켜진 채로 생긴다).
- 세션이 `update_task_status`로 task를 doing·input으로 바꾸면 Hub가 PostToolUse 기록을 보고 그 세션에 task를 연결한다. review·done·cancelled면 연결을 푼다.
- 프로젝트 폴더 위치(`projectRoot`, 기본 `~/project`) 안에서 앱으로 등록되지 않은 폴더도 막는다. 밖의 폴더와 Hub가 띄운 세션(`HUB_TASK_ID`, `HUB_RUN_ID`)은 막지 않는다.
- Hub가 꺼져 있으면 막지 않는다. 급할 때는 `HUB_GUARD=off claude`로 연다.
- 앱 판별은 작업 폴더가 앱 폴더(`repo_path`) 안이거나 경로에 `folder_names`의 이름이 있을 때다.

## 테스트

```bash
pnpm --filter @hub/server test     # 단위 + e2e. e2e는 hub_test DB의 스키마를 지우고 다시 만든다
```

## 구성

| 경로 | 내용 |
| --- | --- |
| `packages/shared` | 상태 enum과 전이 규칙, DTO, WebSocket 이벤트 타입 |
| `apps/server/src/modules/apps` | 앱 등록, 작업 폴더 → 앱 판별 |
| `apps/server/src/modules/tasks` | task CRUD, ID 채번, 상태 전이, Task Master 가져오기 |
| `apps/server/src/modules/sessions` | 세션과 hook 이벤트 기록 (비밀값 가림) |
| `apps/server/src/modules/knowledge` | 실수 기록, 명세·인수인계 문서 |
| `apps/server/src/modules/context` | SessionStart `[Hub context]` 조립 (8,000자 상한) |
| `apps/server/src/modules/hooks` | `/api/hooks/*` 입구 |
| `apps/server/src/modules/mcp` | `/mcp` 입구 (Streamable HTTP, 도구 8개) |
| `apps/server/src/modules/runner` | worktree, claude 실행기, stream-json 파서, 판정, PR, pg-boss 큐, 새 앱 기획 생성과 시작(bootstrap) |
| `apps/server/src/modules/ideas` | 기획, 버전, 승인·수정·반려 |
| `apps/server/src/modules/scheduler` | 앱별 아이디어 생성 주기 (pg-boss schedule) |
| `apps/server/src/modules/rules` | 규칙 저장과 `hub-rules.md` 내보내기 |
| `apps/server/src/modules/costs` | run 비용 월 합계 |
| `apps/server/src/modules/settings` | 앱에 묶이지 않는 설정 (새 앱 기획) |
| `apps/server/src/modules/repos` | 앱의 저장소 목록, task를 돌릴 저장소 고르기 |
| `apps/server/src/modules/deployments` | 배포 기록, GitHub 배포·Actions 가져오기, PR 머지 확인 |
| `apps/server/src/modules/activities` | 앱 히스토리 |
| `apps/server/src/modules/overview` | 앱 개요, 상태 신호, Hub 밖 세션 |
| `apps/server/src/modules/auth` | 대시보드 비밀번호 로그인 |
| `ops/` | launchd 설치·해제, 서버 시작, DB 백업 스크립트 |
| `apps/server/src/modules/realtime` | 이벤트 버스와 WebSocket `/ws` |
