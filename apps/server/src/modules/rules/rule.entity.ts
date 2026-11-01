import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { RuleScope } from '@hub/shared';
import { App } from '../apps/app.entity';

@Entity('rules')
@Index(['scope', 'appId', 'position'])
export class Rule {
  @PrimaryGeneratedColumn()
  id: number;

  /** global: 모든 세션, app: 그 앱에서만 */
  @Column({ type: 'varchar', length: 8 })
  scope: RuleScope;

  @Column({ name: 'app_id', type: 'int', nullable: true })
  appId: number | null;

  @ManyToOne(() => App, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'app_id' })
  app: App | null;

  /** 같은 범위 안에서의 순서 (1부터) */
  @Column({ type: 'int' })
  position: number;

  /** markdown. 여러 줄이면 파일에서는 들여쓴 이어지는 줄이 된다. */
  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
