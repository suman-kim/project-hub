import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { MyFileKind } from '@hub/shared';
import { MyDoc } from './my-doc.entity';

/**
 * 내 업무 문서의 첨부 파일 목록. 파일 내용은 DB가 아니라 Hub 폴더(~/.hub/files/<stored_name>)에 그대로 둔다.
 * 문서를 지우면 행은 CASCADE로, 파일은 MineService가 지운다.
 */
@Entity({ name: 'my_doc_files', comment: '내 업무 문서 첨부 파일 목록. 파일 내용은 ~/.hub/files/<stored_name>에 둔다' })
export class MyDocFile {
  @PrimaryGeneratedColumn({ comment: '첨부 파일 id' })
  id: number;

  /** 첨부한 문서. 문서를 지우면 함께 지워진다 */
  @Index()
  @Column({ name: 'doc_id', type: 'int', comment: '첨부한 내 업무 문서 (my_docs.id). 문서를 지우면 함께 지운다' })
  docId: number;

  @ManyToOne(() => MyDoc, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doc_id' })
  doc: MyDoc;

  /** 올린 파일 이름 (화면 표시와 내려받기 이름) */
  @Column({ type: 'text', comment: '올린 파일 이름. 화면 표시와 내려받기 이름에 쓴다' })
  name: string;

  /** pdf, md, text, image, other */
  @Column({ type: 'varchar', length: 8, comment: '보기 방식: pdf, md, text, image, other(내려받기만)' })
  kind: MyFileKind;

  /** 바이트 */
  @Column({ type: 'int', comment: '파일 크기 (바이트)' })
  size: number;

  /** Hub 폴더 안의 저장 이름: <uuid><확장자>. 올린 이름은 경로에 쓰지 않는다 */
  @Column({ name: 'stored_name', type: 'varchar', length: 64, unique: true, comment: '~/.hub/files/ 안의 저장 이름 (<uuid><확장자>)' })
  storedName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', comment: '올린 시각' })
  createdAt: Date;
}
