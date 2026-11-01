import { MigrationInterface, QueryRunner } from "typeorm";

/** 내 업무 할 일의 하위 할 일 (한 단계, 상위를 지우면 함께 지운다) */
export class MyTodoParent1793336689529 implements MigrationInterface {
    name = 'MyTodoParent1793336689529'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "my_todos" ADD "parent_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_f5e24b2f5a31f01714ee829926" ON "my_todos" ("parent_id") `);
        await queryRunner.query(`ALTER TABLE "my_todos" ADD CONSTRAINT "FK_f5e24b2f5a31f01714ee8299261" FOREIGN KEY ("parent_id") REFERENCES "my_todos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "my_todos" DROP CONSTRAINT "FK_f5e24b2f5a31f01714ee8299261"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f5e24b2f5a31f01714ee829926"`);
        await queryRunner.query(`ALTER TABLE "my_todos" DROP COLUMN "parent_id"`);
    }

}
