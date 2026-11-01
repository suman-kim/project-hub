import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { SessionOrigin } from '@hub/shared';
import { App } from '../apps/app.entity';
import { Run } from '../runner/run.entity';
import { Task } from '../tasks/task.entity';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'claude_session_id', type: 'text', unique: true })
  claudeSessionId: string;

  @Column({ name: 'app_id', type: 'int', nullable: true })
  appId: number | null;

  @ManyToOne(() => App, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'app_id' })
  app: App | null;

  @Column({ name: 'task_id', type: 'varchar', length: 32, nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  /** Hub가 띄운 세션이면 runner가 채운다. */
  @Column({ name: 'run_id', type: 'int', nullable: true })
  runId: number | null;

  @ManyToOne(() => Run, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'run_id' })
  run: Run | null;

  /** local: 직접 연 세션, hub: Hub가 띄운 세션 */
  @Column({ type: 'varchar', length: 8, default: 'local' })
  origin: SessionOrigin;

  @Column({ type: 'text', default: '' })
  cwd: string;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
