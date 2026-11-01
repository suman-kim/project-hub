import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClaudeMdDto, ClaudeMdFileDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';

/** 없는 파일의 version. 만들 때도 열었을 때 없었는지 확인한다 */
const ABSENT = 'absent';

function versionOf(text: string | null): string {
  return text === null ? ABSENT : createHash('sha1').update(text).digest('hex');
}

/**
 * 규칙 화면에서 CLAUDE.md를 읽고 고친다. 고칠 수 있는 파일은 서버가 정한 것뿐이다:
 * 전역 ~/.claude/CLAUDE.md, 앱 폴더의 CLAUDE.md, 앱 폴더와 다른 곳에 있는 저장소의 CLAUDE.md.
 * hub-rules.md와 달리 DB에 두지 않고 파일이 원본이다(터미널에서 고친 내용도 그대로 보인다).
 */
@Injectable()
export class ClaudeMdService {
  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly apps: AppsService,
    private readonly repos: ReposService,
  ) {}

  private async targets(): Promise<Array<Pick<ClaudeMdFileDto, 'key' | 'label' | 'appCode' | 'path'>>> {
    const out: Array<Pick<ClaudeMdFileDto, 'key' | 'label' | 'appCode' | 'path'>> = [
      { key: 'global', label: '전역 (모든 세션)', appCode: null, path: join(this.config.claudeHome, 'CLAUDE.md') },
    ];
    const seen = new Set<string>();
    for (const app of await this.apps.list()) {
      if (app.repoPath) {
        seen.add(app.repoPath);
        out.push({ key: `app:${app.code}`, label: app.name, appCode: app.code, path: join(app.repoPath, 'CLAUDE.md') });
      }
      for (const r of await this.repos.list(app.id)) {
        if (seen.has(r.path)) continue;
        seen.add(r.path);
        out.push({ key: `repo:${r.id}`, label: `${app.name} · ${r.name}`, appCode: app.code, path: join(r.path, 'CLAUDE.md') });
      }
    }
    return out;
  }

  private describe(t: Pick<ClaudeMdFileDto, 'key' | 'label' | 'appCode' | 'path'>): ClaudeMdFileDto {
    try {
      const st = statSync(t.path);
      return { ...t, exists: true, size: st.size, updatedAt: st.mtime.toISOString() };
    } catch {
      return { ...t, exists: false, size: 0, updatedAt: null };
    }
  }

  async list(): Promise<ClaudeMdFileDto[]> {
    return (await this.targets()).map((t) => this.describe(t));
  }

  private async target(key: string) {
    const t = (await this.targets()).find((x) => x.key === key);
    if (!t) throw new NotFoundException(`CLAUDE.md ${key}가 없다`);
    return t;
  }

  async read(key: string): Promise<ClaudeMdDto> {
    const t = await this.target(key);
    const text = existsSync(t.path) ? readFileSync(t.path, 'utf8') : null;
    return { ...this.describe(t), text: text ?? '', version: versionOf(text) };
  }

  /** 열었을 때와 내용이 다르면(터미널이나 다른 창에서 고쳤으면) 덮어쓰지 않는다. 임시 파일에 쓴 뒤 rename한다 */
  async write(key: string, text: string, version: string): Promise<ClaudeMdDto> {
    const t = await this.target(key);
    const current = existsSync(t.path) ? readFileSync(t.path, 'utf8') : null;
    if (versionOf(current) !== version) throw new ConflictException('열어 둔 사이에 파일이 바뀌었다. 다시 불러와서 고친다');
    if (!existsSync(dirname(t.path))) {
      if (key !== 'global') throw new ConflictException(`폴더 ${dirname(t.path)}가 없다`);
      mkdirSync(dirname(t.path), { recursive: true });
    }
    const body = text.endsWith('\n') || !text ? text : `${text}\n`;
    const tmp = `${t.path}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: existsSync(t.path) ? statSync(t.path).mode & 0o777 : 0o644 });
    renameSync(tmp, t.path);
    return this.read(key);
  }
}
