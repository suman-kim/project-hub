import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 내 업무 노트와 앱별 보관함.
 * - app_notes.app_id를 비울 수 있게 한다: 비면 앱에 묶이지 않은 내 업무 공통 노트
 * - my_docs.app_id를 더한다: 비면 모든 앱 공통(지금 있는 문서는 모두 공통으로 남는다), 채우면 그 앱 전용. 앱을 지우면 함께 지운다
 * - my_docs 테이블·칸 comment를 채운다
 */
export class NotesMineVault1793873896668 implements MigrationInterface {
    name = 'NotesMineVault1793873896668'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`COMMENT ON TABLE "app_notes" IS '노트. 명령어 보관, 간단한 메모, 할 일 등 자유 글. 본문은 markdown. app_id가 비면 내 업무 공통 노트'`);
        await queryRunner.query(`COMMENT ON TABLE "my_docs" IS '보관함 문서: 계정·키·결제·도메인·법무·메모. app_id가 비면 모든 앱 공통, 채우면 그 앱 전용. 키 값은 암호화'`);
        await queryRunner.query(`ALTER TABLE "my_docs" ADD "app_id" integer`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."app_id" IS '이 문서를 쓰는 앱 (apps.id). 비우면 모든 앱 공통. 앱을 지우면 함께 지운다'`);
        await queryRunner.query(`ALTER TABLE "app_notes" DROP CONSTRAINT "FK_e410126caf97b2370cb082df0c4"`);
        await queryRunner.query(`ALTER TABLE "app_notes" ALTER COLUMN "app_id" DROP NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "app_notes"."app_id" IS '노트가 속한 앱 (apps.id). 비우면 내 업무 공통 노트. 앱을 지우면 함께 지운다'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."id" IS '문서 id'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."kind" IS '종류: store(스토어 계정), apikey(외부 API 키), billing(결제·구독), domain(도메인·DNS), legal(법무 문서), memo(자유 메모)'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."title" IS '제목'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."fields" IS '[항목, 내용] 목록 (예: [["계정", "me@example.com"]])'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_mode" IS '키 값 다루는 방식: value(암호화해 저장), ref(위치만 적기), none(없음)'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_ref" IS '키 값의 위치 (1Password 항목, .env 경로, 콘솔 주소). secret_mode=ref일 때'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_enc" IS '암호화한 키 값 v1:<iv>.<tag>.<암호문> (base64). secret_mode=value일 때'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_last4" IS '저장한 키 값의 끝 4자리 (화면·Claude 표시용)'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."expires_on" IS '만료·갱신·결제일. 14일 안이면 오늘 화면에 띄운다'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."renew_label" IS 'expires_on을 부르는 말: 만료, 갱신, 결제'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."memo" IS '메모'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."created_at" IS '만든 시각'`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."updated_at" IS '마지막 수정 시각 (첨부를 붙이거나 지울 때도 올린다)'`);
        await queryRunner.query(`CREATE INDEX "IDX_b0eeeb65cbb23d6456966bb6fe" ON "my_docs" ("app_id") `);
        await queryRunner.query(`ALTER TABLE "app_notes" ADD CONSTRAINT "FK_e410126caf97b2370cb082df0c4" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "my_docs" ADD CONSTRAINT "FK_b0eeeb65cbb23d6456966bb6fe7" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "my_docs" DROP CONSTRAINT "FK_b0eeeb65cbb23d6456966bb6fe7"`);
        await queryRunner.query(`ALTER TABLE "app_notes" DROP CONSTRAINT "FK_e410126caf97b2370cb082df0c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b0eeeb65cbb23d6456966bb6fe"`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."updated_at" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."created_at" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."memo" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."renew_label" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."expires_on" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_last4" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_enc" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_ref" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."secret_mode" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."fields" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."title" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."kind" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."id" IS NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "app_notes"."app_id" IS '노트가 속한 앱 (apps.id). 앱을 지우면 함께 지운다'`);
        await queryRunner.query(`ALTER TABLE "app_notes" ALTER COLUMN "app_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "app_notes" ADD CONSTRAINT "FK_e410126caf97b2370cb082df0c4" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`COMMENT ON COLUMN "my_docs"."app_id" IS '이 문서를 쓰는 앱 (apps.id). 비우면 모든 앱 공통. 앱을 지우면 함께 지운다'`);
        await queryRunner.query(`ALTER TABLE "my_docs" DROP COLUMN "app_id"`);
        await queryRunner.query(`COMMENT ON TABLE "my_docs" IS NULL`);
        await queryRunner.query(`COMMENT ON TABLE "app_notes" IS '앱별 노트. 명령어 보관, 간단한 메모, 할 일 등 자유 글. 본문은 markdown'`);
    }

}
