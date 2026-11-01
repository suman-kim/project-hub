import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { TaskAssignee, TaskSize, TaskStatus, TaskType } from '@hub/shared';
import { AppRepo } from '../repos/app-repo.entity';
import { App } from '../apps/app.entity';
import { Idea } from '../ideas/idea.entity';

@Entity('tasks')
@Index(['appId', 'status'])
export class Task {
  /** 앱 코드 + 앱별 순번. 예: LK-57 */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ name: 'app_id', type: 'int' })
  appId: number;

  @ManyToOne(() => App, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'app_id' })
  app: App;

  /** 기획(ideas)에서 승인되어 생긴 task */
  @Column({ name: 'idea_id', type: 'int', nullable: true })
  ideaId: number | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'idea_id' })
  idea: Idea | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 16, default: 'todo' })
  status: TaskStatus;

  /** feature, bug, chore */
  @Column({ type: 'varchar', length: 8, default: 'feature' })
  type: TaskType;

  /** claude: Hub runner·Claude 세션이 한다, me: 사용자가 직접 한다 */
  @Column({ type: 'varchar', length: 8, default: 'claude' })
  assignee: TaskAssignee;

  /** 1(높음)~3(낮음) */
  @Column({ type: 'smallint', nullable: true })
  priority: number | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  /** 앱 단계 key */
  @Column({ type: 'varchar', length: 32, nullable: true })
  stage: string | null;

  /** 저장소가 여러 개인 앱에서 이 task가 어느 저장소의 일인지 */
  @Column({ name: 'repo_id', type: 'int', nullable: true })
  repoId: number | null;

  @ManyToOne(() => AppRepo, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'repo_id' })
  repo: AppRepo | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  size: TaskSize | null;

  /** Task Master 태그를 옮겨 담는다. */
  @Column({ type: 'text', nullable: true })
  tag: string | null;

  @Column({ name: 'depends_on', type: 'text', array: true, default: () => "'{}'" })
  dependsOn: string[];

  @Column({ type: 'text', nullable: true })
  branch: string | null;

  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl: string | null;

  /** notes(진행 메모), taskmaster(가져온 원본 정보) 등 */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
