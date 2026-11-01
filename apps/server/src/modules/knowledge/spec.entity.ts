import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { SpecKind } from '@hub/shared';
import { Idea } from '../ideas/idea.entity';
import { Task } from '../tasks/task.entity';

@Entity('specs')
@Index(['taskId'])
@Index(['ideaId'])
export class Spec {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'idea_id', type: 'int', nullable: true })
  ideaId: number | null;

  @ManyToOne(() => Idea, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'idea_id' })
  idea: Idea | null;

  @Column({ name: 'task_id', type: 'varchar', length: 32, nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  /** spec: 기획 명세, handoff: 인수인계 */
  @Column({ type: 'varchar', length: 16 })
  kind: SpecKind;

  @Column({ type: 'text' })
  title: string;

  /** markdown */
  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
