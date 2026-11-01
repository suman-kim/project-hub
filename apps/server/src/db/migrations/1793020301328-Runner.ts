import { MigrationInterface, QueryRunner } from "typeorm";

export class Runner1793020301328 implements MigrationInterface {
    name = 'Runner1793020301328'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "runs" ("id" SERIAL NOT NULL, "task_id" character varying(32), "kind" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'queued', "claude_session_id" text, "worktree_path" text, "branch" text, "cost_usd" numeric(10,4) NOT NULL DEFAULT '0', "result" jsonb NOT NULL DEFAULT '{}', "started_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_46d6a1e257c38ba58f1a3c30836" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_960d03633e2a14a4bdf668aa1e" ON "runs" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_21a0ca60e629777f8d4eeee27a" ON "runs" ("task_id") `);
        await queryRunner.query(`CREATE TABLE "run_logs" ("id" BIGSERIAL NOT NULL, "run_id" integer NOT NULL, "seq" integer NOT NULL, "ts" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(16) NOT NULL, "text" text NOT NULL DEFAULT '', "raw" jsonb, CONSTRAINT "UQ_bff9e19bc7e2beeb373df36500d" UNIQUE ("run_id", "seq"), CONSTRAINT "PK_a7e453f59dee3f9e1e47c453203" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_12221386b11880f1375673b5f0c" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "runs" ADD CONSTRAINT "FK_21a0ca60e629777f8d4eeee27a9" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "run_logs" ADD CONSTRAINT "FK_57288662d17ae0dd1a005e499bb" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD CONSTRAINT "FK_aefb6122812c36d18d4b610f4ff" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "idea_versions" ADD CONSTRAINT "FK_346eeac21f6abc2e94585143b89" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "idea_versions" DROP CONSTRAINT "FK_346eeac21f6abc2e94585143b89"`);
        await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_aefb6122812c36d18d4b610f4ff"`);
        await queryRunner.query(`ALTER TABLE "run_logs" DROP CONSTRAINT "FK_57288662d17ae0dd1a005e499bb"`);
        await queryRunner.query(`ALTER TABLE "runs" DROP CONSTRAINT "FK_21a0ca60e629777f8d4eeee27a9"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_12221386b11880f1375673b5f0c"`);
        await queryRunner.query(`DROP TABLE "run_logs"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21a0ca60e629777f8d4eeee27a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_960d03633e2a14a4bdf668aa1e"`);
        await queryRunner.query(`DROP TABLE "runs"`);
    }

}
