import { MigrationInterface, QueryRunner } from "typeorm";

export class AppConcepts1793085409877 implements MigrationInterface {
    name = 'AppConcepts1793085409877'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "hub_settings" ("key" character varying(64) NOT NULL, "value" jsonb NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_591d25c34e36fd286f9395a4efd" PRIMARY KEY ("key"))`);
        await queryRunner.query(`ALTER TABLE "ideas" ADD "kind" character varying(8) NOT NULL DEFAULT 'feature'`);
        await queryRunner.query(`ALTER TABLE "ideas" DROP CONSTRAINT "FK_5886507ac302215ff62b98372b1"`);
        await queryRunner.query(`ALTER TABLE "ideas" ALTER COLUMN "app_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "ideas" ADD CONSTRAINT "FK_5886507ac302215ff62b98372b1" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ideas" DROP CONSTRAINT "FK_5886507ac302215ff62b98372b1"`);
        await queryRunner.query(`ALTER TABLE "ideas" ALTER COLUMN "app_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "ideas" ADD CONSTRAINT "FK_5886507ac302215ff62b98372b1" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ideas" DROP COLUMN "kind"`);
        await queryRunner.query(`DROP TABLE "hub_settings"`);
    }

}
