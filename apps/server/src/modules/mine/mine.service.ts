import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Brackets, IsNull, Repository } from 'typeorm';
import type { MineDto, MyDocDto, MyDocFileDto, MyDocKind, MyDocRenew, MySecretMode, MyTodoDto } from '@hub/shared';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { AppsService } from '../apps/apps.service';
import { DocFilesService } from './doc-files.service';
import { MyDoc } from './my-doc.entity';
import { MyTodo } from './my-todo.entity';
import { SecretBox } from './secret-box';

export const DOC_KIND_LABEL: Record<MyDocKind, string> = {
  store: '스토어 개발자 계정',
  apikey: '외부 API 키',
  billing: '결제·구독',
  domain: '도메인·DNS',
  legal: '법무 문서',
  memo: '자유 메모',
};

/** 새 문서의 기본값: 계정·키 문서는 위치만 적기로 시작하고, 결제는 "결제", 스토어 계정은 "갱신"으로 부른다 */
const SECRET0: Record<MyDocKind, MySecretMode> = { store: 'ref', apikey: 'ref', billing: 'none', domain: 'none', legal: 'none', memo: 'none' };
const RENEW0: Partial<Record<MyDocKind, MyDocRenew>> = { billing: '결제', store: '갱신' };

export function toTodoDto(t: MyTodo): MyTodoDto {
  return {
    id: t.id,
    key: `ME-${t.id}`,
    parentId: t.parentId,
    title: t.title,
    dueDate: t.dueDate,
    priority: (t.priority as 1 | 2 | 3) ?? 2,
    done: !!t.doneAt,
    doneAt: t.doneAt?.toISOString() ?? null,
    docId: t.docId,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * @param d 문서
 * @param files 그 문서의 첨부 목록 (DocFilesService.byOwner)
 */
export function toDocDto(d: MyDoc, files: MyDocFileDto[] = []): MyDocDto {
  return {
    id: d.id,
    appId: d.appId,
    kind: d.kind,
    title: d.title,
    fields: d.fields ?? [],
    secretMode: d.secretMode,
    secretRef: d.secretRef,
    hasValue: !!d.secretEnc,
    secretLast4: d.secretEnc ? d.secretLast4 : null,
    expiresOn: d.expiresOn,
    renewLabel: d.renewLabel,
    memo: d.memo,
    files,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export interface TodoPatch {
  title?: string;
  dueDate?: string | null;
  priority?: 1 | 2 | 3;
  done?: boolean;
  docId?: number | null;
}

export interface DocPatch {
  kind?: MyDocKind;
  title?: string;
  fields?: Array<[string, string]>;
  secretMode?: MySecretMode;
  secretRef?: string;
  expiresOn?: string | null;
  renewLabel?: MyDocRenew;
  memo?: string;
}

/**
 * 내 업무: 앱에 묶이지 않는 내 할 일과 보관함(계정·키·결제·도메인 문서).
 * 보관함 문서는 app_id로 공통(null)과 앱 전용을 나눈다. 고치기·키 값·첨부는 문서 id로 하니 둘 다 같은 코드를 쓴다.
 */
@Injectable()
export class MineService {
  private readonly box: SecretBox;

  constructor(
    @Inject(HUB_CONFIG) config: HubConfig,
    @InjectRepository(MyTodo) private readonly todos: Repository<MyTodo>,
    @InjectRepository(MyDoc) private readonly docs: Repository<MyDoc>,
    private readonly files: DocFilesService,
    private readonly apps: AppsService,
  ) {
    this.box = new SecretBox(join(config.hubHome, 'secret.key'));
  }

  /** 할 일과 보관함 문서 전부(공통 + 앱 전용). 화면이 appId로 나눠 보여 준다(오늘 화면의 만료 알림은 둘 다 쓴다) */
  async all(): Promise<MineDto> {
    const [todos, docs, files] = await Promise.all([this.todos.find({ order: { id: 'ASC' } }), this.docs.find({ order: { id: 'ASC' } }), this.files.byOwner()]);
    return { todos: todos.map(toTodoDto), docs: docs.map((d) => toDocDto(d, files.get(d.id))) };
  }

  private async todo(id: number): Promise<MyTodo> {
    const t = await this.todos.findOneBy({ id });
    if (!t) throw new NotFoundException(`할 일 ME-${id}가 없다`);
    return t;
  }

  /**
   * 첨부 목록까지 담은 문서 하나. 문서를 바꾸는 응답은 모두 이걸 돌려줘 화면 캐시에서 첨부가 빠지지 않게 한다.
   * @param id 문서 id
   */
  async docDto(id: number): Promise<MyDocDto> {
    return this.withFiles(await this.doc(id));
  }

  private async withFiles(d: MyDoc): Promise<MyDocDto> {
    return toDocDto(d, (await this.files.byOwner([d.id])).get(d.id));
  }

  private async doc(id: number): Promise<MyDoc> {
    const d = await this.docs.findOneBy({ id });
    if (!d) throw new NotFoundException(`문서 ${id}가 없다`);
    return d;
  }

  /** parentId가 있으면 그 할 일의 하위 할 일. 하위 할 일 아래에는 더 만들지 않는다 */
  async addTodo(title: string, parentId: number | null = null): Promise<MyTodoDto> {
    if (parentId !== null) {
      const parent = await this.todo(parentId);
      if (parent.parentId !== null) throw new BadRequestException('하위 할 일 아래에는 하위 할 일을 만들 수 없다');
    }
    return toTodoDto(await this.todos.save(this.todos.create({ title: title.trim(), priority: 2, parentId })));
  }

  /**
   * 상위 할 일을 완료하면 남은 하위 할 일도 같은 시각으로 완료한다.
   * 상위 완료를 되돌리면 그때 같이 완료된 하위만 되돌린다(먼저 끝낸 하위는 그대로).
   * 하위 할 일은 제목과 완료만 바꾼다.
   */
  async updateTodo(id: number, p: TodoPatch): Promise<MyTodoDto> {
    const t = await this.todo(id);
    if (t.parentId !== null && (p.dueDate !== undefined || p.priority !== undefined || p.docId !== undefined)) {
      throw new BadRequestException('하위 할 일은 제목과 완료만 바꾼다');
    }
    if (p.title !== undefined) {
      if (!p.title.trim()) throw new BadRequestException('제목이 비었다');
      t.title = p.title.trim();
    }
    if (p.dueDate !== undefined) t.dueDate = p.dueDate;
    if (p.priority !== undefined) t.priority = p.priority;
    if (p.docId !== undefined) {
      if (p.docId !== null) await this.doc(p.docId);
      t.docId = p.docId;
    }
    if (p.done === true && !t.doneAt) {
      t.doneAt = new Date();
      if (t.parentId === null) await this.todos.update({ parentId: t.id, doneAt: IsNull() }, { doneAt: t.doneAt });
    } else if (p.done === false && t.doneAt) {
      if (t.parentId === null) await this.todos.update({ parentId: t.id, doneAt: t.doneAt }, { doneAt: null });
      t.doneAt = null;
    }
    return toTodoDto(await this.todos.save(t));
  }

  async deleteTodo(id: number): Promise<void> {
    await this.todos.remove(await this.todo(id));
  }

  /**
   * @param kind 문서 종류 (기본 키 방식·만료 이름을 정한다)
   * @param title 제목
   * @param appId 앱 전용이면 그 앱 id(없는 앱이면 404), 모든 앱 공통이면 null
   */
  async addDoc(kind: MyDocKind, title: string, appId: number | null = null): Promise<MyDocDto> {
    if (appId !== null) await this.apps.get(appId);
    return toDocDto(await this.docs.save(this.docs.create({ appId, kind, title: title.trim(), fields: [], secretMode: SECRET0[kind], renewLabel: RENEW0[kind] ?? '만료' })));
  }

  /** 값 저장에서 다른 방식으로 바꾸면 저장한 값을 지운다(화면이 먼저 확인을 받는다) */
  async updateDoc(id: number, p: DocPatch): Promise<MyDocDto> {
    const d = await this.doc(id);
    if (p.kind !== undefined) d.kind = p.kind;
    if (p.title !== undefined) d.title = p.title;
    if (p.fields !== undefined) d.fields = p.fields;
    if (p.secretRef !== undefined) d.secretRef = p.secretRef;
    if (p.expiresOn !== undefined) d.expiresOn = p.expiresOn;
    if (p.renewLabel !== undefined) d.renewLabel = p.renewLabel;
    if (p.memo !== undefined) d.memo = p.memo;
    if (p.secretMode !== undefined && p.secretMode !== d.secretMode) {
      d.secretMode = p.secretMode;
      if (p.secretMode !== 'value') {
        d.secretEnc = null;
        d.secretLast4 = null;
      }
    }
    return this.withFiles(await this.docs.save(d));
  }

  /** 키 값 저장. 빈 값이면 지운다 */
  async setSecret(id: number, value: string): Promise<MyDocDto> {
    const d = await this.doc(id);
    if (d.secretMode !== 'value') throw new ConflictException('값 저장 방식인 문서만 값을 넣을 수 있다');
    d.secretEnc = value ? this.box.seal(value) : null;
    d.secretLast4 = value ? value.slice(-4) : null;
    return this.withFiles(await this.docs.save(d));
  }

  /** 보기·복사를 누를 때만 원문을 준다. Claude(MCP·세션 맥락)에는 넘기지 않는다 */
  async getSecret(id: number): Promise<{ value: string }> {
    const d = await this.doc(id);
    return { value: d.secretEnc ? this.box.open(d.secretEnc) : '' };
  }

  /** 첨부 목록은 CASCADE로 지워지고, 첨부 내용 파일은 문서를 지운 뒤에 지운다 */
  async deleteDoc(id: number): Promise<void> {
    const d = await this.doc(id);
    const stored = await this.files.storedNamesOf(id);
    await this.docs.remove(d);
    this.files.unlink(stored);
  }

  /**
   * 세션 맥락에 넣을 보관함 줄: 모든 앱 공통 문서와 그 앱 전용 문서, 만료가 가까운 것부터. 값 원문 대신 끝 4자리만.
   * @param appId 세션이 도는 앱
   * @param limit 최대 줄 수
   */
  async contextDocs(appId: number, limit: number): Promise<Array<{ title: string; kind: string; secret: string; expires: string | null; scope: '공통' | '이 앱' }>> {
    const docs = await this.docs
      .createQueryBuilder('d')
      .where(new Brackets((w) => w.where('d.app_id IS NULL').orWhere('d.app_id = :appId', { appId })))
      .orderBy('d.expires_on', 'ASC', 'NULLS LAST')
      .addOrderBy('d.updated_at', 'DESC')
      .limit(limit)
      .getMany();
    return docs.map((d) => ({
      title: d.title || '제목 없음',
      kind: DOC_KIND_LABEL[d.kind] ?? d.kind,
      scope: d.appId === null ? '공통' : '이 앱',
      secret: d.secretMode === 'ref' && d.secretRef ? `위치: ${d.secretRef}` : d.secretMode === 'value' && d.secretEnc ? `값은 Hub에 저장(끝 4자리 ${d.secretLast4})` : '',
      expires: d.expiresOn ? `${d.renewLabel} ${d.expiresOn}` : null,
    }));
  }
}
