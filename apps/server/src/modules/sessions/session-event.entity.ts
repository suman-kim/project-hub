import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Session } from './session.entity';

@Entity('session_events')
@Index(['sessionId', 'id'])
export class SessionEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'session_id', type: 'int' })
  sessionId: number;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: Session;

  /** hook_event_name: SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd ... */
  @Column({ type: 'text' })
  event: string;

  @Column({ name: 'tool_name', type: 'text', nullable: true })
  toolName: string | null;

  @Column({ type: 'text', default: '' })
  summary: string;

  /** hook 입력 원본. 비밀값은 가려서 저장한다. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
