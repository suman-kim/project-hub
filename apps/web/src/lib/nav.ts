import { useLocation, useNavigate } from 'react-router-dom';

/** task 상세 패널은 어느 화면 위에서든 ?task=LK-12로 연다. 목록 위치를 잃지 않게 지금 주소는 그대로 둔다 */
export function useTaskPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const set = (id: string | null) => {
    const next = new URLSearchParams(location.search);
    if (id) {
      next.set('task', id);
      // 세션 대화 패널과 같은 자리라 겹치지 않게 닫는다.
      next.delete('session');
    } else next.delete('task');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: !!params.get('task') && !!id });
  };
  return { taskId: params.get('task'), open: (id: string) => set(id), close: () => set(null) };
}

/** 세션 대화 패널 입력창에 미리 채울 글. 패널의 입력창이 처음 그려질 때 가져간다 */
const sessionDrafts = new Map<number, string>();
export function peekSessionDraft(id: number): string | undefined {
  return sessionDrafts.get(id);
}
export function clearSessionDraft(id: number): void {
  sessionDrafts.delete(id);
}

/** 세션 대화 패널은 ?session=12로 연다. task 패널과 같은 방식이고, 둘이 겹치지 않게 하나를 열면 다른 하나는 닫는다 */
export function useSessionPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const go = (next: URLSearchParams, replace: boolean) => {
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace });
  };
  return {
    sessionId: Number(params.get('session')) || null,
    open: (id: number) => {
      const next = new URLSearchParams(location.search);
      next.set('session', String(id));
      next.delete('task');
      go(next, !!params.get('session'));
    },
    close: () => {
      const next = new URLSearchParams(location.search);
      next.delete('session');
      go(next, false);
    },
    /** 세션 화면으로 가서 그 세션 대화 패널을 열고, 입력창에 draft를 채워 둔다 */
    openWithDraft: (id: number, draft: string) => {
      sessionDrafts.set(id, draft);
      navigate({ pathname: '/sessions', search: `?session=${id}` });
    },
    /** 세션 패널을 닫고 그 task 패널을 연다 */
    openTask: (taskId: string) => {
      const next = new URLSearchParams(location.search);
      next.delete('session');
      next.set('task', taskId);
      go(next, false);
    },
  };
}
