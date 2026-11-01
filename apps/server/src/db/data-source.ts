import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';

export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [join(__dirname, '..', 'modules', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    migrationsRun: true,
    synchronize: false,
  };
}

// typeorm CLI(migration:generate, migration:run)와 seed가 쓰는 DataSource. 쿼리 로그는 끈다.
export default new DataSource({
  ...dataSourceOptions(process.env.HUB_DATABASE_URL || 'postgres://hub:hub@127.0.0.1:5434/hub'),
  logging: ['error'],
});
