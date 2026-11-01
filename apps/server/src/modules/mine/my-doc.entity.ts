import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MyDocKind, MyDocRenew, MySecretMode } from '@hub/shared';

/**
 * 내 업무 문서: 앱에 묶이지 않는 계정·키·결제·도메인·법무·메모.
 * 키 값은 secret_enc에 AES-256-GCM으로 암호화해 두고(키 파일은 ~/.hub/secret.key), 화면과 Claude에는 끝 4자리만 보인다.
 */
@Entity('my_docs')
export class MyDoc {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 16 })
  kind: MyDocKind;

  @Column({ type: 'text', default: '' })
  title: string;

  /** [항목, 내용] 목록 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  fields: Array<[string, string]>;

  /** value: 값 저장, ref: 위치만 적기, none: 없음 */
  @Column({ name: 'secret_mode', type: 'varchar', length: 8, default: 'none' })
  secretMode: MySecretMode;

  /** 위치만 적기: 1Password 항목, .env 경로, 콘솔 주소 */
  @Column({ name: 'secret_ref', type: 'text', default: '' })
  secretRef: string;

  /** 값 저장: v1:<iv>.<tag>.<암호문> (base64) */
  @Column({ name: 'secret_enc', type: 'text', nullable: true })
  secretEnc: string | null;

  @Column({ name: 'secret_last4', type: 'varchar', length: 4, nullable: true })
  secretLast4: string | null;

  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn: string | null;

  /** 만료, 갱신, 결제 */
  @Column({ name: 'renew_label', type: 'varchar', length: 8, default: '만료' })
  renewLabel: MyDocRenew;

  @Column({ type: 'text', default: '' })
  memo: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
