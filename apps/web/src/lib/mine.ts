import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MineDto, MyDocDto, MyDocKind, MyFileKind, MyTodoDto } from '@hub/shared';
import { api, qs } from '../api/client';
import { dueOffset } from './format';

export const DOC_KIND: Record<MyDocKind, string> = {
  store: '스토어 개발자 계정',
  apikey: '외부 API 키',
  billing: '결제·구독',
  domain: '도메인·DNS',
  legal: '법무 문서',
  memo: '자유 메모',
};

/** 만료·갱신일 며칠 전부터 오늘 화면에 띄울지 */
export const ALERT_DAYS = 14;

/** 첨부 한 파일 최대 크기 (서버 MAX_FILE_BYTES와 같다) */
export const MAX_FILE_MB = 20;

export const FILE_KIND: Record<MyFileKind, string> = { pdf: 'PDF', md: 'MD', text: 'TXT', image: '이미지', other: '파일' };

export function useMine() {
  return useQuery({ queryKey: ['mine'], queryFn: () => api.get<MineDto>('/api/mine') });
}

/** 내 업무 바꾸기. 응답으로 캐시를 바로 고쳐서 자동 저장해도 화면이 튀지 않게 한다 */
export function useMineApi() {
  const qc = useQueryClient();
  const putTodo = (t: MyTodoDto) => qc.setQueryData<MineDto>(['mine'], (m) => m && { ...m, todos: m.todos.some((x) => x.id === t.id) ? m.todos.map((x) => (x.id === t.id ? t : x)) : [...m.todos, t] });
  const putDoc = (d: MyDocDto) => qc.setQueryData<MineDto>(['mine'], (m) => m && { ...m, docs: m.docs.some((x) => x.id === d.id) ? m.docs.map((x) => (x.id === d.id ? d : x)) : [...m.docs, d] });
  const refresh = () => qc.invalidateQueries({ queryKey: ['mine'] });
  return {
    refresh,
    addTodo: async (title: string, parentId: number | null = null) => {
      const t = await api.post<MyTodoDto>('/api/mine/todos', { title, parentId });
      putTodo(t);
      return t;
    },
    updateTodo: async (id: number, patch: Partial<Pick<MyTodoDto, 'title' | 'dueDate' | 'priority' | 'done' | 'docId'>>) => {
      const t = await api.patch<MyTodoDto>(`/api/mine/todos/${id}`, patch);
      putTodo(t);
      return t;
    },
    deleteTodo: async (id: number) => {
      await api.del(`/api/mine/todos/${id}`);
      await refresh();
    },
    addDoc: async (kind: MyDocKind, title: string) => {
      const d = await api.post<MyDocDto>('/api/mine/docs', { kind, title });
      putDoc(d);
      return d;
    },
    updateDoc: async (id: number, patch: Partial<Omit<MyDocDto, 'id' | 'hasValue' | 'secretLast4' | 'files' | 'updatedAt'>>) => {
      const d = await api.patch<MyDocDto>(`/api/mine/docs/${id}`, patch);
      putDoc(d);
      return d;
    },
    deleteDoc: async (id: number) => {
      await api.del(`/api/mine/docs/${id}`);
      await refresh();
    },
    /** 첨부 올리기: 응답(첨부 목록이 담긴 문서)으로 캐시를 고친다 */
    uploadFile: async (docId: number, file: File) => putDoc(await api.upload<MyDocDto>(`/api/mine/docs/${docId}/files${qs({ name: file.name })}`, file)),
    deleteFile: async (fileId: number) => putDoc(await api.del<MyDocDto>(`/api/mine/files/${fileId}`)),
    getSecret: (id: number) => api.get<{ value: string }>(`/api/mine/docs/${id}/secret`).then((r) => r.value),
    setSecret: async (id: number, value: string) => putDoc(await api.put<MyDocDto>(`/api/mine/docs/${id}/secret`, { value })),
  };
}

/** 오늘 기준 일수: 지났으면 음수 */
export const daysLeft = (iso: string) => dueOffset(iso);

/** D-3 · 오늘 · 2일 지남 */
export function dLeft(off: number): string {
  return off < 0 ? `${-off}일 지남` : off === 0 ? '오늘' : `D-${off}`;
}

export function mdOf(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

/** 14일 안에 만료·갱신·결제되는 문서(지난 것 포함), 가까운 순 */
export function docAlerts(docs: MyDocDto[]): MyDocDto[] {
  return docs.filter((d) => d.expiresOn && daysLeft(d.expiresOn) <= ALERT_DAYS).sort((a, b) => a.expiresOn!.localeCompare(b.expiresOn!));
}

/** 기한이 지난 안 끝난 내 업무 할 일, 오래된 순 (하위 할 일은 기한이 없다) */
export function overdueMine(todos: MyTodoDto[]): MyTodoDto[] {
  return todos.filter((t) => !t.parentId && !t.done && t.dueDate && daysLeft(t.dueDate) < 0).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}

/** 오늘 0시 기준 YYYY-MM-DD */
export function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
