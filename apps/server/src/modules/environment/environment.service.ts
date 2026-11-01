import { Inject, Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { EnvironmentDto, KoProgressDto, McpCheckDto, McpServerDto, PluginDto, SkillDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';
import { run } from '../runner/git';
import { KoItem, KoSummaries } from './ko-summaries';
import { parseFrontmatter, parseMcpList } from './parse';

/** 설명 칸에 보여 줄 길이. 스킬 설명은 길게 쓴 것이 많다 */
const DESC_MAX = 400;
const MCP_TIMEOUT_MS = 120_000;

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
}

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > DESC_MAX ? `${t.slice(0, DESC_MAX)}…` : t;
}

type SkillBase = Pick<SkillDto, 'source' | 'plugin' | 'appCode'>;

const skillItem = (s: Pick<SkillDto, 'kind' | 'name' | 'plugin' | 'description'>): KoItem => ({ type: s.kind, name: s.plugin ? `${s.plugin}:${s.name}` : s.name, text: s.description });
const pluginItem = (p: Pick<PluginDto, 'name' | 'description'>): KoItem => ({ type: 'plugin', name: p.name, text: p.description ?? '' });
const serverItem = (s: Pick<McpServerDto, 'name' | 'target' | 'plugin'>): KoItem => ({ type: 'connector', name: s.name, text: `${s.target}${s.plugin ? ` · 플러그인 ${s.plugin}` : ''}` });

/** <dir>/<이름>/SKILL.md */
function skillsIn(dir: string, base: SkillBase): SkillDto[] {
  return list(dir)
    .filter((n) => existsSync(join(dir, n, 'SKILL.md')))
    .map((n) => {
      const path = join(dir, n, 'SKILL.md');
      const fm = parseFrontmatter(readFileSync(path, 'utf8'));
      return { ...base, kind: 'skill' as const, name: fm.name || n, description: clip(fm.description ?? ''), path, ko: null };
    });
}

/** <dir>/<이름>.md 슬래시 명령 */
function commandsIn(dir: string, base: SkillBase): SkillDto[] {
  return list(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => {
      const path = join(dir, n);
      const text = readFileSync(path, 'utf8');
      const fm = parseFrontmatter(text);
      const firstLine = text.replace(/^---[\s\S]*?---\s*/, '').split('\n').find((l) => l.trim()) ?? '';
      return { ...base, kind: 'command' as const, name: basename(n, '.md'), description: clip(fm.description ?? firstLine.replace(/^#+\s*/, '')), path, ko: null };
    });
}

interface InstalledPlugins {
  plugins?: Record<string, Array<{ scope?: string; version?: string; installPath?: string }>>;
}
interface SyncedManifest {
  plugins?: Array<{ name: string; description?: string; version?: string; marketplaceName?: string; generation?: number | null }>;
}
interface SyncedSkills {
  skills?: Array<{ name: string; description?: string }>;
}

/**
 * 이 맥북의 Claude Code 환경을 읽는다(읽기만 한다).
 * - 플러그인: ~/.claude/plugins/installed_plugins.json(직접 설치)과 plugins/synced/<계정>/manifest.json(claude.ai 계정 동기화)
 * - 스킬: ~/.claude/skills, skills/synced/<계정>, 플러그인의 skills·commands, 앱 저장소의 .claude/skills·commands
 * - 커넥터·MCP: claude mcp list (연결 상태까지 확인하느라 30초쯤 걸려서 마지막 결과를 들고 있는다)
 */
@Injectable()
export class EnvironmentService {
  private readonly logger = new Logger('Environment');
  private mcp: McpCheckDto = { checkedAt: null, running: false, error: null, servers: [] };

  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly apps: AppsService,
    private readonly repos: ReposService,
    private readonly ko: KoSummaries,
  ) {}

  async scan(): Promise<EnvironmentDto> {
    const home = this.config.claudeHome;
    const enabled = readJson<{ enabledPlugins?: Record<string, boolean> }>(join(home, 'settings.json'))?.enabledPlugins ?? {};
    const plugins: PluginDto[] = [];
    const skills: SkillDto[] = [];

    const addPlugin = (dir: string, p: Omit<PluginDto, 'name' | 'skills' | 'commands' | 'path' | 'description' | 'version' | 'ko'> & { name: string; description?: string | null; version?: string | null }) => {
      const meta = readJson<{ name?: string; version?: string; description?: string }>(join(dir, '.claude-plugin', 'plugin.json')) ?? {};
      const name = meta.name || p.name;
      const base: SkillBase = { source: 'plugin', plugin: name, appCode: null };
      const own = [...skillsIn(join(dir, 'skills'), base), ...commandsIn(join(dir, 'commands'), base)];
      skills.push(...own);
      plugins.push({
        ...p,
        name,
        version: meta.version ?? p.version ?? null,
        description: clip(meta.description ?? p.description ?? '') || null,
        enabled: p.marketplace ? enabled[`${name}@${p.marketplace}`] !== false : true,
        path: dir,
        skills: own.filter((s) => s.kind === 'skill').length,
        commands: own.filter((s) => s.kind === 'command').length,
        ko: null,
      });
    };

    // 이 맥북에 직접 설치한 플러그인 (claude plugin install)
    const installed = readJson<InstalledPlugins>(join(home, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
    for (const [key, entries] of Object.entries(installed)) {
      const e = entries.find((x) => x.installPath && isDir(x.installPath));
      if (!e) continue;
      const [name, marketplace] = key.split('@');
      addPlugin(e.installPath!, { name, source: 'local', marketplace: marketplace ?? null, enabled: true, version: e.version ?? null });
    }

    // claude.ai 계정에서 동기화된 플러그인. 세대가 바뀐 플러그인은 <이름>~g<세대> 폴더에 있다
    const syncedRoot = join(home, 'plugins', 'synced');
    for (const account of list(syncedRoot)) {
      const dir = join(syncedRoot, account);
      for (const p of readJson<SyncedManifest>(join(dir, 'manifest.json'))?.plugins ?? []) {
        const gen = p.generation ? join(dir, `${p.name}~g${p.generation}`) : null;
        const path = gen && isDir(gen) ? gen : join(dir, p.name);
        if (!isDir(path)) continue;
        addPlugin(path, { name: p.name, description: p.description, source: 'claude_ai', marketplace: p.marketplaceName ?? null, enabled: true, version: null });
      }
    }

    // 사용자 스킬과 명령
    const userSkills = join(home, 'skills');
    // synced 폴더는 SKILL.md가 없어 여기서는 빠지고 아래에서 따로 읽는다.
    skills.push(...skillsIn(userSkills, { source: 'local', plugin: null, appCode: null }));
    skills.push(...commandsIn(join(home, 'commands'), { source: 'local', plugin: null, appCode: null }));

    // claude.ai 계정에서 동기화된 스킬
    for (const account of list(join(userSkills, 'synced'))) {
      const dir = join(userSkills, 'synced', account);
      const manifest = readJson<SyncedSkills>(join(dir, 'manifest.json'))?.skills;
      if (manifest) {
        skills.push(
          ...manifest.map((s) => ({ kind: 'skill' as const, source: 'claude_ai' as const, plugin: null, appCode: null, name: s.name, description: clip(s.description ?? ''), path: join(dir, s.name, 'SKILL.md'), ko: null })),
        );
      } else skills.push(...skillsIn(dir, { source: 'claude_ai', plugin: null, appCode: null }));
    }

    // 앱 저장소의 프로젝트 스킬과 명령 (.claude/skills, .claude/commands)
    const seen = new Set<string>();
    for (const app of await this.apps.list()) {
      const paths = [app.repoPath, ...(await this.repos.list(app.id)).map((r) => r.path)].filter((p): p is string => !!p);
      for (const p of paths) {
        if (seen.has(p)) continue;
        seen.add(p);
        const base: SkillBase = { source: 'project', plugin: null, appCode: app.code };
        skills.push(...skillsIn(join(p, '.claude', 'skills'), base), ...commandsIn(join(p, '.claude', 'commands'), base));
      }
    }

    plugins.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    for (const p of plugins) p.ko = this.ko.get(pluginItem(p));
    for (const sk of skills) sk.ko = this.ko.get(skillItem(sk));
    // 한국어 요약이 없는 항목은 화면을 열 때 뒤에서 만든다(한 번 만들면 다시 쓰지 않는다).
    const ko = this.ko.start([...plugins.map(pluginItem), ...skills.map(skillItem), ...this.mcp.servers.map(serverItem)]);
    return { scannedAt: new Date().toISOString(), plugins, skills, ko };
  }

  koState(): KoProgressDto {
    return this.ko.state();
  }

  /** 마지막 확인 결과. 한 번도 확인하지 않았으면 지금 확인을 시작한다 */
  mcpState(): McpCheckDto {
    if (!this.mcp.checkedAt && !this.mcp.running && !this.mcp.error) void this.checkMcp();
    return { ...this.mcp, servers: this.mcp.servers.map((s) => ({ ...s, ko: this.ko.get(serverItem(s)) })) };
  }

  /** claude mcp list로 커넥터·MCP 서버의 연결 상태를 다시 확인한다. 이미 확인 중이면 그 결과를 기다리지 않고 돌아간다 */
  async checkMcp(): Promise<McpCheckDto> {
    if (this.mcp.running) return this.mcpState();
    this.mcp = { ...this.mcp, running: true };
    try {
      const out = await run(this.config.runner.claudeBin, ['mcp', 'list'], homedir(), MCP_TIMEOUT_MS);
      this.mcp = { checkedAt: new Date().toISOString(), running: false, error: null, servers: parseMcpList(out) };
      this.ko.start(this.mcp.servers.map(serverItem));
    } catch (e) {
      this.logger.warn(`claude mcp list 실패: ${(e as Error).message}`);
      this.mcp = { ...this.mcp, running: false, error: (e as Error).message };
    }
    return this.mcpState();
  }
}
