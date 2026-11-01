import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DeployEnv, DeploySource, DeployStatus } from '@hub/shared';
import { App } from '../apps/app.entity';
import { AppRepo } from '../repos/app-repo.entity';

/** 배포 한 건. GitHub(배포 기록, Actions)에서 가져오거나 화면·Claude가 직접 남긴다 */
@Entity('deployments')
@Index(['source', 'externalId'], { unique: true })
@Index(['appId', 'env', 'startedAt'])
export class Deployment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'app_id', type: 'int' })
  appId: number;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app: App;

  @Column({ name: 'repo_id', type: 'int', nullable: true })
  repoId: number | null;

  @ManyToOne(() => AppRepo, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'repo_id' })
  repo: AppRepo | null;

  @Column({ type: 'varchar', length: 20 })
  source: DeploySource;

  /** 출처에서의 ID (GitHub deployment id, workflow run id). 직접 남긴 것은 Hub가 만든다 */
  @Column({ name: 'external_id', type: 'text' })
  externalId: string;

  /** 원래 환경 이름. 예: "Cyphers Meta / production", "서버 배포" */
  @Column({ type: 'text' })
  environment: string;

  @Column({ type: 'varchar', length: 12 })
  env: DeployEnv;

  @Column({ type: 'text', nullable: true })
  version: string | null;

  @Column({ type: 'text', nullable: true })
  sha: string | null;

  @Column({ type: 'varchar', length: 12 })
  status: DeployStatus;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  raw: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
