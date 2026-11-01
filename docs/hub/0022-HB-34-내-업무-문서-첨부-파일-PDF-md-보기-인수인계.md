<!-- Hub 문서 #22의 사본. Hub에 저장할 때마다 다시 쓰니, 고칠 때는 Hub(save_spec)에서 고친다. -->
# HB-34 내 업무 문서 첨부 파일·PDF/md 보기 인수인계

> 인수인계 · task HB-34 · 2026-11-01 02:06 저장

## 한 일
- 내 업무 → 문서 서랍에 **첨부 파일** 칸: 끌어 놓기 / 파일 고르기(여러 개 차례로), 내려받기, 지우기(확인 후). 문서 목록 행에 `첨부 N`.
- **보기 창**: PDF는 브라우저 내장 PDF 보기(iframe), md는 `Markdown` 렌더링(AppDocs의 `TextFile` 재사용), 텍스트는 글자 그대로, 그림(png/jpg/gif/webp)은 화면 맞춤. ←/→로 넘기고 Esc는 보기 창만 닫는다. 그 밖의 파일은 이름을 누르면 내려받기.
- 서버
  - 새 테이블 `my_doc_files` (migration `1793465877987-MyDocFiles`, 테이블·컬럼 comment 포함). doc_id FK CASCADE.
  - 내용은 `~/.hub/files/<uuid><확장자>` (폴더 0700, 파일 0600, **암호화 없음** — 사용자가 "디스크에 그대로"를 골랐다).
  - `POST /api/mine/docs/:id/files?name=` 본문은 파일 바이트 그대로(multipart 아님 → 한글 이름 깨짐 없음). 20MB·문서당 50개. 넘으면 본문을 마저 읽고 413(먼저 답하면 EPIPE). 이름은 NFC·경로 제거·200자.
  - `GET /api/mine/files/:id` PDF·md·텍스트·그림 inline, other와 `?download=1`은 attachment. md·텍스트는 text/plain, svg는 그림으로 열지 않음. PDF 밖은 `CSP: sandbox`(같은 출처라 스크립트 차단). `sendFile(.., { root })`로 ~/.hub 점 폴더 문제 회피.
  - `DELETE /api/mine/files/:id`. 문서 삭제 시 행은 CASCADE, 내용 파일은 MineService.deleteDoc이 지운다.
  - 문서를 바꾸는 모든 응답(MyDocDto)에 `files`가 실린다(화면 캐시 putDoc에서 첨부가 빠지지 않게).
- 첨부는 Claude 세션 맥락([Hub context])에 넣지 않는다.

## 결정과 이유
- 대상 화면: 앱 문서 탭(docs/ 쓰기)이 아니라 내 업무 문서 — 사용자 선택.
- 저장: 디스크 그대로(Finder에서 열 수 있음) — 사용자 선택. 암호화로 바꾸려면 `DiskFileStore`(doc-files.ts)만 같은 모양으로 바꾸면 된다.

## 남은 일 / 제안
- 앱 페이지 문서 탭의 PDF는 아직 "새 탭에서 열기"만 된다. 같은 iframe 방식으로 화면 안 보기를 붙일 수 있다.
- 첨부 이름 바꾸기, 문서 간 옮기기는 없다.

## 먼저 볼 파일
- apps/server/src/modules/mine/doc-files.ts, doc-files.service.ts, my-doc-file.entity.ts, mine.controller.ts
- apps/web/src/screens/Mine.tsx (DocFiles, FileViewer), apps/web/src/lib/mine.ts, apps/web/src/api/client.ts(api.upload)
- 테스트: apps/server/test/project.e2e-spec.ts "첨부 파일", src/domain.spec.ts "내 업무 첨부 파일"
