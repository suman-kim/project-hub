import { MigrationInterface, QueryRunner } from "typeorm";

/** 대시보드에서 일하는 중인 세션에 보내는 메시지 (hook 응답으로 전달) */
export class SessionMessages1793261332240 implements MigrationInterface {
    name = 'SessionMessages1793261332240'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "session_messages" ("id" SERIAL NOT NULL, "session_id" integer NOT NULL, "text" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "delivered_at" TIMESTAMP WITH TIME ZONE, "delivered_via" character varying(24), CONSTRAINT "PK_25b3c73b5dd210b40ce5c02ce20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_53e9f96ad7eb1c94d0c44aa14d" ON "session_messages" ("session_id", "id") `);
        await queryRunner.query(`ALTER TABLE "session_messages" ADD CONSTRAINT "FK_5c76ae848db745693cebc00aed5" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session_messages" DROP CONSTRAINT "FK_5c76ae848db745693cebc00aed5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_53e9f96ad7eb1c94d0c44aa14d"`);
        await queryRunner.query(`DROP TABLE "session_messages"`);
    }

}
