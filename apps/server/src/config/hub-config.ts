import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface HubConfig {
  host: string;
  port: number;
  token: string;
  databaseUrl: string;
  /** worktree와 실행 로그 원본을 두는 곳 */
  hubHome: string;
  /** 규칙 파일, hub-token이 있는 곳 */
  claudeHome: string;
  /** Claude Code의 사용자 상태 파일. 새 앱 폴더의 작업 공간 신뢰를 여기에 기록한다 */
  claudeJson: string;
  /** 새 앱 폴더를 만들 기본 위치 (설정에서 바꿀 수 있다) */
  projectRoot: string;
  contextMaxChars: number;
  runner: {
    claudeBin: string;
    ghBin: string;
    /** 동시에 도는 run 수 */
    concurrency: number;
    /** claude -p --allowedTools 기본값. 앱에 allowed_tools가 있으면 그것을 쓴다. */
    allowedTools: string[];
    model: string | null;
    caffeinate: boolean;
  };
}

// push는 Hub가 하므로 허용 목록에 넣지 않는다.
export const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'NotebookEdit', 'TodoWrite',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git add *)', 'Bash(git commit *)',
  'Bash(git status)', 'Bash(git diff)', 'Bash(git log)',
  'Bash(ls *)', 'Bash(pnpm *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(yarn *)', 'Bash(node *)',
  'Bash(flutter *)', 'Bash(dart *)', 'Bash(./gradlew *)',
  'mcp__hub__list_tasks', 'mcp__hub__get_task', 'mcp__hub__get_spec', 'mcp__hub__save_spec', 'mcp__hub__record_mistake',
];

export const HUB_CONFIG = Symbol('HUB_CONFIG');

/** cron과 월·일 단위 집계의 기준 시간대 */
export const HUB_TIMEZONE = 'Asia/Seoul';

/**
 * 토큰은 HUB_TOKEN 환경변수가 있으면 그 값을, 없으면 ~/.claude/hub-token(권한 600)을 쓴다.
 * 파일이 없으면 새로 만든다. hook 스크립트가 같은 파일을 읽어 X-Hub-Token으로 보낸다.
 */
function loadToken(tokenFile: string): string {
  if (process.env.HUB_TOKEN) return process.env.HUB_TOKEN;
  if (existsSync(tokenFile)) {
    const value = readFileSync(tokenFile, 'utf8').trim();
    if (value) return value;
  }
  const value = randomBytes(24).toString('hex');
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, `${value}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return value;
}

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const claudeHome = env.HUB_CLAUDE_HOME || join(homedir(), '.claude');
  return {
    // 맥북 밖에서 접속되지 않도록 루프백에만 바인딩한다. 설정으로 바꾸지 않는다.
    host: '127.0.0.1',
    port: Number(env.HUB_PORT || 2424),
    token: loadToken(env.HUB_TOKEN_FILE || join(claudeHome, 'hub-token')),
    databaseUrl: env.HUB_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub',
    hubHome: env.HUB_HOME || join(homedir(), '.hub'),
    claudeJson: env.HUB_CLAUDE_JSON || join(homedir(), '.claude.json'),
    projectRoot: env.HUB_PROJECT_ROOT || join(homedir(), 'project'),
    claudeHome,
    contextMaxChars: 8000,
    runner: {
      claudeBin: env.HUB_CLAUDE_BIN || 'claude',
      ghBin: env.HUB_GH_BIN || 'gh',
      concurrency: Number(env.HUB_RUN_CONCURRENCY || 2),
      allowedTools: env.HUB_ALLOWED_TOOLS ? env.HUB_ALLOWED_TOOLS.split(',').map((t) => t.trim()) : DEFAULT_ALLOWED_TOOLS,
      model: env.HUB_CLAUDE_MODEL || null,
      caffeinate: env.HUB_CAFFEINATE !== '0',
    },
  };
}
