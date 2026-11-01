import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { App } from '../apps/app.entity';
import { Session } from '../sessions/session.entity';

@Entity('mistakes')
@Index(['appId', 'active'])
export class Mistake {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'app_id', type: 'int' })
  appId: number;

  @ManyToOne(() => App, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app: App;

  @Column({ type: 'text' })
  what: string;

  @Column({ name: 'correct_way', type: 'text' })
  correctWay: string;

  @Column({ name: 'session_id', type: 'int', nullable: true })
  sessionId: number | null;

  @ManyToOne(() => Session, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'session_id' })
  session: Session | null;

  /** 세션 맥락에는 active인 것만 넣는다. */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
