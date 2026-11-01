# Hub 인수인계: 대시보드 구현 (W1~W6)

Oct 28, 2026 · @suman

다음 세션은 이 문서부터 읽는다. 서버(M0~M8)는 끝나서 실제 Hub에 반영되어 있다. 남은 큰 일은 대시보드 화면(`apps/web`)이다.

## 진행 기록 (Oct 29, 2026 세션)

- **task 100% 강제 (사용자 승인, 제안 1~5)**: 이 맥북의 Claude Code 세션은 진행 중인 Hub task 없이 수정할 수 없다.
  - 세션–task 연결: `update_task_status`의 PostToolUse 기록(`/api/hooks/event`)을 보고 DB의 task 상태가 doing·input이면 `sessions.task_id`에 연결, review·done·cancelled면 푼다. 응답 본문이 아니라 DB 상태를 보므로 거부된 전이는 연결을 바꾸지 않는다. 스키마 변경 없음.
  - 가드 판정(`pre-tool-use`): Bash·Edit·Write·MultiEdit·NotebookEdit만 본다. `task`·`run` 쿼리나 run에 묶인 세션은 통과. 가드가 켜진 앱은 연결된 task가 지금도 doing·input이어야 통과. 앱이 없는 폴더는 `projectRoot` 안이면 막고 밖이면 통과.
  - 마이그레이션 `GuardByDefault`: `guard_enabled` 기본값 true, 기존 앱 모두 켬.
  - 앱 판별(`matchAppByPath`)에 앱 폴더(`repo_path`) 기준을 더했다. OA는 `folder_names`가 `today-alba`라 `daily-work` 폴더가 인식되지 않던 문제가 함께 풀린다.
  - `[Hub context]`에 막히는 이유와 푸는 방법을 한 줄 넣는다(가드가 켜진 앱에서 진행 중 task가 없을 때, 등록 안 된 프로젝트 폴더일 때).
  - `hub-hook.sh`: `HUB_RUN_ID`를 `run` 쿼리로 보내고(아이디어 생성 run도 통과), `HUB_GUARD=off`면 pre-tool-use를 묻지 않는다. 전역 PreToolUse matcher에 `Bash`를 더했다(`settings.hub.json`, `~/.claude/settings.json`).
  - Hub가 꺼져 있으면 통과(사용자 선택, 규칙 6번과 맞춤). claude-hub 폴더는 Hub 앱으로 등록하기로 했다(사용자 선택).
  - 알아 둘 것: review → doing 전이가 없어서, 리뷰로 넘긴 뒤 같은 세션에서 PR을 고치려면 새 task를 만들어 doing으로 바꿔야 한다. 하위 에이전트의 도구 호출도 같은 세션 id로 판정된다고 보고 만들었다(직접 확인은 못 함).
- **앱 페이지 개발 탭 검색**: 태스크 보드와 같은 검색(#ID, 제목)을 붙였다. 거르는 규칙은 `Board.tsx`의 `searchNeedle`·`matchesSearch`를 같이 쓴다.
- task 상세 패널에 만든 시각·마지막 변경을 보이고, 부제를 "Hub · 프로젝트 관리"로 바꿨다.
- **claude-hub도 Hub 앱 HB로 등록**(사용자가 등록). 이 저장소 작업도 HB task로 진행한다(HB-1 가드, HB-2 검색, HB-3 문서·디자인 탭, HB-4 실패 run).
- **다시 실행해서 완료된 실패 run 숨기기 (HB-4)**: `GET /api/runs`의 실패·중지 run에 `resolvedBy`(같은 대상을 다시 실행해 완료한 run id)를 붙인다. 대상 기준은 `run.entity.ts`의 `runTarget`(화면의 "다시 실행"과 같은 기준). 실행 기록의 실패·중지 칩과 오늘 화면·사이드바 배지에서 뺀다. 전체 목록에는 "다시 실행해 완료 (run N)"로 남긴다.
- **앱 페이지 문서·디자인 탭 (HB-3)**: 앱 폴더와 등록된 저장소마다의 `docs/`(문서 탭), `design/`(디자인 탭)을 보여 준다(`screens/AppDocs.tsx`, `modules/files`).
  - `GET /api/apps/:id/files`: md·txt·html·이미지·pdf만 목록에 넣는다. 숨김·`node_modules`·심볼릭 링크는 건너뛰고, 루트의 폴더마다 1,500개까지.
  - 파일은 `GET /view/<서명>/<docs|design>/…`로 연다. 로그인 쿠키가 `SameSite=Strict`라 격리된 iframe에서는 쿠키로 `support.js` 같은 파일을 받을 수 없어서, Hub 토큰으로 서명한 임시 주소(6시간 단위로 같은 값, 6~12시간 유효)를 쓴다.
    - 응답에 `CSP: sandbox allow-scripts …`(PDF 제외), `Referrer-Policy: no-referrer`(외부 글꼴 요청에 주소가 실려 나가지 않게), `Access-Control-Allow-Origin: *`(sandbox 페이지가 같은 폴더를 fetch)를 붙인다.
    - docs/·design/ 밖, 숨김 파일, 루트 밖 심볼릭 링크는 거부한다.
  - 화면: md는 Hub 안에서 렌더링하고, HTML은 `sandbox`(allow-same-origin 없음) iframe으로 미리 보며, 이미지는 그대로 보여 준다. md 렌더러(`lib/md.tsx`)에 표·인용·구분선·제목 단계·HTML 주석 숨기기를 더했다(task 패널의 "형식 확인 필요 · 표" 경고는 뺐다).
  - 개발용 Hub(2425)에서 Lune·AI채팅으로 확인했다. 디자인 시안은 support.js와 외부 글꼴까지 그려진다.
- **Hub 문서를 프로젝트에도 저장 (사용자 선택 B)**: `save_spec`(과 기획 승인 때 만드는 명세)은 DB에 더해 앱 폴더의 `docs/hub/<번호 4자리>-<제목>.md`에 사본을 쓴다(`knowledge/spec-file.ts`). 같은 번호의 예전 파일은 지운다. 앱이 없는 문서(새 앱 기획)는 쓰지 않는다. 기존 문서 2·3·4번은 같은 함수로 한 번 써 두었다(FJ, LU, HB 저장소에 커밋 안 된 파일로 있음).
- 규칙 `hub.md`에 "프로젝트 문서는 docs/, 디자인은 design/" 절을 더했다(`~/.claude/rules/hub.md`에도 반영).
- **앱 페이지 세션 탭 (HB-5)**: 이 앱의 Claude 세션을 열린 세션과 지난 세션(7일)으로 보여 준다(`screens/AppSessions.tsx`, `GET /api/apps/:id/claude-sessions`).
  - 세션마다 진행 중인 task, 시작한 쪽("내가 시작 · 터미널/백그라운드", "Hub가 시작 · 구현/기획 생성/새 앱 세션 run N"), 상태, 마지막 메시지·도구 기록을 보여 준다. 탭 옆 숫자는 열린 세션 수다. task 패널에는 "이 task를 진행 중인 세션"이 뜬다.
  - 상태는 hook 기록으로 짐작한다(`sessionState`). 마지막 기록이 Stop·SessionStart면 입력 대기, 메시지·도구면 일하는 중, 그 뒤 30분 넘게 조용하면 소식 없음, SessionEnd면 끝남이다. claude -p run은 run이 끝나면 끝남으로 본다. Notification hook은 Hub로 보내지 않아서 허락 대기는 백그라운드 세션(claude agents)만 보인다.
  - 백그라운드 세션(claude agents 목록)과 같은 세션이면 원격 조종 링크와 "Hub에서 보기"를 붙인다.
  - 고친 것 두 가지
    - Hub가 띄운 백그라운드 세션(HUB_RUN_ID)이 "내가 시작"(local)으로 기록되던 것을 hub로 기록한다.
    - 앱 등록 전에 시작한 세션은 등록 뒤 처음 오는 기록에서 앱을 채운다. 이 저장소의 예전 세션 4개는 SQL로 HB를 채웠다.
  - 실시간 명령(대시보드 터미널, 메시지 끼워 넣기)은 2단계로 남겼다. 사용자 확인 전이다.
- **세션 대화 보기 (HB-6)**: 세션을 누르면 오른쪽 패널(`?session=<id>`, `components/SessionPanel.tsx`)에 대화가 채팅 화면으로 열린다. task 패널과 같은 자리라 하나를 열면 다른 하나는 닫힌다.
  - `GET /api/sessions/:id/chat?limit=`: hook 입력의 `transcript_path`(없으면 `~/.claude/projects/*/<세션id>.jsonl`)를 읽어 대화 줄(`ChatItem`)로 바꾼다(`sessions/transcript.ts`). `~/.claude/projects` 밖의 파일은 읽지 않는다.
  - 파일은 끝에 줄만 붙으므로 읽은 위치(바이트)를 기억해 새로 붙은 부분만 읽는다. 쓰는 중인 마지막 줄은 Buffer로 들고 있다가 다음에 잇는다. 파일 20개까지 메모리에 둔다.
  - 남기는 것: 사람 메시지(문자열 user 줄, 작업 중에 보낸 메시지 = `queued_command` 첨부 중 origin human), 슬래시 명령(가운데 줄), Claude 답변, 도구 사용과 결과. 빼는 것: 생각, 하위 에이전트, 메타 줄, 백그라운드 알림, 시스템 첨부. 비밀값은 `redactText`로 가린다.
  - Hub가 띄운 세션의 사람 메시지는 "Hub 지시" 카드(접힘)로 보인다. hook 이벤트마다 `['sessions']`가 무효화되어 거의 실시간으로 따라간다.
- **실행 상세도 같은 대화 화면 (HB-7)**: run 로그를 대화 줄로 바꿔(`runChat`) `components/Chat.tsx`의 `ChatView`로 보여 준다. 도구 결과는 결과가 아직 없는 첫 도구에 순서대로 붙이고, hub·system·결과·한도 줄은 가운데 안내, 보낸 답변은 보낸 시각 자리에 내 말풍선으로 넣는다.
- **사이드바 "세션" 메뉴 (HB-8)**: "오늘" 아래 `/sessions`. 모든 프로젝트의 열린·지난 세션(7일)을 보여 주고, 앱 칩을 누르면 그 프로젝트 세션만 보인다(`GET /api/sessions`, 앱 거르기는 화면에서). 뱃지는 열린 세션 수다. 모바일 하단 탭은 그대로(오늘·보드·기획·실행)이고 세션은 더보기 시트에 있다.
  - 세션 목록 쿼리는 `SessionsService.views()` 하나로 앱 탭·세션 메뉴·대화 패널 머리가 같이 쓴다. 마지막 메시지에서 `<task-notification>`은 뺀다.
- **대화 패널 입력창 (HB-9, HB-10, 사용자 승인)**: `SessionPanel.tsx`의 `Composer`. 세션 상태에 따라 동작이 다르다.
  - **열린 세션 → 메시지 보내기 (HB-10)**
    - 새 표 `session_messages`(마이그레이션 `SessionMessages`). `POST /api/sessions/:id/messages`로 쌓는다. 끝난 세션은 409.
    - 그 세션의 다음 hook 응답에 실어 보낸다: PostToolUse·UserPromptSubmit는 `additionalContext`, Stop은 `decision: block`(이어서 일하게).
    - `UPDATE … RETURNING`으로 꺼내 한 번만 전달한다. 하위 에이전트(`agent_id`) hook에는 싣지 않는다.
    - 전달문은 `[Hub 메시지 #n]`로 시작한다. 대화 화면은 대화 기록의 이 줄을 빼고 DB 메시지를 "Hub에서 보냄 · 전달 대기/전달됨"으로 보여 준다.
    - 실제 Hub에서 이 세션에 시험 메시지(#1)를 넣어, 다음 도구 사용 때 Claude Code가 받는 것을 확인했다.
  - **끝난 세션(또는 터미널을 닫았다고 확인한 세션) → 이어서 하기 (HB-9)**
    - `POST /api/sessions/:id/resume {message, taskId?, force?}`가 새 run 종류 `session`을 만든다. `runs.kind`는 문자열이라 스키마 변경은 없다.
    - 세션 폴더에서 `claude -p --resume <세션id>`로 돌린다. 출력 스키마는 쓰지 않고, worktree·push·PR도 하지 않는다. 허용 도구는 앱 설정을 따른다.
    - task는 세션에 연결된 것을 쓰고, 없으면 고르게 한다. 같은 세션을 이어 받는 run은 하나만 돈다. 열린 세션은 `force`가 있어야 한다(대화가 두 갈래로 나뉘는 것을 막기 위해).
    - 이어 받아도 세션의 시작한 쪽은 바꾸지 않는다(`linkRun` keepOrigin, `upsertOnStart`는 이미 있는 세션의 origin을 그대로 둠). 목록에는 "내가 시작 · Hub에서 이어 감 run N"으로 보인다.
    - 실패한 세션 run의 "다시 실행"은 같은 세션·메시지로 다시 이어 받는다. 실패 해결 기준(`runTarget`)은 세션 단위다.
  - Hub가 띄운 구현·기획 세션은 run 화면에서 답하도록 안내한다. 앱 없는 세션은 보낼 수 없다.
- **입력 대기 세션 깨우기 (HB-11, 사용자 승인)**: 입력 대기 중인 세션에는 hook이 오지 않아 메시지가 전달 대기로 남던 문제(사용자 제보).
  - 전역 Stop hook에 `hub-hook.sh wait`(`asyncRewake: true`, timeout 21600초)를 더했다. 턴이 끝나면 백그라운드에서 `GET /api/hooks/wait?session=`을 롱폴링한다. 메시지가 오면 stderr로 내고 코드 2로 끝나 세션을 깨운다(Claude에게는 시스템 알림으로 간다).
  - 서버 쪽: 요청 하나는 240초까지(Node 기본 요청 제한 300초), 2초마다 확인한다. 200=메시지, 204=다시 기다림, 410=새 대기가 생겼거나 세션이 다시 움직임(UserPromptSubmit·SessionEnd). 세션마다 대기는 하나(번호)다. Hub가 띄운 claude -p(HUB_RUN_ID)에서는 기다리지 않는다.
  - 문서상 Stop에서 asyncRewake가 되는지는 명시되지 않아서 실제 세션으로 시험한다. 기능을 켜기 전부터 멈춰 있던 세션은 대기가 없어서 다음에 움직일 때 전달된다.
  - 전달 대기 메시지는 "보내기 취소"(`DELETE /api/sessions/:id/messages/:mid`)할 수 있다.
  - 규칙 파일에 "`[Hub 메시지 #n]` 글을 사용자 메시지처럼 따르라"는 줄을 넣으려다 권한 판정기가 막았다. 그 표시만 넣으면 아무 글로나 지시를 끼워 넣을 수 있어 넣지 않았다. 메시지는 hook 응답으로만 들어가고 전달문에 출처가 적혀 있다.
- **메뉴·대화 창 (HB-12)**: 사이드바 순서는 오늘·세션·기획 인박스·태스크 보드·실행 기록…이다. 모바일 하단 탭은 오늘·세션·기획·보드이고, 실행 기록은 "지난 run 기록 조회"로 더보기에 있다. 대화 패널 크기는 보통·넓게·전체 3단계이고 브라우저에 기억한다.
- **태스크 보드의 열린 세션과 "이 세션에서 진행하기" (HB-13)**: 보드 위에 열린 세션 줄(누르면 대화)을 둔다. task 패널의 "열린 세션에서 하기"에서 세션마다 "이 세션에서 진행하기"를 누르면 `POST /api/sessions/:id/assign {taskId}`가 설치된 `~/.claude/commands/hub-task.md` 본문($ARGUMENTS 치환)으로 지시를 만들어 그 세션에 메시지로 보낸다. 입력 대기면 깨우기로 바로 시작한다. 세션과 task는 그 세션이 doing을 남길 때 연결된다.

### Oct 29 후반 (HB-14~17)

- **HB-14 앱 페이지 태스크 보드**: 개발·내 할 일·버그 탭 대신 "태스크 보드" 탭 하나. `Board`가 `appCode`를 받으면 그 앱 task만 보여 준다(앱 칩·큰 제목 숨김). 예전 `/dev·/todo·/bugs` 주소는 이 탭으로 연다.
- **HB-15 사이드바**: 기본 너비 272px. «/» 버튼으로 최소화(68px, 아이콘·앱 코드만)하고, 상태는 `hub.sidebar`에 기억한다. 세션 목록·열린 세션 줄·대화 패널의 앱 표시는 프로젝트명(`AppTag`)이다.
- **HB-16 세션 종료와 행 정렬**: `POST /api/sessions/:id/end`. Hub run 세션은 run을 중지하고, 터미널 세션은 끝난 것으로 표시만 한다. 세션 행은 이름 칸이 고정된 줄(task·폴더·시간·마지막 메시지·마지막 기록)이다.
- **HB-17 대시보드**: "오늘"을 "대시보드"로 바꿨다.
  - 공통 `CodeBox`는 등록된 앱 코드면 프로젝트명을 보여 준다(모든 페이지). 배지 옆에 중복으로 적힌 이름 문구는 뺐다. 앱 페이지 머리와 사이드바 앱 목록은 코드를 그대로 둔다.
  - 대시보드 구성(`screens/DashboardSections.tsx`): 지금 도는 것(열린 세션+실행 중 run) → 내가 답해야 할 것(run 질문, 대기 세션, task가 답변 대기인 세션) → 프로젝트 현황 카드 → 오늘의 흐름(끝난 task·머지 PR·배포·비용) → 처리할 일(기존 카드들). 상단 숫자 카드는 없앴다.
- **남은 일**
  - HB-11 깨우기 재시험: Stop asyncRewake 대기 hook이 이 세션에서는 돌지 않았다. 새로 연 세션에서 다시 시험하고, 안 되면 다른 이벤트로 바꾼다.
  - 커밋·PR: HB-1~17 전부 아직 커밋이 없다.

## 진행 기록 (Oct 28, 2026 세션)

- **W1~W6 화면을 모두 옮겼다.** 실제 Hub(launchd, 2424)에 반영해 `http://127.0.0.1:2424`에서 열린다. 서버 테스트 150개 통과, web 타입 검사·빌드 통과.
  - W1 뼈대·로그인·사이드바·WebSocket, W2 앱 페이지(머리·개요·설정 탭)·앱 관리·앱 등록 창, W3 오늘·태스크 보드·task 상세 패널·task 추가 창, W4 기획 인박스·기획 생성 창 2개·새 앱 승인 창(2단계), W5 실행 기록·실행 상세(시작 진행 화면 포함)·새 앱 세션, W6 규칙·비용·명령 팔레트·Hub 꺼짐 화면.
- **서버에 더한 것** (모두 읽기용이거나 이미 있는 데이터를 여는 것)
  - `GET /api/usage`, `GET /api/runs?status=&app=&kind=&latest=&limit=`(목록 행에 `appCode`, `taskTitle`, `taskStatus`), `GET /api/runs/:id/logs?tail=`
  - `GET /api/mistakes?app=`, `PATCH /api/mistakes/:id {active}`, `GET /api/specs?task=&idea=`, `GET /api/specs/:id`, `GET /api/settings/defaults`
  - `GET /api/project-candidates`(새 앱 폴더 위치, 기본 `~/project` 바로 아래의 git 프로젝트와 저장소별 GitHub 원격·기본 브랜치·등록된 앱). 앱 등록 창의 "프로젝트 폴더" 선택에 쓴다.
  - `DELETE /api/apps/:id`(앱 설정 탭 맨 아래 "앱 삭제", 앱 코드를 입력해야 지운다). task를 먼저 지우고 앱을 지워 저장소 목록·기획·배포 기록·히스토리·규칙·실수 기록이 함께 지워진다. run은 남기고, 규칙 파일을 다시 쓰고, 자동 생성 schedule을 내린다. 진행 중인 run이 있으면 409. 로컬 폴더와 GitHub 저장소는 건드리지 않는다.
  - 저장소 DTO에 `checkCmd`. `RunResult`·`RunKind`는 `@hub/shared`로 옮겼다.
  - Nest가 `apps/web/dist`를 `/`에서 내보내고, 서버 경로(`/api`, `/mcp`, `/ws`, `/health`)가 아니면 `index.html`로 보낸다(`HUB_WEB_DIST`로 바꿀 수 있음).
- **정한 것**
  - task 목록은 서버에서 자르지 않는다(전체 840KB, 30ms). 완료·취소는 화면에서 접고 최근 것만 보여 준다. 처음 계획의 `limit`은 넣지 않았다.
  - 앱 페이지의 개발·내 할 일·버그·단계·배포·히스토리·기획 탭은 시안이 없어 `docs/Hub 대시보드 v4 수정 요청.md` 2-2~2-7 명세대로 기존 화면 모양으로 만들었다(`screens/AppTabs.tsx`, `screens/AppStageHistory.tsx`). 시안이 오면 맞춘다. 내 할 일의 "만든 사람"(직접/Claude)과 배포 규칙의 "짐작한 값" 표시는 서버에 값이 없어 뺐다.
  - 앱 설정 탭에는 시안 칸에 더해 서버에 있는 값(소개·기술 스택·링크, 단계 편집, 저장소와 배포 워크플로 규칙, task 없는 세션 막기, 실수 기록 목록)을 같은 모양으로 붙였다.
  - task 추가 창과 상세 패널에 종류·담당·우선순위·기한·단계·저장소·버그 칸을 붙였다(서버에 있는 값). 저장소가 여러 개인 앱은 패널에서 저장소를 고른다.
  - 기능 기획 즉시 생성은 서버가 메모를 받지 않아서, 창에서 앱의 방향성 메모를 읽기 전용으로 보여 준다.
  - 질문 빠른 답 선택지는 없다(직접 입력만). 알림 띠 "계속"은 이 브라우저에서 14일 동안 닫아 둔다.
  - 초기화 시각이 지난 사용량 창은 0으로 보여 준다.
  - 경로 입력은 `~/`를 받아 다른 앱 경로에서 홈을 빌려 절대 경로로 바꾼다(`lib/paths.ts`).
  - 오늘 화면의 "운영 배포 실패", "기한 지난 내 할 일" 칸(처리할 일 수에 들어감)과 보드의 종류·담당 필터도 명세대로 더했다.
- **메뉴 정리 (사용자 요청)**: "앱 관리"를 없애고 "프로젝트 기획 생성"(`/new-app`, `screens/NewApp.tsx`)으로 바꿨다. 화면에는 "기획부터 시작"(새 앱 기획 생성을 바로 돌림)과 새 앱 기획 설정이 있다. 만들어 둔 프로젝트 등록은 사이드바 "앱" 머리의 + 버튼(모바일은 더보기 시트)에서 여는 창이다. `/apps`는 `/new-app`으로 보낸다. task 상세 패널 너비는 `min(720px, 62vw)`.
- **열린 세션에서 task 실행 (사용자 요청, 1안)**: 터미널에서 연 프로젝트 세션이 Hub task를 직접 진행한다. Hub가 세션에 메시지를 넣을 공식 방법이 없어서, 세션이 가져가는 방식이다.
  - `/hub-task <ID>` 명령: `docs/claude-hub-setup/commands/hub-task.md` → `~/.claude/commands/hub-task.md`에 설치. task 읽기 → doing → `hub/` 브랜치 작업·테스트 → PR → review(+`pr_url`).
  - MCP `update_task_status`에 `pr_url`, `branch`를 더했다. PR 주소가 있어야 머지될 때 GitHub 동기화가 task를 완료로 바꾼다.
  - `GET /api/apps/:id/open-sessions`: hook 기록 중 끝나지 않았고 3일 안에 활동이 있는 세션. task 패널의 "열린 세션에서 하기"에서 명령을 복사한다.
  - 세션 실행은 Hub run이 아니라서 실행 비용이 run으로 남지 않고, worktree 대신 세션 폴더에서 브랜치만 나눠 작업한다.
- **아직 안 한 것**: `j`/`k` 목록 이동 단축키, 디자인 토큰 화면(시안의 "토큰" 버튼), 단계 끌어서 순서 바꾸기(지금은 ↑↓ 버튼).
- **개발 방법**: 실제 DB를 복사한 `hub_dev`로 개발용 Hub를 2425에 띄우고(`HUB_PORT=2425 HUB_TOKEN=dev-token HUB_DATABASE_URL=…/hub_dev`, `HUB_CLAUDE_BIN`·`HUB_GH_BIN`은 `apps/server/test/fixtures`의 가짜, `HUB_GITHUB_SYNC=0`, `HUB_CLAUDE_HOME`·`HUB_HOME`은 임시 폴더), `cd apps/web && HUB_URL=http://127.0.0.1:2425 npx vite`로 본다. 개발용 Hub도 실제 저장소 경로를 가리키므로 task "실행"은 누르지 않는다(브랜치가 실제 GitHub로 push될 수 있다). 끝나면 `hub_dev`를 지운다.

## 지금 상태

- **Hub 서버**: launchd로 상주 중이다(`http://127.0.0.1:2424`).
  - 코드를 바꾼 뒤에는 `pnpm hub:install`로 빌드하고 재시작한다.
  - 테스트는 `cd apps/server && npx jest` (Oct 29 기준 162개 통과).
  - DB 백업은 매일 `~/.hub/backups/`에 남는다.
- **Claude Code 연결**: hook과 Hub MCP(도구 12개)가 사용자 범위에 설치되어 있다. 새 세션은 `[Hub context]`를 받고, task를 등록하거나 갱신할 수 있다.
- **`apps/web`**: (Oct 28 세션 전 기준) 뼈대만 있었다. 지금은 위 진행 기록 참고.
  - 있는 것: `package.json`(React 18 + Vite 5 + react-router 6 + TanStack Query 5), `vite.config.ts`(개발 중 `/api`·`/ws`를 2424로 프록시), `index.html`(IBM Plex 글꼴), `src/styles/tokens.css`(v4 디자인 토큰 원본).
  - 의존성은 설치되어 있다. 화면 코드(`src/main.tsx` 등)는 아직 없다.
- **git**: 커밋을 한 번도 하지 않았다. 사용자가 요청하면 커밋한다.

## 정한 진행 방식

- **화면 모양은 디자인 파일을 따른다.**
  - 앱 페이지(머리, 개요, 설정 탭), 사이드바, 앱 관리: `design/Hub Dashboard v4.dc.html`
  - 나머지 화면(오늘, 태스크 보드, 기획 인박스, 실행 기록·상세, 새 앱 세션, 규칙, 비용, 로그인, task 상세·추가 창, 명령 팔레트): v4 안에 v3 화면이 그대로 들어 있다.
  - 앱 페이지의 나머지 6개 탭(개발, 내 할 일, 버그, 단계·배포, 히스토리, 기획)은 디자인 에이전트가 다음 시안에서 채운다. 요청서는 `docs/Hub 대시보드 v4 수정 요청.md`.
- **동작과 옵션은 서버가 정본이다.** 서버에 없는 기능이나 서버와 맞지 않는 옵션은 서버를 따른다. 지금 알려진 차이:
  - **task 상태 전이**: 시안은 "진행 중 → 할 일", "리뷰 → 진행 중"을 허용한다. 서버 규칙(`packages/shared/src/status.ts`의 `canTransitionTask(from, to, assignee)`)을 쓴다. Claude task와 내 할 일의 규칙이 다르다.
  - **질문 빠른 답 선택지**: 서버에 없다. 직접 입력만 둔다.
  - **알림 띠 "계속"**: 서버가 기억하지 않는다. 화면(localStorage)에서만 닫는다.
  - **사용량 기준 문구**: 서버는 5시간·7일 중 하나라도 80%면 자동 생성을 건너뛴다.
  - **허용 도구 문구**: push와 PR은 Hub가 직접 한다(Claude에게 push 권한이 없다).
  - **실수 기록 문구**: 세션에서 지적받은 실수(`record_mistake`)이고, 켜 둔 것만 새 세션 맥락에 들어간다.
  - **새 앱 세션 화면의 활동·터미널 탭**: 서버에 스트림이 없다. 상태, 허락 대기 명령, 원격 조종 링크, `claude attach` 명령만 보여 준다(`GET /api/apps/:id/sessions`). 터미널 실시간 보기는 기술 검토만 끝났다(attach를 pty로 띄워 xterm.js로 보내는 방식이 가능하다고 확인).
- **읽기용 API는 더해도 된다.** 서버 데이터를 보여 주기만 하는 화면이 동작하도록 작은 조회 API는 추가한다.

## 단계

| 단계 | 내용 | 서버에 더할 것 |
| --- | --- | --- |
| W1 | `src/main.tsx`, 라우터, API 클라이언트(쿠키, 401이면 로그인으로), WebSocket 클라이언트(이벤트 → 쿼리 무효화), 레이아웃(사이드바: 메뉴, 앱 목록·점 색·진행 상태·보관 묶음, 사용량 카드; 상단 연결 끊김 띠), 로그인 화면. Nest가 `apps/web/dist`를 `/`에서 내보내고, `/api`·`/mcp`·`/ws`·`/health`를 뺀 경로는 `index.html`로 보낸다(`configureApp`). `install-launchd.sh`가 web도 빌드한다 | `GET /api/usage`(가장 최근 run의 rateLimit과 받은 시각) |
| W2 | 앱 페이지: 머리(진행 상태 메뉴, 단계 막대, 링크, 탭 개수, 알림 띠), 개요 탭, 설정 탭(v3 앱 설정 상세), 앱 관리(앱 목록, 앱 등록 창, 새 앱 기획 설정) | 없음 |
| W3 | 오늘, 태스크 보드(앱 필터 칩), task 상세 패널, task 추가 창 | `GET /api/tasks`에 `limit`(완료 최근 20개). `GET /api/specs?task=`(문서 칸) |
| W4 | 기획 인박스(기능·새 앱 탭), 생성 창 2개, 새 앱 승인 창(2단계 확인), 시작 진행 화면 | 없음 |
| W5 | 실행 기록, 실행 상세(실시간 로그 `run.log`, 답변, 중지, 다시 실행), 새 앱 세션 | `GET /api/runs?status=&app=&kind=&limit=` |
| W6 | 규칙, 비용, 명령 팔레트, 공통 상태(로딩, 빈 화면, Hub 꺼짐, 연결 끊김) | 실수 기록 `GET/PATCH /api/mistakes` (앱 설정의 실수 기록 칸) |

## 화면이 쓰는 서버 API

- **앱**: `GET /api/apps`, `GET /api/apps/status`(사이드바 점 색), `GET /api/apps/:id/overview`(개요), `PATCH /api/apps/:id`(진행 상태 `lifecycle`, 단계 `stage`·`stages`, 링크 `links` — 키는 `github`, `web`, `ios`, `android`, `doc`), `GET /api/apps/:id/repos`, `POST /api/apps/:id/repos/detect`, `PATCH /api/repos/:id`
- **task**: `GET/POST/PATCH /api/tasks`, `POST /api/tasks/:id/run`, `GET /api/tasks/:id/runs`, `POST /api/import/taskmaster {app, dryRun, update}`
- **실행**: `GET /api/runs/:id`, `GET /api/runs/:id/logs?after=`, `POST /api/runs/:id/answer`, `POST /api/runs/:id/stop`
- **기획**: `GET /api/ideas?kind=&status=`, `GET /api/ideas/:id`(versions, estimate), approve·revise·reject·develop, `POST /api/apps/:id/ideas/generate`, `POST /api/concepts/generate`, `POST /api/apps/:id/bootstrap`
- **배포·히스토리**: `GET /api/apps/:id/deployments`, `POST /api/deployments/sync`, `GET /api/activities?app=&kind=&before=`, `POST /api/apps/:id/activities`
- **세션**: `GET /api/apps/:id/sessions`
- **설정·로그인**: `GET/PATCH /api/settings/ideation`, `GET/PUT /api/rules`, `GET /api/costs?month=`, `GET /api/costs/monthly`, `POST /api/auth/login {password, remember}`, `POST /api/auth/logout`, `GET /api/auth/me`
- **WebSocket**: `/ws`. 쿠키로 인증한다. 이벤트 이름과 페이로드 타입은 `packages/shared/src/events.ts`에 있다.
- **타입**: `packages/shared/src/dto.ts`, `status.ts`. web은 `@hub/shared`를 그대로 import한다.

## 알아 둘 것

- **로그인**: 비밀번호를 아직 정하지 않았다. 그동안은 Hub 토큰(`~/.claude/hub-token`)으로 로그인된다. `pnpm hub:password`로 정한다. 쿠키로 들어온 요청이 데이터를 바꿀 때는 Origin이 요청 Host와 같아야 한다.
- **디자인 파일 형식**: `.dc.html`은 디자인 도구 형식이다(`sc-if`, `sc-for`, `{{ }}`, 끝부분 `<script>`의 시안 데이터와 상태). 화면마다 `data-screen-label`로 나뉘어 있고, 마크업이 인라인 스타일이라 그대로 옮기기 쉽다. 파일이 크니(457KB) 화면 하나씩 잘라 읽는다.
- **`design/` 폴더**: 디자인 에이전트 결과로 통째로 바뀐다. 우리 문서는 `docs/`에 둔다.
- **실제 데이터의 특이점**
  - CM의 task 26개는 저장소가 정해지지 않아 실행 전에 backend·frontend를 골라야 한다.
  - Link의 "앱 배포 (안드로이드)" 워크플로는 스토어 배포로 짐작해 두었다.
  - 하루알바는 97일째 조용하다.
  - FJ 벌금통의 원격 조종 세션은 `758307a0`이다.
- **고객앱 수정 목록**: 사용자가 메시지에 붙였다가 끊긴 목록(지도 마커, 업체 사진, 마이페이지, 쿠폰 배너)이 있다. Hub가 아니라 다른 프로젝트(마사지 예약 앱으로 보임) 이야기라 처리하지 않았다. 사용자에게 확인이 필요하다.

## 먼저 열어 볼 파일

1. `docs/Hub 대시보드 v4 수정 요청.md`, `docs/Hub 대시보드 디자인 작업 계획서.md`
2. `design/Hub Dashboard v4.dc.html` (사이드바, 앱 페이지, 앱 관리)
3. `packages/shared/src/dto.ts`, `packages/shared/src/status.ts`
4. `apps/server/src/bootstrap.ts`(정적 파일 서빙을 넣을 곳), `apps/server/src/common/token.guard.ts`
5. `apps/web/` 뼈대, `ops/install-launchd.sh`
