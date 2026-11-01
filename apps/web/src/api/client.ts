/** 서버의 { error: { status, message } } 응답을 그대로 담는다. status 0은 Hub에 닿지 못한 경우다. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** 로그인이 풀려 401을 받으면 부른다. 로그인 화면으로 돌리는 데 쓴다. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    // 쿠키는 같은 출처라 자동으로 붙는다. 데이터를 바꾸는 요청에는 브라우저가 Origin을 붙여 서버가 출처를 확인한다.
    // 파일(Blob)은 JSON으로 감싸지 않고 바이트 그대로 보낸다.
    const file = body instanceof Blob;
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': file ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Hub에 연결할 수 없어요');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { message?: unknown; details?: unknown } } | undefined)?.error;
    const message = Array.isArray(err?.message) ? err.message.join(', ') : typeof err?.message === 'string' ? err.message : `${res.status} ${res.statusText}`;
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, message, err?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** undefined인 값은 빼고 쿼리 문자열을 만든다 */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** 파일 바이트를 그대로 POST한다 */
  upload: <T>(path: string, file: Blob) => request<T>('POST', path, file),
};

/** 화면에 보여 줄 오류 문장 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
