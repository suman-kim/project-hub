import { MigrationInterface, QueryRunner } from "typeorm";

/** task 없는 세션 막기를 모든 앱의 기본으로 켠다. 이미 있는 앱도 켠다(앱 설정에서 끌 수 있다). */
export class GuardByDefault1793256236000 implements MigrationInterface {
    name = 'GuardByDefault1793256236000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "apps" ALTER COLUMN "guard_enabled" SET DEFAULT true`);
        await queryRunner.query(`UPDATE "apps" SET "guard_enabled" = true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "apps" ALTER COLUMN "guard_enabled" SET DEFAULT false`);
    }

}
