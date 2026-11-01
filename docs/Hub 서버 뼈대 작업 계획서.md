# Hub 서버 뼈대 작업 계획서

Oct 26, 2026 · @suman

## 목표와 범위

뼈대의 목표는 대시보드 없이도 API만으로 "task 실행 → 로그 → PR"이 끝까지 도는 Hub 서버다. 맥북에서 Hub를 켜면 모든 Claude 세션이 Hub 맥락을 받아 시작하고, 활동이 Hub에 기록되어야 한다.

**뼈대에 포함**

- Hub 서버 프로세스(NestJS)와 PostgreSQL
- hook 수신 API 3개: claude-hub-setup 계약 그대로, `mock-hub.mjs`를 대체
- 앱·task·기획 데이터 모델과 REST API
- Hub MCP 서버(`/mcp`)와 핵심 도구 8개
- runner: worktree 생성 → `claude -p` 실행 → 로그 스트림 → 결과 기록 → PR
- 아이디어 생성 스케줄러(최소 기능)와 승인 흐름
- 규칙 파일 내보내기(`~/.claude/rules/hub-rules.md`)
- WebSocket 이벤트: 나중에 UI가 붙을 자리

**뼈대에서 제외 (다음 단계)**

- 웹 대시보드 UI: 샘플 화면을 기준으로 별도 계획
- 권한 요청을 대시보드에서 승인하는 흐름(`--permission-prompt-tool`)
- PR 머지 자동화, 비용 대시보드, 알림, 밖에서 접속(Tailscale)

**완료의 정의**

1. 재부팅 후 Hub가 자동으로 떠 있고, 새 Claude 세션에 `[Hub context]`가 들어간다.
2. `POST /api/tasks/:id/run` 하나로 worktree 생성부터 PR 생성까지 끝난다.
3. 질문으로 끝난 실행에 답하면 같은 세션으로 이어서 실행된다.

## 설계 전제

아래는 이미 정한 결정이라, 뼈대는 이 전제를 바꾸지 않고 따른다.

| 항목 | 결정 |
| --- | --- |
| 실행 위치 | Hub는 맥북 로컬에서만 돈다. `127.0.0.1:2424`에만 바인딩한다 |
| task의 원천 | Hub DB. 각 저장소의 Task Master `tasks.json`은 한 번 가져온 뒤 쓰지 않는다 |
| 세션 연결 | `~/.claude/rules` + hooks + Hub MCP (claude-hub-setup 묶음) |
| hook API | `session-start`, `pre-tool-use`, `event` 3개, 토큰은 `X-Hub-Token` 헤더 |
| 세션 실행 | `claude -p`를 자식 프로세스로 실행한다. 맥북 로그인 계정을 쓰고 `--bare`는 쓰지 않는다 |
| 작업 격리 | 작업마다 git worktree 하나, 브랜치는 `hub/<task-id>-<slug>` |
| 반영 방식 | main에 직접 push하지 않고 PR로만 반영한다. 머지는 내가 한다 |
| 앱 | Link(LK), 하루알바(HR), cyphers-meta(CM), 오늘알바(OA). 앱 추가는 데이터로 한다 |

## 기술 스택

TypeScript 하나로 서버와 공용 타입을 묶고, 맥북 한 대에서 돌리기 쉽게 움직이는 부품 수를 줄였다.

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 런타임 | Node 22, TypeScript | Claude Agent SDK, MCP SDK가 TS를 지원해 나중에 실행기를 바꾸기 쉽다 |
| 서버 | NestJS | 기존 프로젝트와 같은 구조. 모듈과 DI로 hook·MCP·REST를 같은 서비스 위에 얇게 둔다 |
| DB | PostgreSQL 16 (Docker Compose), TypeORM | 익숙한 조합. 엔티티를 바꾸면 마이그레이션을 같이 만든다 |
| 큐·스케줄 | pg-boss | Postgres 위에서 재시도, 동시 실행 제한, cron을 처리해 Redis가 필요 없다 |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP | 같은 서버의 `/mcp`에 붙여 프로세스 하나로 운영한다 |
| 실시간 | `@nestjs/websockets` | 실행 로그와 상태를 UI에 밀어 준다 |
| 세션 실행 | `child_process.spawn` + `claude -p --output-format stream-json` | 맥북 로그인 계정으로 돈다. 실행기 인터페이스 뒤에 두어 Agent SDK로 바꿀 수 있게 한다 |
| git | git CLI(worktree), gh CLI(PR) | 별도 라이브러리 없이 맥북에 있는 도구를 쓴다 |
| 저장소 구성 | pnpm workspace | `apps/server`, `packages/shared`, 나중에 `apps/web` |
| 상주 | launchd LaunchAgent | 로그인하면 자동으로 뜨고, 죽으면 다시 띄운다 |

## 프로젝트 구조

도메인 모듈(apps, tasks, ideas, sessions, knowledge)이 로직을 갖고, hook·MCP·REST·runner는 그 서비스를 부르는 얇은 입구로 둔다. 같은 규칙이 어느 입구로 들어와도 똑같이 적용되게 하기 위해서다.

```
hub/
├─ apps/
│  └─ server/
│     ├─ src/
│     │  ├─ main.ts              127.0.0.1:2424 바인딩
│     │  ├─ config/              포트, 토큰, 경로(~/.hub, ~/.claude)
│     │  ├─ db/                  TypeORM 설정, migrations/
│     │  ├─ common/              토큰 가드, 에러 형식
│     │  └─ modules/
│     │     ├─ apps/             앱 등록, 작업 폴더 → 앱 판별
│     │     ├─ tasks/            task CRUD, ID 채번, 상태 전이
│     │     ├─ ideas/            기획, 버전, 승인·수정·반려
│     │     ├─ sessions/         세션과 hook 이벤트 기록
│     │     ├─ knowledge/        실수 기록, 명세(spec)
│     │     ├─ context/          SessionStart 맥락 조립
│     │     ├─ hooks/            /api/hooks/* 입구
│     │     ├─ mcp/              /mcp 입구 (Hub MCP 도구)
│     │     ├─ runner/           worktree, claude 프로세스, 스트림 파서
│     │     ├─ scheduler/        아이디어 생성 주기 (pg-boss)
│     │     ├─ rules/            규칙 → ~/.claude/rules 파일 내보내기
│     │     └─ realtime/         WebSocket 게이트웨이
│     └─ test/
├─ packages/
│  └─ shared/                    상태 enum, DTO, WebSocket 이벤트 타입
├─ docker-compose.yml            postgres
└─ ops/
   └─ hub.plist                  launchd 등록 파일
```

Hub가 쓰는 맥북 경로는 두 곳이다. `~/.hub/`에는 worktree와 실행 로그 원본을 두고, `~/.claude/rules/hub-rules.md`에는 규칙을 내보낸다.

## 데이터 모델

테이블은 15개다. task ID는 앱 코드와 앱별 순번을 붙여 `LK-57`처럼 만든다.

| 테이블 | 핵심 컬럼 | 비고 |
| --- | --- | --- |
| `apps` | `code`, `name`, `repo_path`, `default_branch`, `folder_names[]`, `setup_cmd`, `idea_cron`, `guard_enabled`, `direction_note`, `next_task_seq` | `folder_names`로 작업 폴더 → 앱을 판별한다 |
| `tasks` | `id`, `app_id`, `idea_id`, `title`, `description`, `status`, `size`, `tag`, `depends_on[]`, `branch`, `pr_url`, `metadata` | `tag`는 Task Master 태그를 옮겨 담는다 |
| `ideas` | `kind`, `app_id`, `title`, `status`, `current_version`, `reject_reason` | 상태: pending, revising, approved, rejected. `kind`: feature(등록된 앱의 기능 기획), app(새 앱 기획, 승인해서 앱이 생기기 전까지 `app_id`가 비어 있다) |
| `idea_versions` | `idea_id`, `version`, `body`(JSON), `revision_note`, `run_id` | `body` = 문제, 제안, 시나리오, 명세, 영향 범위, 예상 task. 새 앱 기획은 `concept`(대상 사용자, MVP 기능, 비슷한 서비스, 시장, 수익 모델, 기술 스택, 리스크, 수요 검증, 제안 앱 코드·폴더, 다른 후보, 출처)가 더 있다 |
| `runs` | `task_id`, `kind`, `status`, `claude_session_id`, `worktree_path`, `branch`, `cost_usd`, `result`(JSON), `started_at`, `ended_at` | `kind`: implement, idea\_gen, bootstrap(새 앱 폴더·저장소·세션 시작) |
| `run_logs` | `run_id`, `seq`, `ts`, `kind`, `text`, `raw`(JSON) | `raw`에 stream-json 원본을 그대로 남긴다 |
| `sessions` | `claude_session_id`, `app_id`, `task_id`, `run_id`, `origin`, `cwd`, `started_at`, `ended_at` | `origin`: local(직접 연 세션), hub(Hub가 띄운 세션) |
| `session_events` | `session_id`, `event`, `tool_name`, `summary`, `payload`(JSON) | hook 입력 원본을 남긴다 |
| `mistakes` | `app_id`, `what`, `correct_way`, `session_id`, `active` | 맥락에는 `active`인 것만 넣는다 |
| `specs` | `idea_id`, `task_id`, `kind`, `title`, `body`(markdown) | `kind`: spec(기획 명세), handoff(인수인계) |
| `rules` | `scope`, `app_id`, `position`, `body`(markdown) | `scope`: global, app |
| `app_repos` | `app_id`, `name`, `path`, `github`, `default_branch`, `setup_cmd`, `check_cmd`, `deploy_rules` | 앱 하나에 저장소 여러 개 (통합 관리 확장) |
| `deployments` | `app_id`, `repo_id`, `source`, `external_id`, `environment`, `env`, `version`, `sha`, `status`, `url`, `notes` | GitHub 배포·Actions에서 가져오거나 직접 기록 |
| `activities` | `app_id`, `at`, `kind`, `actor`, `ref_type`·`ref_id`, `summary`, `data` | 앱 히스토리 |
| `hub_settings` | `key`, `value`(JSON) | 앱에 묶이지 않는 설정. 지금은 `ideation`(새 앱 기획 방향, 주기, 폴더 위치, GitHub 소유자) |

**task 상태 전이**

`todo` → `doing` ⇄ `input` → `review` → `done`. 어느 상태에서든 `cancelled`로 갈 수 있고, 그 밖의 전이는 서비스가 거부한다.

**run 상태 전이**

`queued` → `running` ⇄ `input` → `done` / `failed` / `stopped`. task 상태는 run 상태를 따라 바뀐다.

## API 설계

입구는 네 종류다. `GET /health`를 뺀 모든 요청은 `X-Hub-Token`을 검사한다. 토큰은 `~/.claude/hub-token`(권한 600)에 둔다.

**hook 수신 (계약 고정, claude-hub-setup과 동일)**

| 요청 | 받는 것 | 돌려주는 것 |
| --- | --- | --- |
| `POST /api/hooks/session-start?kind=&task=` | hook 입력 JSON (`session_id`, `cwd`, `source`) | `text/plain` 맥락, 8,000자 이내 |
| `POST /api/hooks/pre-tool-use?kind=&task=` | hook 입력 JSON (`tool_name`, `tool_input`) | 막을 때만 deny JSON, 아니면 204 |
| `POST /api/hooks/event?kind=&task=` | hook 입력 JSON (`hook_event_name`으로 구분) | 204, 본문 없음 |

**REST (UI와 스크립트용)**

| 요청 | 하는 일 |
| --- | --- |
| `GET/POST /api/apps`, `PATCH /api/apps/:id` | 앱 등록과 설정 |
| `GET /api/tasks?app=&status=`, `POST /api/tasks`, `PATCH /api/tasks/:id` | task 조회, 생성, 상태 변경 |
| `POST /api/tasks/:id/run` | run을 만들고 큐에 넣는다 |
| `GET /api/runs/:id`, `GET /api/runs/:id/logs?after=` | run 상태, `seq` 이후 로그 |
| `POST /api/runs/:id/answer` | 답변으로 같은 세션을 `--resume` 재실행 |
| `POST /api/runs/:id/stop` | 실행 중지 (SIGINT) |
| `GET /api/ideas?status=&kind=`, `GET /api/ideas/:id` | 기획 목록과 상세(버전 포함) |
| `POST /api/ideas/:id/approve`, `/revise`, `/reject` | 승인(task 생성, 새 앱 기획은 앱 시작까지), 수정 요청(새 버전), 반려(사유 저장) |
| `POST /api/apps/:id/ideas/generate` | 아이디어 즉시 생성 |
| `POST /api/concepts/generate`, `POST /api/ideas/:id/develop` | 새 앱 기획 즉시 생성, 다른 후보를 골라 깊게 생성 |
| `POST /api/apps/:id/bootstrap` | 새 앱 시작 단계(폴더, 저장소, 세션) 다시 돌리기 |
| `GET/PATCH /api/settings/ideation` | 새 앱 기획 설정 |
| `GET /api/costs?month=`, `GET /api/costs/monthly` | run 비용 월 합계와 내역 |
| `GET/PUT /api/rules` | 규칙 조회와 저장, 저장하면 파일 내보내기 |
| `POST /api/import/taskmaster` | 앱 하나의 `tasks.json` 가져오기 |

**Hub MCP 도구 (`/mcp`, 이름은 `hub.md`와 같게)**

| 도구 | 입력 | 하는 일 |
| --- | --- | --- |
| `list_tasks` | `app?`, `status?` | task 목록 |
| `get_task` | `id` | task 상세와 연결된 명세 목록 |
| `create_tasks` | `app`, `tasks[]` | task 여러 개 생성, 의존 관계 포함 |
| `update_task_status` | `id`, `status`, `note?` | 상태 변경과 진행 메모 |
| `get_spec` / `save_spec` | `id` / `task_id`·`idea_id`, `kind`, `body` | 기획 명세와 인수인계 문서 |
| `record_mistake` | `app`, `what`, `correct_way` | 실수 기록 |
| `submit_idea` | `app`, `body` | 아이디어 제출 (직접 연 세션에서 사용, 자동 생성은 JSON 출력으로 받음) |

**WebSocket 이벤트**

`run.log`, `run.status`, `task.updated`, `idea.created`, `session.event`. 페이로드 타입은 `packages/shared`에 둔다.

## 핵심 흐름

run 하나는 claude 프로세스 여러 번(최초 실행과 답변마다의 재개)을 묶는다. 세션 ID를 run에 저장해 두므로, 질문에 답하면 같은 대화가 이어진다.

&#91;embedded content: run 실행 흐름 · 판정 1번, 재개 루프 1개\]

실패(프로세스 오류, 사용량 한도, 중지)는 판정에서 `failed`나 `stopped`로 끝나고, task는 `doing`에 남아 대시보드에 사유가 표시된다.

**실행 (runner)**

1. 큐: `runs`에 `queued`로 저장하고, pg-boss가 동시에 2개까지 꺼낸다.
2. worktree: `~/.hub/worktrees/<app>/<task-id>`에 `git worktree add -b hub/<task-id>-<slug>`를 하고, 앱의 `setup_cmd`를 돌린다.
3. 실행: `claude -p "<task 프롬프트>" --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "<앱별 목록>"`. 환경변수로 `HUB_TASK_ID`, `HUB_RUN_ID`를 준다.
4. 스트림: `system/init` 이벤트에서 `session_id`를 저장하고, 이후 이벤트를 `run_logs`와 WebSocket으로 보낸다.
5. 판정: 마지막 `result`의 구조화된 출력(검증 1번)으로 완료와 질문을 가른다.
6. 완료: 커밋 확인 → push → `gh pr create` → task를 `review`로 바꾸고 PR 링크를 저장한다.
7. 질문: task를 `input`으로 바꾼다. 답변이 오면 `claude -p "<답변>" --resume <session_id>`로 4번부터 다시 돈다.

task 프롬프트에는 task 설명, 기획 명세 요약, 완료 조건(테스트 통과, 커밋 규칙), 출력 스키마를 넣는다.

**아이디어 생성**

1. pg-boss cron이 앱별 주기마다 `idea_gen` run을 만든다.
2. worktree 없이 저장소 원본에서 읽기 도구만 허용해 실행한다: `--permission-mode dontAsk --allowedTools "Read,Grep,Glob"`.
3. 입력은 앱 방향성 메모, 열린 task, 최근 기획과 반려 사유다. 출력은 기획 JSON 스키마로 받는다.
4. 결과를 `ideas`와 `idea_versions` v1로 저장하고 `idea.created` 이벤트를 보낸다.
5. 수정 요청이 오면 같은 입력에 이전 버전과 요청을 더해 다음 버전을 만든다.

**세션 맥락 조립 (SessionStart)**

1. `cwd`를 `apps.folder_names`와 맞춰 앱을 찾는다. worktree 경로도 같은 방식으로 판별된다.
2. `task` 쿼리(`HUB_TASK_ID`)나 기존 세션 기록으로 task를 연결한다.
3. 앱, 이 세션의 task와 명세 유무, 열린 task 5개, 활성 실수 기록 5개 순서로 붙인다.
4. 8,000자를 넘으면 뒤에서부터 자른다. 그래서 중요한 내용이 앞에 오도록 순서를 고정한다.

## 작업 단계와 task 목록

7단계로 나누고, 각 단계는 끝나면 바로 써 볼 수 있는 상태로 끝낸다. 크기는 S(반나절 안팎), M(하루 안팎), L(며칠)로 적었다. M0 직후에 "먼저 검증할 것"의 1\~3번을 처리하고 M2로 넘어간다.

### M0. 기반 (S)

- [x] pnpm workspace, NestJS 앱, `packages/shared` 생성
- [x] docker-compose PostgreSQL, TypeORM 설정, 첫 마이그레이션
- [x] config: 포트 2424, `127.0.0.1` 바인딩, 토큰, 경로(`~/.hub`, `~/.claude`)
- [x] 토큰 가드와 `GET /health`

완료 기준: `curl 127.0.0.1:2424/health`가 200이고, 맥북의 다른 IP로는 접속되지 않는다.

### M1. 앱·task 도메인 (M)

- [x] `apps`, `tasks` 엔티티와 마이그레이션, task ID 채번
- [x] 상태 전이 서비스와 단위 테스트 (허용되지 않은 전이 거부)
- [x] REST: apps, tasks
- [x] Task Master `tasks.json` 가져오기 (태그 → `tag`)

완료 기준: 앱 4개를 등록하고, 기존 `tasks.json`을 가져와 `GET /api/tasks`로 조회된다.

### M2. hook 수신 (M)

- [x] `sessions`, `session_events`, `mistakes` 엔티티
- [x] `session-start`: 앱 판별(`cwd`), task 연결(`HUB_TASK_ID`), 맥락 조립(8,000자 상한)
- [x] `pre-tool-use`: 앱별 가드 옵션
- [x] `event`: 이벤트 저장, SessionEnd 처리

완료 기준: claude-hub-setup README의 "시험해 보기" 3\~7단계가 `mock-hub.mjs` 대신 실제 Hub로 통과한다.

### M3. Hub MCP (M)

- [x] `/mcp` Streamable HTTP 엔드포인트와 토큰 검사
- [x] 도구 8개 구현, `specs` 엔티티
- [ ] `claude mcp add --transport http --scope user hub http://127.0.0.1:2424/mcp --header "X-Hub-Token: $(cat ~/.claude/hub-token)"`로 등록
- [ ] 각 저장소의 Task Master MCP 설정 끄기

완료 기준: 실제 세션에서 "LK의 열린 task 보여줘"에 hub 도구로 답하고, `update_task_status`가 DB에 반영된다.

### M4. runner (L)

- [x] `runs`, `run_logs` 엔티티
- [x] worktree 매니저: 생성, 앱별 `setup_cmd` 실행, 정리
- [x] 실행기: spawn, stream-json 파서, `session_id` 저장, 실행 중 `caffeinate`
- [x] pg-boss 큐: 동시 실행 2개, 중지(SIGINT)
- [x] 결과 판정: 완료 / 질문 / 실패
- [x] 답변 → `--resume` 재실행
- [x] 완료 시 커밋 확인, `gh pr create`, task를 `review`로
- [x] WebSocket `run.log`, `run.status`

완료 기준: `POST /api/tasks/:id/run` 하나로 PR까지 생기고, 질문으로 끝난 run에 답하면 같은 세션으로 이어진다.

### M5. 아이디어·규칙 (M)

- [x] `ideas`, `idea_versions`, `rules` 엔티티
- [x] 생성 run: 읽기 전용 권한, JSON 스키마 출력 → 기획 `pending`
- [x] 앱별 cron 등록 (pg-boss schedule)
- [x] 승인(task 생성), 수정 요청(새 버전), 반려(사유를 다음 생성 프롬프트에 포함)
- [x] `PUT /api/rules` → `~/.claude/rules/hub-rules.md` 원자적 쓰기

완료 기준: 즉시 생성으로 기획 1건이 생기고, 승인하면 task가 생겨 바로 실행할 수 있다.

### M6. 상주·마무리 (S)

- [x] launchd LaunchAgent 등록, 로그 파일 `~/Library/Logs/hub/`
- [x] run별 비용 기록과 월 합계 API
- [x] `pg_dump` 일일 백업

완료 기준: 재부팅 후 Hub가 자동으로 떠 있고, 새 세션에 `[Hub context]`가 들어간다.

### M7. 새 앱 기획과 시작 (M)

뼈대 이후에 더한 단계다. 저장소가 없는 새 앱을 구상해 제안하고, 승인하면 폴더와 GitHub 저장소를 만들어 Claude 세션으로 작업을 시작한다.

- [x] `ideas.kind`, `ideas.app_id` nullable, `hub_settings` 마이그레이션
- [x] 새 앱 기획 run: `~/.hub/ideation`에서 `Read,Grep,Glob,WebSearch,WebFetch`(웹 조사 항상 포함), 출력 스키마에 대상 사용자·비슷한 서비스·시장·수익 모델·기술 스택·제안 앱 코드와 폴더·다른 후보 2\~4개
- [x] 다른 후보 깊게 쓰기, 수정 요청, 반려, 전역 자동 생성 주기(`ideation.cron`, 사용량 80% 기준 공유)
- [x] 승인: 앱 등록과 task·명세 생성 → bootstrap run
- [x] bootstrap: `~/project/<폴더>` → `git init`, README·CLAUDE.md·`docs/concept.md` 첫 커밋 → `gh repo create --private --push` → 작업 공간 신뢰 등록 → `claude --bg --rc`
- [x] 세션을 못 띄우면 runner로 첫 task를 대신 시작, 다시 돌리기 API
- [x] MCP `submit_idea`에서 앱 없이 새 앱 기획 제출
- [x] 실제 기획 1건(#2 벌금통)을 승인해 GitHub 비공개 저장소와 `--rc` 세션이 뜨는지 확인. 세션이 Design 아티팩트 도구로 UI 시안을 시작했다

완료 기준: 새 앱 기획을 승인하면 GitHub 비공개 저장소가 생기고, claude.ai나 Claude 앱에서 그 앱의 세션을 이어서 볼 수 있다.

**새 앱 시작 흐름 (bootstrap)**

1. 승인 요청에서 앱(코드, 이름, `~/project/<폴더>`)을 등록하고 기획을 승인해 task와 명세를 만든다. 폴더가 이미 있거나 코드가 겹치면 거부한다.
2. 폴더를 만들고 `git init -b main`, README·CLAUDE.md·`docs/concept.md`로 첫 커밋을 한다.
3. `gh repo create <폴더> --private --source . --remote origin --push`. 빈 저장소라 첫 커밋만은 Hub가 main에 올린다. 같은 이름의 저장소가 이미 있으면 덮어쓰지 않고 실패한다.
4. 백그라운드 세션은 신뢰하지 않은 폴더에서 시작을 거부하므로, Hub가 방금 만든 폴더만 `~/.claude.json`의 신뢰 목록에 올린다. 다른 Claude 프로세스도 이 파일을 쓰므로 쓰기 직전에 다시 읽고 임시 파일 + rename으로 바꾼다.
5. `claude "<첫 메시지>" --bg --rc "<코드> <이름>" --permission-mode auto --allowedTools <기본 + hub/ 브랜치 push, gh pr create, update_task_status>`. 권한 모드는 설정 `ideation.sessionPermissionMode`(기본 `auto`, 또는 `acceptEdits`)를 따른다. `auto`는 허락이 필요한 명령을 분류기가 대신 판단해 세션이 질문으로 멈추지 않는다. hub MCP가 사용자 범위로 등록되어 있지 않으면 이 세션에만 `--mcp-config`로 붙인다.
6. 첫 메시지 순서: 기획 읽기 → UI 디자인(Design 아티팩트, 없으면 `docs/design/` HTML 시안)을 만들고 확인받기 → 첫 task를 `hub/` 브랜치에서 구현 → 테스트, push, PR → 다음 task로 갈지 묻기.
7. 2\~5 중 실패한 단계가 있으면 run이 실패로 끝나고, `POST /api/apps/:id/bootstrap`으로 다시 돌린다. 이미 끝난 단계는 건너뛴다. 세션만 못 띄웠으면 runner로 첫 task를 대신 시작한다.

### M8. 통합 관리 확장 (L)

뼈대 이후에 더한 단계다. 자세한 내용은 `docs/Hub 통합 관리 확장 계획서.md`에 있다.

- [x] task 확장: 종류, 담당, 우선순위, 기한, 단계, 저장소. 내 할 일 상태 흐름
- [x] 앱 확장: 소개, 링크, 스택, 진행 상태, 앱별 단계, push 전 검사 명령, worktree 위치
- [x] 저장소 목록과 runner의 저장소 선택 (HR·CM 실행 결함 해결)
- [x] 히스토리와 과거 기록 옮기기, 배포 기록, 앱 개요·상태 API, Hub 밖 세션 상태
- [x] GitHub 연동: 배포 기록·Actions 5분마다, PR 머지 → task done
- [x] 대시보드 비밀번호 로그인, Task Master 미리 보기·덮어쓰기, 기획 예상 비용·바뀐 점 요약
- [x] MCP 도구 4개 추가 (모두 12개)

## 먼저 검증할 것

문서로 확인한 동작과 실제 맥북 동작이 다를 수 있는 6가지를 작은 실험으로 먼저 확인한다. 1\~3번은 M2 전에, 나머지는 해당 단계를 시작할 때 한다.

| # | 검증할 것 | 왜 필요한가 | 방법과 안 될 때 대안 |
| --- | --- | --- | --- |
| 1 | `--output-format stream-json`과 `--json-schema`를 같이 쓰면 마지막 `result`에 구조화된 출력이 오는가 | run이 완료인지 질문인지 판정하는 근거 | 작은 저장소에서 1회 실행. 안 되면 프롬프트에 "마지막 줄에 `HUB_STATUS: done` 또는 `needs_input`" 규약을 넣는다 |
| 2 | hook 프로세스가 `claude`를 띄울 때 준 `HUB_TASK_ID`를 받는가 | 세션과 task 연결 | 환경변수를 주고 `[Hub context]`에 task가 찍히는지 본다. 안 되면 `session_id`로 Hub가 연결한다 |
| 3 | `claude -p`가 맥북 로그인 계정으로 연속 실행되는가, 사용량 한도는 어떻게 보이는가 | 자동 실행이 가능한지 | 3회 연속 실행. 한도 메시지 형식을 기록해 run 실패 사유로 분류한다 |
| 4 | `--resume`으로 이어갈 때 SessionStart가 `source=resume`으로 다시 불리는가 | 답변 후 재개할 때 맥락 유지 | 질문으로 끝난 세션을 재개해 hook 로그를 본다 |
| 5 | worktree마다 의존성 설치에 걸리는 시간 (Flutter, pnpm) | 동시 실행 수와 디스크 | 앱별로 측정해 `setup_cmd`와 캐시 방식을 정한다 |
| 6 | MCP Streamable HTTP를 Nest(express) 안에 붙일 수 있는가 | 프로세스 하나로 운영 | 도구 1개로 연결 확인. 안 되면 같은 프로세스에서 포트만 따로 연다 |

## 보안·운영, 열린 결정과 리스크

Hub는 맥북에서 Claude에게 코드를 고치게 하는 서버라, 입구를 좁히고 실행 범위를 등록된 저장소로 묶는 게 가장 중요하다.

**보안**

- `127.0.0.1`에만 바인딩하고, 모든 API와 MCP에 토큰을 요구한다.
- runner는 `apps`에 등록된 저장소에서만 돈다. 임의 셸 명령을 받는 API는 만들지 않는다.
- 권한 모드는 `acceptEdits`와 앱별 허용 도구 목록으로 둔다. 권한 확인을 통째로 끄는 모드는 쓰지 않는다.
- main 보호는 deny 규칙과 GitHub 브랜치 보호를 같이 건다.
- `run_logs`와 `session_events`에 비밀값이 남지 않게 토큰·키 패턴을 가려서 저장한다.

**운영**

- launchd로 로그인 시 자동 시작하고, 로그는 `~/Library/Logs/hub/`에 남긴다.
- 맥북이 잠들면 예약 작업이 멈추고, 깨어난 뒤 pg-boss가 밀린 작업을 처리한다. 실행 중에는 `caffeinate`로 잠자기를 막는다.
- 매일 `pg_dump`로 백업한다.

**열린 결정**

| 결정 | 기본안 | 대안 | 언제 정하나 |
| --- | --- | --- | --- |
| DB | PostgreSQL (Docker) | SQLite: Docker 없이 파일 하나 | M0 시작 전 |
| 실행기 | `claude -p` CLI | Agent SDK: `canUseTool`로 권한 요청 처리가 쉬움 | 검증 1·3 결과를 보고 |
| 큐 | pg-boss | BullMQ + Redis | M4 시작 전 |
| 대시보드 인증 | 토큰을 쿠키로 | Tailscale로 밖에서 접속할 때 별도 로그인 | UI 계획 때 |

**리스크**

- 구독 사용량 한도에 걸리면 자동 생성과 실행이 막힌다. 하루 실행 수와 월 한도를 설정으로 두고, 한도의 80%에서 자동 생성을 멈춘다.
- 동시 실행과 worktree가 맥북 CPU와 디스크를 잡아먹는다. 동시 실행은 2개로 시작하고, 머지된 worktree는 바로 정리한다.
- Claude Code 업데이트로 stream-json 형식이 바뀔 수 있다. 파서는 모르는 이벤트를 무시하고, 원본은 `raw`에 남긴다.
- 새 앱 시작은 Claude Code 내부 파일(`~/.claude.json`)의 신뢰 항목을 직접 쓴다. 형식이 바뀌면 `--rc` 세션이 뜨지 않을 수 있어, 그때는 runner로 대신 시작한다.
- UI 디자인(Design 아티팩트)은 공개 API가 없어 `claude -p`로는 만들 수 없다. 대화형인 `--rc` 세션에서 만들게 하고, 도구가 없으면 HTML 시안 파일로 대신한다.
