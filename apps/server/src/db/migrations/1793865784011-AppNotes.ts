import { MigrationInterface, QueryRunner } from "typeorm";

/** 앱별 노트 테이블 (노션처럼 쓰는 글. 본문은 markdown, 앱을 지우면 함께 지운다) */
export class AppNotes1793865784011 implements MigrationInterface {
    name = 'AppNotes1793865784011'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "app_notes" ("id" SERIAL NOT NULL, "app_id" integer NOT NULL, "folder" text NOT NULL DEFAULT '', "title" text NOT NULL DEFAULT '', "body" text NOT NULL DEFAULT '', "pinned" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8cf721c9217814657c099d92c1f" PRIMARY KEY ("id")); COMMENT ON COLUMN "app_notes"."id" IS '노트 id'; COMMENT ON COLUMN "app_notes"."app_id" IS '노트가 속한 앱 (apps.id). 앱을 지우면 함께 지운다'; COMMENT ON COLUMN "app_notes"."folder" IS '노트를 묶는 폴더 이름 (예: 명령어, 할 일). 비우면 폴더 없음'; COMMENT ON COLUMN "app_notes"."title" IS '제목. 비우면 화면에서 본문 첫 줄을 보여 준다'; COMMENT ON COLUMN "app_notes"."body" IS '본문 (markdown)'; COMMENT ON COLUMN "app_notes"."pinned" IS '목록 맨 위 고정'; COMMENT ON COLUMN "app_notes"."created_at" IS '만든 시각'; COMMENT ON COLUMN "app_notes"."updated_at" IS '마지막 수정 시각'`);
        await queryRunner.query(`CREATE INDEX "IDX_e410126caf97b2370cb082df0c" ON "app_notes" ("app_id") `);
        await queryRunner.query(`COMMENT ON TABLE "app_notes" IS '앱별 노트. 명령어 보관, 간단한 메모, 할 일 등 자유 글. 본문은 markdown'`);
        await queryRunner.query(`ALTER TABLE "app_notes" ADD CONSTRAINT "FK_e410126caf97b2370cb082df0c4" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "app_notes" DROP CONSTRAINT "FK_e410126caf97b2370cb082df0c4"`);
        await queryRunner.query(`COMMENT ON TABLE "app_notes" IS NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e410126caf97b2370cb082df0c"`);
        await queryRunner.query(`DROP TABLE "app_notes"`);
    }

}
