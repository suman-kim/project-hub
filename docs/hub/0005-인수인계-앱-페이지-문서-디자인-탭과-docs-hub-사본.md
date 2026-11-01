<!-- Hub 문서 #5의 사본. Hub에 저장할 때마다 다시 쓰니, 고칠 때는 Hub(save_spec)에서 고친다. -->
# 인수인계: 앱 페이지 문서·디자인 탭과 docs/hub 사본

> 인수인계 · task HB-3 · 2026-10-29 16:15 저장

## 한 일
- 앱 페이지에 "문서"(docs/) 탭과 "디자인"(design/) 탭을 더했다. 앱 폴더와 등록된 저장소마다 읽는다.
  - md는 Hub 안에서 렌더링하고, HTML 시안은 격리된 iframe으로 보여 주며, 이미지는 그대로 보여 준다.
  - 파일 찾기와 "새 탭에서 열기"가 있다.
- 서버
  - `GET /api/apps/:id/files`: 보여 줄 파일 목록.
  - `GET /view/<서명>/<docs|design>/…`: 쿠키 없이 서명으로 여는 읽기 전용 주소. 응답에 CSP sandbox, no-referrer, ACAO *를 붙인다.
  - docs/·design/ 밖, 숨김 파일, 루트 밖 심볼릭 링크는 거부한다.
- save_spec은 DB에 더해 앱 폴더의 `docs/hub/<번호>-<제목>.md`에 사본을 쓴다. 기존 문서 2·3·4번도 써 두었다.
- md 렌더러에 표·인용·구분선·제목 단계·HTML 주석 숨기기를 더했다.
- 규칙 hub.md에 docs/·design/ 약속을 더했다.

## 내린 결정과 이유
- 서명 주소를 쓴 이유: 로그인 쿠키가 SameSite=Strict라서 sandbox iframe(출처 없음)에서는 쿠키 인증으로 support.js를 받을 수 없다. 스크립트가 도는 디자인 파일이 Hub 쿠키·API에 닿지 않게 하려면 allow-same-origin을 줄 수도 없다.
- 서명은 6시간 단위로 같은 값을 준다. 목록을 다시 읽을 때마다 주소가 바뀌면 미리보기가 다시 뜬다.
- Hub 문서 사본은 사용자가 B안(프로젝트 docs/에도 파일로)을 골랐다. 커밋 안 된 파일이 생기는 것은 받아들인 단점이다.
- 문서와 디자인은 사용자 요청으로 탭을 나눴다.

## 남은 일·주의
- 사본(docs/hub)은 Hub에 저장할 때마다 다시 쓰인다. 직접 고친 내용은 사라진다.
- md 안의 상대 링크와 이미지(`![](x.png)`)는 아직 따라가지 않는다.
- 폴더 감시는 하지 않는다. 탭을 열거나 창으로 돌아올 때 다시 읽는다.
- 커밋·PR 없음.

## 먼저 열어 볼 파일
- `apps/server/src/modules/files/project-files.service.ts`, `project-files.controller.ts`
- `apps/server/src/modules/knowledge/spec-file.ts`, `knowledge.service.ts`의 saveSpec
- `apps/web/src/screens/AppDocs.tsx`, `apps/web/src/lib/md.tsx`
- `docs/Hub 인수인계 - 대시보드 구현.md`의 Oct 29 진행 기록
