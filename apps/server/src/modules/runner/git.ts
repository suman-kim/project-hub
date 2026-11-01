import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class CommandError extends Error {
  constructor(
    readonly cmd: string,
    readonly stderr: string,
  ) {
    super(`${cmd} 실패: ${stderr.trim().split('\n').slice(-3).join(' / ')}`);
  }
}

/** 셸을 거치지 않고 실행한다. 인자는 배열로만 받는다. */
export async function run(bin: string, args: string[], cwd: string, timeoutMs = 120_000, env?: Record<string, string>): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (e) {
    // 오류를 stdout에 쓰는 도구(claude --bg 등)도 있어 stderr가 비면 stdout을 쓴다.
    const err = e as { stderr?: string; stdout?: string; message: string };
    throw new CommandError(`${bin} ${args[0] ?? ''}`, err.stderr?.trim() || err.stdout?.trim() || err.message);
  }
}

/** 브랜치 이름에 쓸 영문 slug. 한글 제목이면 비어서 'task'가 된다. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
}
