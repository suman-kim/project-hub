import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, sep } from 'node:path';
import type { ProjectFileDto, ProjectFileKind, ProjectFilesDto } from '@hub/shared';
import { cleanFileName } from '../../common/stored-files';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';

/** 프로젝트 문서는 docs/, 디자인은 design/에 둔다 */
export const PROJECT_DIRS = ['docs', 'design'] as const;
/** 문서 탭에서 파일을 올리고 지울 수 있는 폴더 */
export const WRITABLE_DIR = 'docs';
/** docs/ 안에서 Hub가 save_spec 사본을 다시 쓰는 폴더. 올리기·지우기를 막는다 */
export const HUB_SPEC_DIR = 'hub';

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
 * docs/ 아래 경로를 조각으로 나눈다. docs/ 밖, 숨김·상위 경로(.으로 시작), docs/hub/는 거부한다.
 * @param rel 루트 기준 경로 (예: docs/설계, docs/설계/a.pdf)
 */
export function docsSegments(rel: string): string[] {
  const segs = rel.normalize('NFC').split('/').filter(Boolean);
  if (segs[0] !== WRITABLE_DIR) throw new BadRequestException('docs/ 아래에만 올리고 지울 수 있다');
  if (segs.some((s) => s.startsWith('.'))) throw new BadRequestException('숨김 폴더와 상위 경로는 쓸 수 없다');
  if (segs[1] === HUB_SPEC_DIR) throw new ForbiddenException('docs/hub/는 Hub가 인수인계·기획 사본을 다시 쓰는 곳이라 올리거나 지울 수 없다');
  return segs;
}

/** a가 b와 같거나 b 안에 있는지 (둘 다 실제 경로) */
const within = (a: string, b: string) => a === b || a.startsWith(b + sep);

/**
 * 앱 폴더와 등록된 저장소의 docs/·design/을 읽는다. 문서 탭에서 docs/에 파일을 올리고 지울 수도 있다(docs/hub/는 막는다).
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
        // docs/에는 볼 수 없는 파일(xlsx, zip 등)도 내려받기용으로 보인다. design/은 시안의 js·css·글꼴이 섞여 있어 볼 수 있는 것만
        const found = walk(join(root.path, dir), dir, 0, MAX_FILES, dir === WRITABLE_DIR);
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

  /**
   * docs/ 아래 폴더에 파일을 올린다. 같은 이름이 있으면 덮어쓰지 않고 "이름 (2).pdf"처럼 번호를 붙인다. 없는 폴더는 만든다.
   * 저장소 안에 새 파일로 생기니 git 변경으로 잡힌다(커밋은 사용자가 한다).
   * @param appId 앱 id
   * @param rootIndex 루트(앱 폴더·저장소) 번호. 목록의 roots[].index
   * @param dir 올릴 폴더 (docs 또는 docs/하위)
   * @param rawName 브라우저가 보낸 파일 이름
   * @param body 파일 내용
   */
  async upload(appId: number, rootIndex: number, dir: string, rawName: string, body: Buffer): Promise<ProjectFileDto> {
    const root = await this.rootOf(appId, rootIndex);
    const segs = docsSegments(dir);
    const name = cleanFileName(rawName);
    if (!name || name.startsWith('.')) throw new BadRequestException('파일 이름이 비었거나 점(.)으로 시작한다');
    const target = join(root.path, ...segs);
    // 만들기 전에, 이미 있는 가장 가까운 상위 폴더가 docs/ 안(또는 docs/가 아직 없으면 루트)인지 본다. 링크로 밖에 쓰지 않게
    let probe = target;
    while (!existsSync(probe)) probe = dirname(probe);
    const docsReal = () => realpathSync(join(root.path, WRITABLE_DIR));
    const probeReal = realpathSync(probe);
    if (!(probeReal === root.path || (existsSync(join(root.path, WRITABLE_DIR)) && within(probeReal, docsReal()))))
      throw new ForbiddenException('docs/ 밖에는 올릴 수 없다');
    mkdirSync(target, { recursive: true });
    // 만든 뒤에도 다시 본다: docs/ 자체가 저장소 밖을 가리키는 링크면 거절
    const realDocs = docsReal();
    const realTarget = realpathSync(target);
    if (!realDocs.startsWith(root.path + sep)) throw new ForbiddenException('docs/가 저장소 밖을 가리킨다');
    if (!within(realTarget, realDocs) || !lstatSync(realTarget).isDirectory()) throw new ForbiddenException('docs/ 밖에는 올릴 수 없다');
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let final = name;
    for (let n = 2; existsSync(join(realTarget, final)); n++) {
      if (n > 999) throw new ConflictException('같은 이름의 파일이 너무 많다');
      final = `${stem} (${n})${ext}`;
    }
    writeFileSync(join(realTarget, final), body, { flag: 'wx' });
    return { root: rootIndex, path: [...segs, final].join('/'), kind: kindOf(final) ?? 'other', size: body.length, modifiedAt: new Date().toISOString() };
  }

  /**
   * docs/ 아래 파일 하나를 지운다. 폴더·링크·docs/hub/는 지우지 않는다. git에 없는 파일은 되돌릴 수 없다(화면이 먼저 확인을 받는다).
   * @param appId 앱 id
   * @param rootIndex 루트 번호
   * @param path 루트 기준 파일 경로 (docs/…)
   */
  async remove(appId: number, rootIndex: number, path: string): Promise<void> {
    const root = await this.rootOf(appId, rootIndex);
    const segs = docsSegments(path);
    if (segs.length < 2) throw new BadRequestException('지울 파일 경로가 필요하다');
    const full = join(root.path, ...segs);
    if (!existsSync(full)) throw new NotFoundException('파일이 없다');
    if (!lstatSync(full).isFile()) throw new ForbiddenException('파일만 지울 수 있다 (폴더·링크는 지우지 않는다)');
    if (!within(realpathSync(dirname(full)), realpathSync(join(root.path, WRITABLE_DIR)))) throw new ForbiddenException('docs/ 밖 파일은 지울 수 없다');
    unlinkSync(full);
  }

  /**
   * @param appId 앱 id
   * @param rootIndex 루트 번호
   */
  private async rootOf(appId: number, rootIndex: number): Promise<Root> {
    const root = (await this.roots(await this.apps.get(appId)))[rootIndex];
    if (!root) throw new NotFoundException(`저장소 ${rootIndex}번이 없다`);
    return root;
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
/**
 * @param abs 읽을 폴더
 * @param rel 목록에 쓸 경로 앞부분 (docs, design)
 * @param depth 지금 깊이
 * @param max 최대 파일 수
 * @param withOther 볼 수 없는 파일도 other로 넣을지 (docs/만)
 */
function walk(abs: string, rel: string, depth: number, max: number, withOther = false): { files: Omit<ProjectFileDto, 'root'>[]; truncated: boolean } {
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
      const kind = e.isFile() ? (kindOf(e.name) ?? (withOther ? 'other' : null)) : null;
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
