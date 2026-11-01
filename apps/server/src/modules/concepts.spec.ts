import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderIdeaSpec } from './ideas/ideas.service';
import { buildBootstrapPrompt, hubMcpRegistered, markWorkspaceTrusted } from './runner/bootstrap';
import { buildConceptPrompt, ConceptPromptContext, parseConceptOutput } from './runner/concept-gen';

const output = {
  title: '동네 공구 대여',
  one_liner: '이웃끼리 공구를 빌려 쓰는 앱',
  target_users: '아파트 주민',
  problem: '한 번 쓸 공구를 사야 한다',
  solution: '이웃에게 빌린다',
  mvp_features: ['공구 등록', '대여 요청'],
  scenarios: ['드릴을 빌린다'],
  mvp_spec: '# 화면',
  competitors: [{ name: '당근', url: 'https://www.daangn.com', difference: '대여 전용이 아니다' }],
  market: '1인 가구 증가',
  monetization: '보증금 수수료',
  tech_stack: 'Flutter + NestJS',
  risks: ['파손 분쟁'],
  validation: '단지 한 곳에서 오픈채팅으로 시험',
  app: { code: 'tl ', name: '공구함', folder: 'Tool-Lend' },
  expected_tasks: [{ title: '뼈대', description: '실행되는 앱', size: 'S' }],
  alternatives: [{ title: '육아용품 대여', one_liner: '아기 용품을 돌려 쓴다' }],
  sources: ['https://www.daangn.com'],
};

describe('새 앱 기획 출력 파싱', () => {
  it('snake_case 출력을 기획 본문으로 바꾸고 앱 코드·폴더를 정리한다', () => {
    const parsed = parseConceptOutput(output)!;
    expect(parsed.title).toBe('동네 공구 대여');
    expect(parsed.body).toMatchObject({ problem: '한 번 쓸 공구를 사야 한다', proposal: '이웃에게 빌린다', spec: '# 화면' });
    expect(parsed.body.concept).toMatchObject({
      oneLiner: '이웃끼리 공구를 빌려 쓰는 앱',
      app: { code: 'TL', name: '공구함', folder: 'tool-lend' },
      alternatives: [{ title: '육아용품 대여', oneLiner: '아기 용품을 돌려 쓴다' }],
    });
  });

  it('필수 항목이 없으면 null', () => {
    expect(parseConceptOutput({ ...output, app: undefined })).toBeNull();
    expect(parseConceptOutput({ title: 'x' })).toBeNull();
  });

  it('승인 명세에 조사 내용과 출처가 들어간다', () => {
    const { title, body } = parseConceptOutput(output)!;
    const md = renderIdeaSpec(title, body);
    expect(md).toContain('> 이웃끼리 공구를 빌려 쓰는 앱');
    expect(md).toContain('## 해결 방식\n이웃에게 빌린다');
    expect(md).toContain('- [당근](https://www.daangn.com): 대여 전용이 아니다');
    expect(md).toContain('## 참고한 자료\n- https://www.daangn.com');
  });
});

describe('새 앱 기획 프롬프트', () => {
  const ctx: ConceptPromptContext = {
    directionNote: '1인 개발, 3개월 MVP',
    note: '오프라인 모임',
    seed: null,
    myApps: [{ code: 'LK', name: 'Link', repoPath: '/p/link', directionNote: null }],
    takenFolders: ['link', 'test-hub'],
    recentConcepts: [{ id: 3, title: '중고 거래', status: 'rejected', rejectReason: '경쟁이 너무 많다' }],
  };

  it('방향, 이번 요청, 내 앱, 겹치면 안 되는 이름, 반려 사유를 넣고 웹 조사를 요구한다', () => {
    const p = buildConceptPrompt(ctx);
    expect(p).toContain('아직 없는 새 앱 하나를 구상');
    expect(p).toContain('1인 개발, 3개월 MVP');
    expect(p).toContain('## 이번 요청\n오프라인 모임');
    expect(p).toContain('- LK Link — /p/link');
    expect(p).toContain('이미 있는 폴더 이름: link, test-hub');
    expect(p).toContain('반려 사유: 경쟁이 너무 많다');
    expect(p).toContain('WebSearch와 WebFetch로 비슷한 서비스와 시장을 반드시 조사');
  });

  it('후보를 고르면 그 후보를 깊게 쓴다', () => {
    expect(buildConceptPrompt({ ...ctx, seed: { title: '육아용품 대여', oneLiner: '돌려 쓴다' } })).toContain('다음 후보를 깊게 기획한다: "육아용품 대여"');
  });
});

describe('새 앱 시작 세션', () => {
  it('첫 메시지에 디자인 먼저, hub 브랜치, PR 순서가 들어간다', () => {
    const p = buildBootstrapPrompt({
      app: { code: 'TL', name: '공구함' },
      oneLiner: '이웃끼리 공구를 빌려 쓰는 앱',
      repoUrl: 'https://github.com/me/tool-lend',
      tasks: [
        { id: 'TL-1', title: '뼈대', size: 'S', dependsOn: [] },
        { id: 'TL-2', title: '대여', size: 'M', dependsOn: ['TL-1'] },
      ],
      first: { id: 'TL-1', title: '뼈대' },
    });
    expect(p).toContain('- TL-2 대여 (M) · 먼저: TL-1');
    expect(p).toContain('1. UI 디자인');
    expect(p).toContain('`hub/TL-1-<영문 slug>` 브랜치');
    expect(p).toContain('main에 직접 커밋하거나 push하지 않는다');
  });

  it('신뢰 등록은 다른 항목을 지키고, 기존 항목은 덮지 않고 합친다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-trust-'));
    const file = join(dir, 'claude.json');
    writeFileSync(file, JSON.stringify({ numStartups: 1, projects: { '/a': { hasTrustDialogAccepted: true }, '/b': { lastCost: 1 } } }), { mode: 0o600 });
    markWorkspaceTrusted(file, '/b');
    markWorkspaceTrusted(file, '/c');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.numStartups).toBe(1);
    expect(data.projects['/a']).toEqual({ hasTrustDialogAccepted: true });
    expect(data.projects['/b']).toMatchObject({ lastCost: 1, hasTrustDialogAccepted: true, allowedTools: [] });
    expect(data.projects['/c']).toMatchObject({ hasTrustDialogAccepted: true, mcpServers: {} });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('심볼릭 링크면 링크가 가리키는 파일을 바꾼다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-trust-'));
    const real = join(dir, 'real.json');
    writeFileSync(real, '{}');
    symlinkSync(real, join(dir, 'link.json'));
    markWorkspaceTrusted(join(dir, 'link.json'), '/x');
    expect(JSON.parse(readFileSync(real, 'utf8')).projects['/x'].hasTrustDialogAccepted).toBe(true);
    expect(lstatSync(join(dir, 'link.json')).isSymbolicLink()).toBe(true);
  });

  it('hub MCP 사용자 등록 여부', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-mcp-'));
    writeFileSync(join(dir, 'with.json'), JSON.stringify({ mcpServers: { hub: { type: 'http' } } }));
    writeFileSync(join(dir, 'without.json'), JSON.stringify({ mcpServers: { pencil: {} } }));
    expect(hubMcpRegistered(join(dir, 'with.json'))).toBe(true);
    expect(hubMcpRegistered(join(dir, 'without.json'))).toBe(false);
    expect(hubMcpRegistered(join(dir, 'missing.json'))).toBe(false);
  });
});
