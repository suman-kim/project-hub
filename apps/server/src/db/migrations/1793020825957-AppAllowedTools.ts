import { MigrationInterface, QueryRunner } from "typeorm";

export class AppAllowedTools1793020825957 implements MigrationInterface {
    name = 'AppAllowedTools1793020825957'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "apps" ADD "allowed_tools" text array`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "allowed_tools"`);
    }

}
