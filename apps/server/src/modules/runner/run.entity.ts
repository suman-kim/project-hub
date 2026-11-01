import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { RunDto, RunKind, RunResult, RunStatus } from '@hub/shared';
import { Task } from '../tasks/task.entity';

export type { RunKind, RunResult } from '@hub/shared';

@Entity('runs')
@Index(['taskId'])
@Index(['status'])
export class Run {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_id', type: 'varchar', length: 32, nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @Column({ type: 'varchar', length: 16 })
  kind: RunKind;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: RunStatus;

  @Column({ name: 'claude_session_id', type: 'text', nullable: true })
  claudeSessionId: string | null;

  @Column({ name: 'worktree_path', type: 'text', nullable: true })
  worktreePath: string | null;

  @Column({ type: 'text', nullable: true })
  branch: string | null;

  /** 최초 실행과 재개마다 claude가 알려 준 비용의 합 */
  @Column({ name: 'cost_usd', type: 'numeric', precision: 10, scale: 4, default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  costUsd: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  result: RunResult;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export function toRunDto(r: Run): RunDto {
  return {
    id: r.id,
    taskId: r.taskId,
    kind: r.kind,
    status: r.status,
    claudeSessionId: r.claudeSessionId,
    worktreePath: r.worktreePath,
    branch: r.branch,
    costUsd: r.costUsd,
    result: r.result,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

type RunTargetFields = Pick<Run, 'id' | 'taskId' | 'kind' | 'result'>;

/**
 * 다시 실행하면 같은 값이 되는 run의 대상(화면의 "다시 실행"과 같은 기준).
 * 세션 이어서 하기는 그 세션, task run은 task, 새 앱 시작은 앱, 기획 수정은 그 기획, 새 앱 기획 생성은 하나로, 기능 기획 생성은 앱마다.
 */
export function runTarget(r: Pick<Run, 'taskId' | 'kind' | 'result'>): string | null {
  if (r.kind === 'session') return r.result.session ? `session:${r.result.session.sessionId}` : null;
  if (r.taskId) return `task:${r.taskId}`;
  if (r.kind === 'bootstrap') return r.result.bootstrap ? `bootstrap:${r.result.bootstrap.appId}` : null;
  const idea = r.result.idea;
  if (!idea) return null;
  if (idea.ideaId) return `revise:${idea.ideaId}`;
  if (idea.kind === 'app') return 'concept';
  return idea.appId ? `ideas:${idea.appId}` : null;
}

/** 실패·중지 run마다, 뒤에 같은 대상으로 완료된 첫 run id. done은 id 오름차순이어야 한다 */
export function resolveEnded(ended: RunTargetFields[], done: RunTargetFields[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of ended) {
    const key = runTarget(r);
    const fix = key ? done.find((d) => d.id > r.id && runTarget(d) === key) : undefined;
    if (fix) out.set(r.id, fix.id);
  }
  return out;
}
