import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppNoteDto } from '@hub/shared';
import { api } from '../api/client';

/**
 * 노트가 어디에 속하는지: 앱 id(앱 페이지 노트 탭) 또는 null(내 업무 공통 노트).
 * 목록·만들기 주소와 캐시 키만 이 값으로 고르고, 고치기·지우기는 노트 id로 한다.
 */
export type NoteOwner = number | null;

/** 쿼리 키: 앱마다, 그리고 내 업무에 노트 목록 하나씩 */
export const notesKey = (owner: NoteOwner) => ['notes', owner ?? 'mine'] as const;

/** 목록·만들기 주소 */
const listUrl = (owner: NoteOwner) => (owner === null ? '/api/mine/notes' : `/api/apps/${owner}/notes`);

/** 노트를 만들거나 고칠 때 보내는 값 */
export type NotePatch = Partial<Pick<AppNoteDto, 'folder' | 'title' | 'body' | 'pinned'>>;

/**
 * 노트 목록. 서버가 고정 먼저, 최근 수정순으로 준다.
 * @param owner 앱 id 또는 null(내 업무 공통 노트)
 */
export function useNotes(owner: NoteOwner) {
  return useQuery({ queryKey: notesKey(owner), queryFn: () => api.get<AppNoteDto[]>(listUrl(owner)) });
}

/**
 * 노트 바꾸기. 응답으로 캐시를 바로 고쳐서 자동 저장해도 목록이 튀지 않게 한다.
 * @param owner 앱 id 또는 null(내 업무 공통 노트)
 */
export function useNotesApi(owner: NoteOwner) {
  const qc = useQueryClient();
  const key = notesKey(owner);
  const put = (n: AppNoteDto) => qc.setQueryData<AppNoteDto[]>(key, (list) => (list ? (list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [n, ...list]) : [n]));
  return {
    /** 새 노트. 값을 비우면 빈 노트가 생긴다 */
    create: async (patch: NotePatch = {}) => {
      const n = await api.post<AppNoteDto>(listUrl(owner), patch);
      put(n);
      return n;
    },
    update: async (id: number, patch: NotePatch) => {
      const n = await api.patch<AppNoteDto>(`/api/notes/${id}`, patch);
      put(n);
      return n;
    },
    remove: async (id: number) => {
      await api.del(`/api/notes/${id}`);
      qc.setQueryData<AppNoteDto[]>(key, (list) => list?.filter((x) => x.id !== id));
    },
  };
}

/** 목록에서 보여 줄 이름: 제목이 없으면 본문 첫 줄, 그것도 없으면 "제목 없음" */
export function noteName(n: Pick<AppNoteDto, 'title' | 'body'>, preview: (body: string) => string): string {
  return n.title.trim() || preview(n.body) || '제목 없음';
}

/** 화면에서 쓰는 목록 순서: 고정 먼저, 그다음 최근 수정순 (서버와 같은 규칙. 캐시를 고친 뒤에도 순서를 지킨다) */
export function sortNotes(list: AppNoteDto[]): AppNoteDto[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
}
