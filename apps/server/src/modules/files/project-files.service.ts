import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import type { ProjectFileDto, ProjectFileKind, ProjectFilesDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';

/** 프로젝트 문서는 docs/, 디자인은 design/에 둔다 */
export const PROJECT_DIRS = ['docs', 'design'] as const;

/**
 * 보기 주소는 6시간 단위로 같은 값을 주고 6~12시간 동안 쓸 수 있다.
 * 목록을 다시 읽을 때마다 주소가 바뀌면 미리보기 iframe이 다시 뜨기 때문이다.
 */
const VIEW_BUCKET_MS = 6 * 60 * 60 * 1000;
/** 루트의 docs/·design/마다 목록에 넣는 최대 파일 수와 깊이 */
const MAX_FILES = 1500;
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set(['node_modules']);

const KIND: Record<string, ProjectFileKind> = {
  '.md': 'md', '.markdown': 'md',
  '.txt': 'text',
  '.html': 'html', '.htm': 'html',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
  '.pdf': 'pdf',
};

export const kindOf = (path: string): ProjectFileKind | null => KIND[extname(path).toLowerCase()] ?? null;

interface Root {
  label: string;
  path: string;
}

/**
 * 앱 폴더와 등록된 저장소의 docs/·design/을 읽는다. 읽기만 한다.
 * HTML 디자인은 스크립트가 돌아서 대시보드와 떼어 보여 줘야 한다. 그래서 쿠키 대신 서명된 임시 주소(/view/<token>/…)로 내보낸다.
 */
@Injectable()
export class ProjectFilesService {
  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly apps: AppsService,
    private readonly repos: ReposService,
  ) {}

  /** 앱 폴더를 먼저, 그 밖의 저장소를 등록 순서대로. 같은 폴더는 한 번만 */
  async roots(app: App): Promise<Root[]> {
    const out: Root[] = [];
    const seen = new Set<string>();
    const add = (label: string, path: string | null) => {
      if (!path || !existsSync(path)) return;
      const real = realpathSync(path);
      if (seen.has(real)) return;
      seen.add(real);
      out.push({ label, path: real });
    };
    add('앱 폴더', app.repoPath);
    for (const r of await this.repos.list(app.id)) add(r.name, r.path);
    return out;
  }

  async list(appId: number): Promise<ProjectFilesDto> {
    const app = await this.apps.get(appId);
    const roots = await this.roots(app);
    const exp = Math.floor(Date.now() / VIEW_BUCKET_MS) * VIEW_BUCKET_MS + 2 * VIEW_BUCKET_MS;
    const files: ProjectFileDto[] = [];
    const dto = roots.map((root, index) => {
      let truncated = false;
      for (const dir of PROJECT_DIRS) {
        const found = walk(join(root.path, dir), dir, 0, MAX_FILES);
        truncated ||= found.truncated;
        files.push(...found.files.map((f) => ({ ...f, root: index })));
      }
      return { index, label: root.label, path: root.path, viewBase: `/view/${this.sign(app.id, index, exp)}/`, truncated };
    });
    return { roots: dto, files };
  }

  /**
   * 보기 주소의 파일을 찾는다. docs/·design/ 밖, 숨김 파일, 루트 밖을 가리키는 심볼릭 링크는 거부한다.
   * 목록에 없는 보조 파일(js, css, 글꼴)도 같은 폴더 안이면 내보낸다. 디자인 HTML이 상대 경로로 불러온다.
   */
  async resolve(token: string, segments: string[]): Promise<string> {
    const { appId, root } = this.verify(token);
    const [dir, ...rest] = segments;
    if (!PROJECT_DIRS.includes(dir as (typeof PROJECT_DIRS)[number]) || !rest.length) throw new NotFoundException('docs/나 design/ 아래 파일만 열 수 있다');
    if (rest.some((s) => !s || s.startsWith('.'))) throw new ForbiddenException('숨김 파일과 상위 경로는 열 수 없다');
    const roots = await this.roots(await this.apps.get(appId));
    const base = roots[root] ? join(roots[root].path, dir) : null;
    const full = base ? join(base, ...rest) : null;
    if (!base || !full || !existsSync(full)) throw new NotFoundException('파일이 없다');
    const real = realpathSync(full);
    if (!real.startsWith(realpathSync(base) + sep) || !lstatSync(real).isFile()) throw new ForbiddenException('폴더 밖 파일은 열 수 없다');
    return real;
  }

  private sign(appId: number, root: number, exp: number): string {
    const body = `${appId}-${root}-${exp}`;
    return `${body}-${this.mac(body)}`;
  }

  private verify(token: string): { appId: number; root: number } {
    const m = /^(\d+)-(\d+)-(\d+)-([0-9a-f]{32})$/.exec(token);
    if (!m) throw new ForbiddenException('보기 주소가 올바르지 않다');
    const [, appId, root, exp, mac] = m;
    const expected = Buffer.from(this.mac(`${appId}-${root}-${exp}`));
    if (!timingSafeEqual(expected, Buffer.from(mac))) throw new ForbiddenException('보기 주소가 올바르지 않다');
    if (Number(exp) < Date.now()) throw new ForbiddenException('보기 주소가 만료됐다. 문서 탭을 다시 연다');
    return { appId: Number(appId), root: Number(root) };
  }

  private mac(body: string): string {
    return createHmac('sha256', this.config.token).update(`view:${body}`).digest('hex').slice(0, 32);
  }
}

/** 숨김·node_modules·심볼릭 링크는 건너뛰고, 보여 줄 종류의 파일만 모은다 */
function walk(abs: string, rel: string, depth: number, max: number): { files: Omit<ProjectFileDto, 'root'>[]; truncated: boolean } {
  const files: Omit<ProjectFileDto, 'root'>[] = [];
  let truncated = false;
  const visit = (a: string, r: string, d: number) => {
    let entries;
    try {
      entries = readdirSync(a, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const childAbs = join(a, e.name);
      const childRel = `${r}/${e.name}`;
      if (e.isDirectory()) {
        if (d < MAX_DEPTH && !SKIP_DIRS.has(e.name)) visit(childAbs, childRel, d + 1);
        continue;
      }
      const kind = e.isFile() ? kindOf(e.name) : null;
      if (!kind) continue;
      if (files.length >= max) {
        truncated = true;
        return;
      }
      const st = lstatSync(childAbs);
      files.push({ path: childRel, kind, size: st.size, modifiedAt: st.mtime.toISOString() });
    }
  };
  if (existsSync(abs) && lstatSync(abs).isDirectory()) visit(abs, rel, depth);
  return { files, truncated };
}
