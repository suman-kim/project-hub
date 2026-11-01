import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Session } from './session.entity';

/**
 * 대시보드에서 일하는 중인 세션에 보낸 메시지. 세션의 다음 hook(도구 사용 뒤, 턴 끝, 다음 입력) 응답에 실어 Claude에게 전달한다.
 */
@Entity('session_messages')
@Index(['sessionId', 'id'])
export class SessionMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', type: 'int' })
  sessionId: number;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Session;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** 전달한 시각. null이면 아직 전달 대기 */
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** 전달한 hook: PostToolUse, Stop, UserPromptSubmit */
  @Column({ name: 'delivered_via', type: 'varchar', length: 24, nullable: true })
  deliveredVia: string | null;
}
