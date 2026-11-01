import { MigrationInterface, QueryRunner } from "typeorm";

export class IdeasAndRules1793022037933 implements MigrationInterface {
    name = 'IdeasAndRules1793022037933'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "rules" ("id" SERIAL NOT NULL, "scope" character varying(8) NOT NULL, "app_id" integer, "position" integer NOT NULL, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10fef696a7d61140361b1b23608" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_da64aac8a2cb8b8c6e085903d0" ON "rules" ("scope", "app_id", "position") `);
        await queryRunner.query(`ALTER TABLE "rules" ADD CONSTRAINT "FK_1d30a0d0da57384231fe6132675" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rules" DROP CONSTRAINT "FK_1d30a0d0da57384231fe6132675"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_da64aac8a2cb8b8c6e085903d0"`);
        await queryRunner.query(`DROP TABLE "rules"`);
    }

}
