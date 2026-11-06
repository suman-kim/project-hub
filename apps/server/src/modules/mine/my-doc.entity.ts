import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MyDocKind, MyDocRenew, MySecretMode } from '@hub/shared';
import { App } from '../apps/app.entity';

/**
 * 보관함 문서: 계정·키·결제·도메인·법무·메모. 화면 이름은 "보관함"이다(앱 페이지의 docs/ "문서" 탭과 헷갈리지 않게).
 * app_id가 비면 모든 앱 공통(내 업무 보관함), 채우면 그 앱 전용(앱 페이지 보관함)이다.
 * 키 값은 secret_enc에 AES-256-GCM으로 암호화해 두고(키 파일은 ~/.hub/secret.key), 화면과 Claude에는 끝 4자리만 보인다.
 */
@Entity({ name: 'my_docs', comment: '보관함 문서: 계정·키·결제·도메인·법무·메모. app_id가 비면 모든 앱 공통, 채우면 그 앱 전용. 키 값은 암호화' })
export class MyDoc {
  @PrimaryGeneratedColumn({ comment: '문서 id' })
  id: number;

  /** 이 문서를 쓰는 앱. null이면 모든 앱 공통. 앱을 지우면 함께 지워진다 */
  @Index()
  @Column({ name: 'app_id', type: 'int', nullable: true, comment: '이 문서를 쓰는 앱 (apps.id). 비우면 모든 앱 공통. 앱을 지우면 함께 지운다' })
  appId: number | null;

  @ManyToOne(() => App, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'app_id' })
  app: App | null;

  /** store, apikey, billing, domain, legal, memo */
  @Column({ type: 'varchar', length: 16, comment: '종류: store(스토어 계정), apikey(외부 API 키), billing(결제·구독), domain(도메인·DNS), legal(법무 문서), memo(자유 메모)' })
  kind: MyDocKind;

  @Column({ type: 'text', default: '', comment: '제목' })
  title: string;

  /** [항목, 내용] 목록 */
  @Column({ type: 'jsonb', default: () => "'[]'", comment: '[항목, 내용] 목록 (예: [["계정", "me@example.com"]])' })
  fields: Array<[string, string]>;

  /** value: 값 저장, ref: 위치만 적기, none: 없음 */
  @Column({ name: 'secret_mode', type: 'varchar', length: 8, default: 'none', comment: '키 값 다루는 방식: value(암호화해 저장), ref(위치만 적기), none(없음)' })
  secretMode: MySecretMode;

  /** 위치만 적기: 1Password 항목, .env 경로, 콘솔 주소 */
  @Column({ name: 'secret_ref', type: 'text', default: '', comment: '키 값의 위치 (1Password 항목, .env 경로, 콘솔 주소). secret_mode=ref일 때' })
  secretRef: string;

  /** 값 저장: v1:<iv>.<tag>.<암호문> (base64) */
  @Column({ name: 'secret_enc', type: 'text', nullable: true, comment: '암호화한 키 값 v1:<iv>.<tag>.<암호문> (base64). secret_mode=value일 때' })
  secretEnc: string | null;

  @Column({ name: 'secret_last4', type: 'varchar', length: 4, nullable: true, comment: '저장한 키 값의 끝 4자리 (화면·Claude 표시용)' })
  secretLast4: string | null;

  @Column({ name: 'expires_on', type: 'date', nullable: true, comment: '만료·갱신·결제일. 14일 안이면 오늘 화면에 띄운다' })
  expiresOn: string | null;

  /** 만료, 갱신, 결제 */
  @Column({ name: 'renew_label', type: 'varchar', length: 8, default: '만료', comment: 'expires_on을 부르는 말: 만료, 갱신, 결제' })
  renewLabel: MyDocRenew;

  @Column({ type: 'text', default: '', comment: '메모' })
  memo: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', comment: '만든 시각' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', comment: '마지막 수정 시각 (첨부를 붙이거나 지울 때도 올린다)' })
  updatedAt: Date;
}
