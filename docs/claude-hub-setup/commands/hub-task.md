---
description: Hub task 하나를 이 세션에서 진행한다 (예: /hub-task LK-12)
argument-hint: <task ID>
---

Hub task **$ARGUMENTS** 를 이 세션에서 진행한다. Hub runner 대신 이 세션이 직접 한다.

1. `get_task`로 $ARGUMENTS 를 읽는다. 설명, 의존 task 상태, 연결된 명세·인수인계 문서(`get_spec`)를 확인한다.
   - 이 세션의 앱 task가 아니거나, 완료되지 않은 선행 task가 있거나, 담당이 나(`assignee: me`)인 task면 시작하지 말고 알려 준다.
2. 작업 트리에 커밋하지 않은 변경이 있으면 시작하기 전에 알려 주고 어떻게 할지 묻는다.
3. `update_task_status`로 `doing`으로 바꾸고 메모에 "세션에서 시작"을 남긴다.
4. task의 저장소 기본 브랜치에서 `hub/<task ID 소문자>-<짧은 영문 설명>` 브랜치를 만들어 작업한다.
5. 구현하고 테스트(앱의 검사 명령이 있으면 그것)를 돌린다.
   - 판단이 필요한 질문이 생기면 `update_task_status`로 `input`으로 바꾸고 메모에 질문을 남긴 뒤 나에게 묻는다. 답을 받으면 `doing`으로 돌린다.
6. 커밋하고 브랜치를 push한 뒤 PR을 만든다. main(기본 브랜치)에 직접 push하지 않는다.
7. `update_task_status`로 `review`로 바꾼다. `pr_url`과 `branch`를 함께 넘기고, 메모에 바꾼 것 요약과 테스트 결과를 남긴다. PR이 머지되면 Hub가 task를 완료로 바꾼다.
8. 큰 결정이 있었으면 `save_spec`(kind: handoff)으로 인수인계 문서를 남긴다.
