import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DEFAULT_STAGES, type AppLifecycle, type AppStage } from '@hub/shared';

@Entity('apps')
export class App {
  @PrimaryGeneratedColumn()
  id: number;

  /** LK, HR 같은 2~4자 코드. task ID 앞부분이 된다. */
  @Column({ type: 'varchar', length: 8, unique: true })
  code: string;

  @Column({ type: 'text' })
  name: string;

  /** 앱 폴더. 저장소가 하나면 그 저장소, 여러 개면 저장소들이 들어 있는 상위 폴더 */
  @Column({ name: 'repo_path', type: 'text', nullable: true })
  repoPath: string | null;

  @Column({ name: 'default_branch', type: 'text', default: 'main' })
  defaultBranch: string;

  /** 작업 폴더 경로에 이 이름 중 하나가 있으면 이 앱으로 판별한다. */
  @Column({ name: 'folder_names', type: 'text', array: true, default: () => "'{}'" })
  folderNames: string[];

  @Column({ name: 'setup_cmd', type: 'text', nullable: true })
  setupCmd: string | null;

  /** push 전에 worktree에서 돌리는 검사 명령(화면의 "가드"). 실패하면 PR을 만들지 않는다 */
  @Column({ name: 'check_cmd', type: 'text', nullable: true })
  checkCmd: string | null;

  /** worktree를 만들 곳. null이면 ~/.hub/worktrees */
  @Column({ name: 'worktree_root', type: 'text', nullable: true })
  worktreeRoot: string | null;

  @Column({ name: 'idea_cron', type: 'text', nullable: true })
  ideaCron: string | null;

  /** 켜져 있으면 doing·input task가 연결되지 않은 세션의 파일 수정과 Bash를 막는다. */
  @Column({ name: 'guard_enabled', type: 'boolean', default: true })
  guardEnabled: boolean;

  /** claude -p --allowedTools. 비어 있으면(null) Hub 기본 목록을 쓴다. */
  @Column({ name: 'allowed_tools', type: 'text', array: true, nullable: true })
  allowedTools: string[] | null;

  @Column({ name: 'direction_note', type: 'text', nullable: true })
  directionNote: string | null;

  @Column({ name: 'next_task_seq', type: 'int', default: 1 })
  nextTaskSeq: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** github, production, staging, appStore, playStore, docs 등 이름 → 주소 */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  links: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  stack: string | null;

  /** 이 앱의 개발 단계. 기본 6단계이고 앱마다 바꿀 수 있다 */
  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_STAGES)}'` })
  stages: AppStage[];

  /** 현재 단계 key */
  @Column({ type: 'varchar', length: 32, nullable: true })
  stage: string | null;

  @Column({ type: 'varchar', length: 12, default: 'developing' })
  lifecycle: AppLifecycle;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
