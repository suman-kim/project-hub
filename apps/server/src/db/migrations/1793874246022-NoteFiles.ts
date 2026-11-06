import { MigrationInterface, QueryRunner } from "typeorm";

/** 노트 첨부 파일 목록 (내용은 ~/.hub/files/, 노트를 지우면 함께 지움). 그림은 본문에도 ![이름](/api/notes/files/<id>)로 들어간다 */
export class NoteFiles1793874246022 implements MigrationInterface {
    name = 'NoteFiles1793874246022'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "app_note_files" ("id" SERIAL NOT NULL, "note_id" integer NOT NULL, "name" text NOT NULL, "kind" character varying(8) NOT NULL, "size" integer NOT NULL, "stored_name" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a21f321c0dcdd5e9fafa5b90a97" UNIQUE ("stored_name"), CONSTRAINT "PK_85e42ab0e7a5d997b986f525e3c" PRIMARY KEY ("id")); COMMENT ON COLUMN "app_note_files"."id" IS '첨부 파일 id'; COMMENT ON COLUMN "app_note_files"."note_id" IS '첨부한 노트 (app_notes.id). 노트를 지우면 함께 지운다'; COMMENT ON COLUMN "app_note_files"."name" IS '올린 파일 이름. 화면 표시와 내려받기 이름에 쓴다'; COMMENT ON COLUMN "app_note_files"."kind" IS '보기 방식: pdf, md, text, image, other(내려받기만)'; COMMENT ON COLUMN "app_note_files"."size" IS '파일 크기 (바이트)'; COMMENT ON COLUMN "app_note_files"."stored_name" IS '~/.hub/files/ 안의 저장 이름 (<uuid><확장자>)'; COMMENT ON COLUMN "app_note_files"."created_at" IS '올린 시각'`);
        await queryRunner.query(`CREATE INDEX "IDX_74fc7934ee397ecc3b858b6441" ON "app_note_files" ("note_id") `);
        await queryRunner.query(`COMMENT ON TABLE "app_note_files" IS '노트 첨부 파일 목록. 파일 내용은 ~/.hub/files/<stored_name>에 둔다. 그림은 본문에도 들어간다'`);
        await queryRunner.query(`ALTER TABLE "app_note_files" ADD CONSTRAINT "FK_74fc7934ee397ecc3b858b6441d" FOREIGN KEY ("note_id") REFERENCES "app_notes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "app_note_files" DROP CONSTRAINT "FK_74fc7934ee397ecc3b858b6441d"`);
        await queryRunner.query(`COMMENT ON TABLE "app_note_files" IS NULL`);
        await queryRunner.query(`DROP TABLE "app_note_files"`);
    }

}
