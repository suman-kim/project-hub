import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { ActivityActor } from '@hub/shared';
import { App } from '../apps/app.entity';

/** 앱 히스토리 한 줄. 덧붙이기만 한다 */
@Entity('activities')
@Index(['appId', 'at'])
export class Activity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** 새 앱 기획처럼 아직 앱이 없는 일은 null */
  @Column({ name: 'app_id', type: 'int', nullable: true })
  appId: number | null;

  @ManyToOne(() => App, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'app_id' })
  app: App | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  at: Date;

  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ type: 'varchar', length: 8 })
  actor: ActivityActor;

  @Column({ name: 'ref_type', type: 'varchar', length: 16, nullable: true })
  refType: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  data: Record<string, unknown>;
}
