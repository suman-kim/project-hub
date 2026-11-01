import { MigrationInterface, QueryRunner } from "typeorm";
import { BACKFILL_ACTIVITIES_SQL } from "../backfill-activities";

export class ProjectManagement1793116288235 implements MigrationInterface {
    name = 'ProjectManagement1793116288235'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "app_repos" ("id" SERIAL NOT NULL, "app_id" integer NOT NULL, "name" text NOT NULL, "path" text NOT NULL, "github" text, "default_branch" text NOT NULL DEFAULT 'main', "setup_cmd" text, "check_cmd" text, "deploy_rules" jsonb NOT NULL DEFAULT '[]', "position" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9e58c23bd0e2003cf25bdcd4e2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_360aff6af29dccfbf02c44a251" ON "app_repos" ("app_id", "path") `);
        await queryRunner.query(`CREATE TABLE "deployments" ("id" SERIAL NOT NULL, "app_id" integer NOT NULL, "repo_id" integer, "source" character varying(20) NOT NULL, "external_id" text NOT NULL, "environment" text NOT NULL, "env" character varying(12) NOT NULL, "version" text, "sha" text, "status" character varying(12) NOT NULL, "url" text, "notes" text, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "raw" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1e5627acb3c950deb83fe98fc48" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c3db83c70f97d571adf616b6c1" ON "deployments" ("app_id", "env", "started_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_72eea70d47794f5a2ffe1161f6" ON "deployments" ("source", "external_id") `);
        await queryRunner.query(`CREATE TABLE "activities" ("id" BIGSERIAL NOT NULL, "app_id" integer, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(32) NOT NULL, "actor" character varying(8) NOT NULL, "ref_type" character varying(16), "ref_id" character varying(64), "summary" text NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_7f4004429f731ffb9c88eb486a8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5ceadbe840ec39e5edb78f9fb3" ON "activities" ("app_id", "at") `);
        await queryRunner.query(`ALTER TABLE "apps" ADD "check_cmd" text`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "worktree_root" text`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "description" text`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "links" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "stack" text`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "stages" jsonb NOT NULL DEFAULT '[{"key":"plan","name":"기획"},{"key":"design","name":"디자인"},{"key":"develop","name":"개발"},{"key":"test","name":"테스트"},{"key":"deploy","name":"배포"},{"key":"operate","name":"운영"}]'`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "stage" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "apps" ADD "lifecycle" character varying(12) NOT NULL DEFAULT 'developing'`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "type" character varying(8) NOT NULL DEFAULT 'feature'`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "assignee" character varying(8) NOT NULL DEFAULT 'claude'`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "priority" smallint`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "due_date" date`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "stage" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD "repo_id" integer`);
        await queryRunner.query(`ALTER TABLE "app_repos" ADD CONSTRAINT "FK_d997e5b3c5ce59eff5f08a505fb" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_54fcc6fcaf8f5a98eb3aa69c67a" FOREIGN KEY ("repo_id") REFERENCES "app_repos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deployments" ADD CONSTRAINT "FK_46da92793ea5b8442c703bcfbaf" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deployments" ADD CONSTRAINT "FK_9c6abb6528be0fac218ac8245f0" FOREIGN KEY ("repo_id") REFERENCES "app_repos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_bd1890372e5ec5c3f1ab6ff5069" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        for (const sql of BACKFILL_ACTIVITIES_SQL) await queryRunner.query(sql);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_bd1890372e5ec5c3f1ab6ff5069"`);
        await queryRunner.query(`ALTER TABLE "deployments" DROP CONSTRAINT "FK_9c6abb6528be0fac218ac8245f0"`);
        await queryRunner.query(`ALTER TABLE "deployments" DROP CONSTRAINT "FK_46da92793ea5b8442c703bcfbaf"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_54fcc6fcaf8f5a98eb3aa69c67a"`);
        await queryRunner.query(`ALTER TABLE "app_repos" DROP CONSTRAINT "FK_d997e5b3c5ce59eff5f08a505fb"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "repo_id"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "stage"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "due_date"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "priority"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "assignee"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "lifecycle"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "stage"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "stages"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "stack"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "links"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "worktree_root"`);
        await queryRunner.query(`ALTER TABLE "apps" DROP COLUMN "check_cmd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ceadbe840ec39e5edb78f9fb3"`);
        await queryRunner.query(`DROP TABLE "activities"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_72eea70d47794f5a2ffe1161f6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c3db83c70f97d571adf616b6c1"`);
        await queryRunner.query(`DROP TABLE "deployments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_360aff6af29dccfbf02c44a251"`);
        await queryRunner.query(`DROP TABLE "app_repos"`);
    }

}
