# Hub (프로젝트 관리)

이 맥북에는 여러 앱의 task, 기획, 실행 기록을 한 곳에서 관리하는 로컬 서비스 "Hub"가 있다.

## Hub가 무엇인지

- 주소는 `http://127.0.0.1:2424` 이다. 대시보드도 같은 주소에서 열린다.
- 관리하는 앱과 코드: LK = Link, HR = 하루알바, CM = cyphers-meta, OA = 오늘알바, TH = test-hub, FJ = 벌금통. 앱마다 저장소가 여러 개일 수 있다(HR, CM은 backend·frontend).
- task의 원천은 Hub DB다. 저장소 안의 `.taskmaster/tasks/tasks.json`은 더 이상 기준이 아니다.
- Hub는 MCP 서버 `hub`로 연결되어 있다. 주요 도구:
  - `list_tasks`, `get_task`: task 조회
  - `create_tasks`: task 생성 (기획을 쪼갤 때도 사용)
  - `update_task_status`: 상태 변경과 진행 메모
  - `get_spec`, `save_spec`: 기획 명세와 인수인계 문서
  - `record_mistake`: 실수 기록
  - `submit_idea`: 아이디어·기획 제출 (app을 빼면 새 앱 기획)
  - `report_bug`: 버그 등록. 작업 중 버그를 발견하면 고치기 전에 먼저 남긴다
  - `add_todo`: 사용자가 직접 해야 할 일 (스토어 심사 제출, 도메인 연결, 결제 계정 등). Claude가 할 수 없는 일이 생기면 여기에 남긴다
  - `record_deploy`: GitHub에 남지 않는 배포 기록 (스토어 제출·심사 결과, 수동 배포). GitHub 배포와 Actions 결과는 Hub가 자동으로 가져온다
  - `set_stage`: 앱의 개발 단계 이동 (기본: plan, design, develop, test, deploy, operate)

## 프로젝트 문서

- 프로젝트 문서(기획, 설계, API, 운영 메모)는 저장소의 `docs/`에, 디자인 파일(시안, 프로토타입, 화면 캡처)은 `design/`에 둔다. Hub 앱 페이지의 "문서" 탭이 docs/를, "디자인" 탭이 design/을 보여 준다.
- `save_spec`으로 남긴 기획 명세·인수인계는 Hub가 앱 폴더의 `docs/hub/`에 사본을 쓴다. Hub에 저장할 때마다 다시 쓰이니 사본을 직접 고치지 않고 `save_spec`으로 고친다.

## task 상태

`todo` → `doing` → `input`(내 답변 대기) → `review`(PR 생성됨) → `done`. 담당이 사용자(`assignee: me`)인 할 일은 리뷰 없이 `done`으로 간다.

## 세션과 Hub의 관계

- 세션이 시작될 때 Hub가 `[Hub context]` 블록을 넣어 준다. 이 블록에는 현재 앱, 이 세션의 task, 열린 task, 이 앱에서 기록된 실수가 들어 있다.
- `[Hub context]` 블록이 없으면 Hub가 꺼져 있는 상태다.
- Hub가 띄운 세션은 환경변수 `HUB_TASK_ID`를 가지고, 브랜치 이름이 `hub/`로 시작하는 worktree에서 돈다.
- 직접 연 세션은 진행 중인 task가 연결되기 전까지 파일 수정과 Bash가 막힌다. 읽기 도구와 Hub 도구는 쓸 수 있다. `update_task_status`로 task를 `doing`(또는 `input`)으로 바꾸면 이 세션에 연결되고, `review`·`done`·`cancelled`로 넘기면 풀린다. 다음 일을 하려면 그 일의 task를 다시 `doing`으로 바꾼다.
- `~/project` 아래에서 Hub에 등록되지 않은 폴더도 막힌다. 사용자에게 대시보드 사이드바의 "앱" 옆 + 버튼으로 등록하자고 안내한다.
- 세션의 명령, 도구 사용, 종료는 hook으로 Hub에 자동 기록된다. 따로 보고할 필요는 없다.
