import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { DeployEnv } from '@hub/shared';
import { App } from '../apps/app.entity';

/** 앱의 저장소 하나. 하루알바처럼 backend, frontend가 따로 있으면 여러 개다 */
@Entity('app_repos')
@Index(['appId', 'path'], { unique: true })
export class AppRepo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'app_id', type: 'int' })
  appId: number;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app: App;

  /** backend, frontend 같은 짧은 이름. 기본은 폴더 이름 */
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  path: string;

  /** owner/repo. GitHub 원격이 없으면 null */
  @Column({ type: 'text', nullable: true })
  github: string | null;

  @Column({ name: 'default_branch', type: 'text', default: 'main' })
  defaultBranch: string;

  /** 비어 있으면 앱의 setup_cmd */
  @Column({ name: 'setup_cmd', type: 'text', nullable: true })
  setupCmd: string | null;

  /** 비어 있으면 앱의 check_cmd */
  @Column({ name: 'check_cmd', type: 'text', nullable: true })
  checkCmd: string | null;

  /** GitHub Actions 워크플로 이름 → 배포 환경 */
  @Column({ name: 'deploy_rules', type: 'jsonb', default: () => "'[]'" })
  deployRules: Array<{ workflow: string; env: DeployEnv }>;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
