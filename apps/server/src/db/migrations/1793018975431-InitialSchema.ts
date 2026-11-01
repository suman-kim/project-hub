import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1793018975431 implements MigrationInterface {
    name = 'InitialSchema1793018975431'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "apps" ("id" SERIAL NOT NULL, "code" character varying(8) NOT NULL, "name" text NOT NULL, "repo_path" text, "default_branch" text NOT NULL DEFAULT 'main', "folder_names" text array NOT NULL DEFAULT '{}', "setup_cmd" text, "idea_cron" text, "guard_enabled" boolean NOT NULL DEFAULT false, "direction_note" text, "next_task_seq" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_48491b1d9bb22739ceee024ba01" UNIQUE ("code"), CONSTRAINT "PK_c5121fda0f8268f1f7f84134e19" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "tasks" ("id" character varying(32) NOT NULL, "app_id" integer NOT NULL, "idea_id" integer, "title" text NOT NULL, "description" text, "status" character varying(16) NOT NULL DEFAULT 'todo', "size" character varying(2), "tag" text, "depends_on" text array NOT NULL DEFAULT '{}', "branch" text, "pr_url" text, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7ca2cf51490dd2e47e3354ba80" ON "tasks" ("app_id", "status") `);
        await queryRunner.query(`CREATE TABLE "ideas" ("id" SERIAL NOT NULL, "app_id" integer NOT NULL, "title" text NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "current_version" integer NOT NULL DEFAULT '1', "reject_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6ab43f1e9b1cef0d8f3e56ce3a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "specs" ("id" SERIAL NOT NULL, "idea_id" integer, "task_id" character varying(32), "kind" character varying(16) NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_89ffcebad2c7014f98bbfa2e0b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_383b74c2e3083793319652a910" ON "specs" ("idea_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_4060c0fa3a3216fdb14cba2473" ON "specs" ("task_id") `);
        await queryRunner.query(`CREATE TABLE "sessions" ("id" SERIAL NOT NULL, "claude_session_id" text NOT NULL, "app_id" integer, "task_id" character varying(32), "run_id" integer, "origin" character varying(8) NOT NULL DEFAULT 'local', "cwd" text NOT NULL DEFAULT '', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ended_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_ecd0e804457f1eda528c2d80ef1" UNIQUE ("claude_session_id"), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "mistakes" ("id" SERIAL NOT NULL, "app_id" integer NOT NULL, "what" text NOT NULL, "correct_way" text NOT NULL, "session_id" integer, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60ee9825425cb7bdf39ffd9192c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9f56b8ca7db28a1b51ce6e1ad9" ON "mistakes" ("app_id", "active") `);
        await queryRunner.query(`CREATE TABLE "idea_versions" ("id" SERIAL NOT NULL, "idea_id" integer NOT NULL, "version" integer NOT NULL, "body" jsonb NOT NULL, "revision_note" text, "run_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_b62fc9fe5a67efdbb19f6eccb35" UNIQUE ("idea_id", "version"), CONSTRAINT "PK_7f8bd43b9eacf97707c193aac7b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "session_events" ("id" BIGSERIAL NOT NULL, "session_id" integer NOT NULL, "event" text NOT NULL, "tool_name" text, "summary" text NOT NULL DEFAULT '', "payload" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_aeae988940cef0a489a14200af3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b5f55142cd3b60224dad165113" ON "session_events" ("session_id", "id") `);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_1ac2eea4a4abec5fd7d0a741de6" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ideas" ADD CONSTRAINT "FK_5886507ac302215ff62b98372b1" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "specs" ADD CONSTRAINT "FK_383b74c2e3083793319652a910b" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "specs" ADD CONSTRAINT "FK_4060c0fa3a3216fdb14cba24731" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD CONSTRAINT "FK_79b3bb30535f68dbb8ba130ac38" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD CONSTRAINT "FK_4ea262f91bbb67f7985367daa40" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "mistakes" ADD CONSTRAINT "FK_28caafb924a4afa652e43bdfe91" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "mistakes" ADD CONSTRAINT "FK_d897439d2d3ba9f800831ab2a44" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "idea_versions" ADD CONSTRAINT "FK_2540f24d5b91974c0373c555dd6" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_events" ADD CONSTRAINT "FK_7e4699f97af1e889b595350dd04" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session_events" DROP CONSTRAINT "FK_7e4699f97af1e889b595350dd04"`);
        await queryRunner.query(`ALTER TABLE "idea_versions" DROP CONSTRAINT "FK_2540f24d5b91974c0373c555dd6"`);
        await queryRunner.query(`ALTER TABLE "mistakes" DROP CONSTRAINT "FK_d897439d2d3ba9f800831ab2a44"`);
        await queryRunner.query(`ALTER TABLE "mistakes" DROP CONSTRAINT "FK_28caafb924a4afa652e43bdfe91"`);
        await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_4ea262f91bbb67f7985367daa40"`);
        await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_79b3bb30535f68dbb8ba130ac38"`);
        await queryRunner.query(`ALTER TABLE "specs" DROP CONSTRAINT "FK_4060c0fa3a3216fdb14cba24731"`);
        await queryRunner.query(`ALTER TABLE "specs" DROP CONSTRAINT "FK_383b74c2e3083793319652a910b"`);
        await queryRunner.query(`ALTER TABLE "ideas" DROP CONSTRAINT "FK_5886507ac302215ff62b98372b1"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_1ac2eea4a4abec5fd7d0a741de6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b5f55142cd3b60224dad165113"`);
        await queryRunner.query(`DROP TABLE "session_events"`);
        await queryRunner.query(`DROP TABLE "idea_versions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9f56b8ca7db28a1b51ce6e1ad9"`);
        await queryRunner.query(`DROP TABLE "mistakes"`);
        await queryRunner.query(`DROP TABLE "sessions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4060c0fa3a3216fdb14cba2473"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_383b74c2e3083793319652a910"`);
        await queryRunner.query(`DROP TABLE "specs"`);
        await queryRunner.query(`DROP TABLE "ideas"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7ca2cf51490dd2e47e3354ba80"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP TABLE "apps"`);
    }

}
