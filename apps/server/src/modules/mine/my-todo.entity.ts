import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MyDoc } from './my-doc.entity';

/** 내 업무 할 일: 어느 앱에도 묶이지 않는 내 할 일. 화면에는 ME-<id>로 보인다. 하위 할 일은 한 단계만 둔다 */
@Entity('my_todos')
export class MyTodo {
  @PrimaryGeneratedColumn()
  id: number;

  /** 상위 할 일. 하위 할 일은 제목과 완료만 쓰고, 상위를 지우면 함께 지워진다 */
  @Index()
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId: number | null;

  @ManyToOne(() => MyTodo, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: MyTodo | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  /** 1 높음, 2 보통, 3 낮음 */
  @Column({ type: 'smallint', default: 2 })
  priority: number;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt: Date | null;

  /** 연결한 내 업무 문서. 문서를 지우면 연결만 풀린다 */
  @Column({ name: 'doc_id', type: 'int', nullable: true })
  docId: number | null;

  @ManyToOne(() => MyDoc, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'doc_id' })
  doc: MyDoc | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
