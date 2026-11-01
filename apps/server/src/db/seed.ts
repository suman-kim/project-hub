// 앱 4개를 등록한다. 이미 있는 앱은 건너뛴다. 실행: pnpm --filter @hub/server seed
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dataSource from './data-source';

const project = (name: string) => join(homedir(), 'project', name);

const APPS = [
  { code: 'LK', name: 'Link', folder: 'link' },
  { code: 'HR', name: '하루알바', folder: 'daily-work' },
  { code: 'CM', name: 'cyphers-meta', folder: 'cyphers-meta' },
  { code: 'OA', name: '오늘알바', folder: 'today-alba' },
];

async function main() {
  await dataSource.initialize();
  await dataSource.runMigrations();
  for (const a of APPS) {
    const repoPath = existsSync(project(a.folder)) ? project(a.folder) : null;
    const res: unknown[] = await dataSource.query(
      `INSERT INTO apps (code, name, repo_path, folder_names) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [a.code, a.name, repoPath, [a.folder]],
    );
    console.log(`${a.code} ${a.name}: ${res.length ? '등록' : '이미 있음'} (repo_path=${repoPath ?? '없음'})`);
  }
  await dataSource.destroy();
}

void main();
