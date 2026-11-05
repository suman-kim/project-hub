import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { App } from '../apps/app.entity';

/**
 * 앱별 노트: 노션처럼 자유롭게 쓰는 글. 명령어 보관, 간단한 메모, 할 일 등.
 * 본문은 markdown으로 둔다. 블록 편집기가 markdown으로 읽고 쓰고, 나중에 Claude 맥락이나 docs/로 내보내기 쉽다.
 */
@Entity({ name: 'app_notes', comment: '앱별 노트. 명령어 보관, 간단한 메모, 할 일 등 자유 글. 본문은 markdown' })
export class AppNote {
  @PrimaryGeneratedColumn({ comment: '노트 id' })
  id: number;

  /** 노트가 속한 앱. 앱을 지우면 함께 지워진다 */
  @Index()
  @Column({ name: 'app_id', type: 'int', comment: '노트가 속한 앱 (apps.id). 앱을 지우면 함께 지운다' })
  appId: number;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app: App;

  /** 노트를 묶는 폴더 이름. 비우면 폴더 없음 */
  @Column({ type: 'text', default: '', comment: '노트를 묶는 폴더 이름 (예: 명령어, 할 일). 비우면 폴더 없음' })
  folder: string;

  /** 제목. 비우면 화면에서 본문 첫 줄을 보여 준다 */
  @Column({ type: 'text', default: '', comment: '제목. 비우면 화면에서 본문 첫 줄을 보여 준다' })
  title: string;

  /** 본문 markdown */
  @Column({ type: 'text', default: '', comment: '본문 (markdown)' })
  body: string;

  /** 목록 맨 위 고정 */
  @Column({ type: 'boolean', default: false, comment: '목록 맨 위 고정' })
  pinned: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', comment: '만든 시각' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', comment: '마지막 수정 시각' })
  updatedAt: Date;
}
