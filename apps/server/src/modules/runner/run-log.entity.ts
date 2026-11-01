import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Run } from './run.entity';

@Entity('run_logs')
@Unique(['runId', 'seq'])
export class RunLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'run_id', type: 'int' })
  runId: number;

  @ManyToOne(() => Run, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: Run;

  /** run 안에서 1부터 늘어나는 순번. GET /api/runs/:id/logs?after=seq 로 이어 읽는다. */
  @Column({ type: 'int' })
  seq: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  ts: Date;

  /** system, assistant, tool_use, tool_result, result, rate_limit, stderr, hub */
  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'text', default: '' })
  text: string;

  /** stream-json 원본 (비밀값은 가림) */
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;
}
