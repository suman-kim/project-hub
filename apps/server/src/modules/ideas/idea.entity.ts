import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { IdeaKind, IdeaStatus } from '@hub/shared';
import { App } from '../apps/app.entity';

@Entity('ideas')
export class Idea {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 8, default: 'feature' })
  kind: IdeaKind;

  /** 새 앱 기획(kind=app)은 승인해서 앱이 생기면 그 앱을 가리킨다. 그 전에는 null */
  @Column({ name: 'app_id', type: 'int', nullable: true })
  appId: number | null;

  @ManyToOne(() => App, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'app_id' })
  app: App | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: IdeaStatus;

  @Column({ name: 'current_version', type: 'int', default: 1 })
  currentVersion: number;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
