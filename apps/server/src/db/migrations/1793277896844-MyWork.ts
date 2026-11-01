import { MigrationInterface, QueryRunner } from "typeorm";

/** 내 업무: 앱에 묶이지 않는 내 할 일(my_todos)과 계정·키·결제·도메인 문서(my_docs, 키 값은 암호화) */
export class MyWork1793277896844 implements MigrationInterface {
    name = 'MyWork1793277896844'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "my_docs" ("id" SERIAL NOT NULL, "kind" character varying(16) NOT NULL, "title" text NOT NULL DEFAULT '', "fields" jsonb NOT NULL DEFAULT '[]', "secret_mode" character varying(8) NOT NULL DEFAULT 'none', "secret_ref" text NOT NULL DEFAULT '', "secret_enc" text, "secret_last4" character varying(4), "expires_on" date, "renew_label" character varying(8) NOT NULL DEFAULT '만료', "memo" text NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b0fef1c43d82fd18718fb47fe1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "my_todos" ("id" SERIAL NOT NULL, "title" text NOT NULL, "due_date" date, "priority" smallint NOT NULL DEFAULT '2', "done_at" TIMESTAMP WITH TIME ZONE, "doc_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9be3f473814fbb8e6541bc46ac3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "my_todos" ADD CONSTRAINT "FK_202bf978905567f68c508878277" FOREIGN KEY ("doc_id") REFERENCES "my_docs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "my_todos" DROP CONSTRAINT "FK_202bf978905567f68c508878277"`);
        await queryRunner.query(`DROP TABLE "my_todos"`);
        await queryRunner.query(`DROP TABLE "my_docs"`);
    }

}
