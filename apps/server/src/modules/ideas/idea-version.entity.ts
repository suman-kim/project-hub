import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { IdeaBody } from '@hub/shared';
import { Run } from '../runner/run.entity';
import { Idea } from './idea.entity';

export type { IdeaBody };

@Entity('idea_versions')
@Unique(['ideaId', 'version'])
export class IdeaVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'idea_id', type: 'int' })
  ideaId: number;

  @ManyToOne(() => Idea, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'idea_id' })
  idea: Idea;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'jsonb' })
  body: IdeaBody;

  @Column({ name: 'revision_note', type: 'text', nullable: true })
  revisionNote: string | null;

  /** 자동 생성한 run */
  @Column({ name: 'run_id', type: 'int', nullable: true })
  runId: number | null;

  @ManyToOne(() => Run, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'run_id' })
  run: Run | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
