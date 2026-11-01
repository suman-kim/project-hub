import { MigrationInterface, QueryRunner } from "typeorm";

/** 내 업무 문서 첨부 파일 목록 (내용은 ~/.hub/files/, 문서를 지우면 함께 지운다) */
export class MyDocFiles1793465877987 implements MigrationInterface {
    name = 'MyDocFiles1793465877987'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "my_doc_files" ("id" SERIAL NOT NULL, "doc_id" integer NOT NULL, "name" text NOT NULL, "kind" character varying(8) NOT NULL, "size" integer NOT NULL, "stored_name" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_102e5629a3a6380e672edb24045" UNIQUE ("stored_name"), CONSTRAINT "PK_6fe77ec78dd9855e12457e9eb23" PRIMARY KEY ("id")); COMMENT ON COLUMN "my_doc_files"."id" IS '첨부 파일 id'; COMMENT ON COLUMN "my_doc_files"."doc_id" IS '첨부한 내 업무 문서 (my_docs.id). 문서를 지우면 함께 지운다'; COMMENT ON COLUMN "my_doc_files"."name" IS '올린 파일 이름. 화면 표시와 내려받기 이름에 쓴다'; COMMENT ON COLUMN "my_doc_files"."kind" IS '보기 방식: pdf, md, text, image, other(내려받기만)'; COMMENT ON COLUMN "my_doc_files"."size" IS '파일 크기 (바이트)'; COMMENT ON COLUMN "my_doc_files"."stored_name" IS '~/.hub/files/ 안의 저장 이름 (<uuid><확장자>)'; COMMENT ON COLUMN "my_doc_files"."created_at" IS '올린 시각'`);
        await queryRunner.query(`CREATE INDEX "IDX_03c313c70a5da4528ef61846e9" ON "my_doc_files" ("doc_id") `);
        await queryRunner.query(`COMMENT ON TABLE "my_doc_files" IS '내 업무 문서 첨부 파일 목록. 파일 내용은 ~/.hub/files/<stored_name>에 둔다'`);
        await queryRunner.query(`ALTER TABLE "my_doc_files" ADD CONSTRAINT "FK_03c313c70a5da4528ef61846e9e" FOREIGN KEY ("doc_id") REFERENCES "my_docs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "my_doc_files" DROP CONSTRAINT "FK_03c313c70a5da4528ef61846e9e"`);
        await queryRunner.query(`COMMENT ON TABLE "my_doc_files" IS NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03c313c70a5da4528ef61846e9"`);
        await queryRunner.query(`DROP TABLE "my_doc_files"`);
    }

}
