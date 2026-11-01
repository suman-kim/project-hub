import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 앱에 묶이지 않는 Hub 설정. 키마다 JSON 값 하나 */
@Entity('hub_settings')
export class HubSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
