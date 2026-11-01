import { slugify } from './git';
import { buildTaskPrompt } from './prompt';
import { resolveEnded, Run, runTarget } from './run.entity';
import { judge, ProcessOutcome, toLogEntries } from './stream-parser';

const base: ProcessOutcome = { result: null, rateLimit: null, exitCode: 0, stopped: false, stderr: '' };
const success = (structured_output: unknown) => ({ type: 'result', subtype: 'success', is_error: false, structured_output });

describe('판정', () => {
  it('완료', () => {
    expect(judge({ ...base, result: success({ status: 'done', summary: 's' }) })).toEqual({
      kind: 'done',
      output: { status: 'done', summary: 's' },
    });
  });
  it('질문', () => {
    const v = judge({ ...base, result: success({ status: 'needs_input', summary: 's', question: '어느 쪽?' }) });
    expect(v).toMatchObject({ kind: 'needs_input', question: '어느 쪽?' });
  });
  it('질문이 비어 있으면 summary를 질문으로', () => {
    expect(judge({ ...base, result: success({ status: 'needs_input', summary: '확인 필요' }) })).toMatchObject({ question: '확인 필요' });
  });
  it('중지가 가장 먼저', () => {
    expect(judge({ ...base, stopped: true, result: success({ status: 'done', summary: 's' }) }).kind).toBe('stopped');
  });
  it('사용량 한도', () => {
    const v = judge({ ...base, rateLimit: { status: 'rejected', rateLimitType: 'five_hour' }, result: { type: 'result', subtype: 'error_during_execution', is_error: true } });
    expect(v).toMatchObject({ kind: 'failed', failure: 'rate_limit' });
  });
  it('결과 없이 종료', () => {
    expect(judge({ ...base, exitCode: 1, stderr: 'boom' })).toMatchObject({ kind: 'failed', failure: 'process' });
  });
  it('출력 스키마 없음', () => {
    expect(judge({ ...base, result: success(undefined) })).toMatchObject({ kind: 'failed', failure: 'no_output' });
  });
});

describe('스트림 → 로그', () => {
  it('assistant 텍스트와 도구 사용', () => {
    const entries = toLogEntries({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '보겠다' }, { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] },
    });
    expect(entries).toEqual([
      { kind: 'assistant', text: '보겠다' },
      { kind: 'tool_use', text: 'Bash pnpm test' },
    ]);
  });
  it('잡음과 허용된 사용량 이벤트는 건너뛴다', () => {
    expect(toLogEntries({ type: 'system', subtype: 'hook_started' })).toEqual([]);
    expect(toLogEntries({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })).toEqual([]);
  });
  it('모르는 이벤트도 멈추지 않는다', () => {
    expect(toLogEntries({ type: 'brand_new_event' })).toEqual([{ kind: 'system', text: 'brand_new_event' }]);
  });
});

describe('브랜치 slug와 프롬프트', () => {
  it('slug', () => {
    expect(slugify('Add Mic Preview!')).toBe('add-mic-preview');
    expect(slugify('음성방 마이크')).toBe('task');
    expect(slugify('LiveKit(음성방) 운영 배포')).toBe('livekit');
  });
  it('프롬프트에 task, 명세, 완료 조건이 들어간다', () => {
    const p = buildTaskPrompt({
      task: { id: 'LK-7', title: '배포', description: '설명' },
      app: { code: 'LK', name: 'Link', defaultBranch: 'main' },
      branch: 'hub/LK-7-task',
      specs: [{ kind: 'spec', title: '기획', body: '본문' }],
    });
    expect(p).toContain('## task LK-7: 배포');
    expect(p).toContain('## 기획 명세: 기획');
    expect(p).toContain('"LK-7: "로 시작');
    expect(p).toContain('push, PR 생성, Hub task 상태 변경은 하지 않는다');
  });
});

describe('다시 실행해서 완료된 실패', () => {
  const run = (id: number, p: Partial<Pick<Run, 'taskId' | 'kind' | 'result'>>) => ({ id, taskId: null, kind: 'implement' as const, result: {}, ...p });

  it('다시 실행 대상', () => {
    expect(runTarget(run(1, { taskId: 'LK-1' }))).toBe('task:LK-1');
    expect(runTarget(run(1, { kind: 'bootstrap', result: { bootstrap: { ideaId: 3, appId: 9 } } }))).toBe('bootstrap:9');
    expect(runTarget(run(1, { kind: 'idea_gen', result: { idea: { appId: 2, ideaId: 7, note: '고쳐' } } }))).toBe('revise:7');
    expect(runTarget(run(1, { kind: 'idea_gen', result: { idea: { kind: 'app', appId: null } } }))).toBe('concept');
    expect(runTarget(run(1, { kind: 'idea_gen', result: { idea: { appId: 2 } } }))).toBe('ideas:2');
    expect(runTarget(run(1, { kind: 'idea_gen' }))).toBeNull();
  });

  it('같은 대상의 뒤 run이 완료되면 그 run id, 앞선 완료나 다른 대상은 보지 않는다', () => {
    const failed = [run(10, { taskId: 'LK-1' }), run(11, { taskId: 'LK-2' }), run(12, { kind: 'idea_gen', result: { idea: { appId: 2 } } })];
    const done = [run(5, { taskId: 'LK-2' }), run(13, { taskId: 'LK-1' }), run(14, { taskId: 'LK-1' }), run(15, { kind: 'idea_gen', result: { idea: { appId: 3 } } })];
    expect(resolveEnded(failed, done)).toEqual(new Map([[10, 13]]));
  });
});
