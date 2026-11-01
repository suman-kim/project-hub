import { ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StreamEvent } from './stream-parser';

export interface ExecuteOptions {
  cwd: string;
  prompt: string;
  /** 있으면 --resume으로 같은 대화를 잇는다 */
  resumeSessionId?: string | null;
  env: Record<string, string>;
  allowedTools: string[];
  /** 구현 run은 acceptEdits, 아이디어 생성은 읽기 전용이라 dontAsk */
  permissionMode: 'acceptEdits' | 'dontAsk';
  /** 없으면(null) 구조화 출력 없이 마지막 답변만 받는다(세션 이어서 하기) */
  jsonSchema: object | null;
  model?: string | null;
  onEvent: (ev: StreamEvent) => void;
  onStderr?: (line: string) => void;
}

export interface Execution {
  pid: number | undefined;
  /** SIGINT로 멈춘다 */
  stop(): void;
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/** 실행기 인터페이스. 지금은 CLI, 나중에 Agent SDK 구현으로 바꿀 수 있다. */
export interface ClaudeExecutor {
  execute(opts: ExecuteOptions): Execution;
}

export const CLAUDE_EXECUTOR = Symbol('CLAUDE_EXECUTOR');

export interface CliExecutorConfig {
  claudeBin: string;
  caffeinate: boolean;
}

/** claude -p를 자식 프로세스로 띄워 stream-json을 한 줄씩 읽는다. 맥북 로그인 계정으로 돌고 --bare는 쓰지 않는다. */
export class CliClaudeExecutor implements ClaudeExecutor {
  constructor(private readonly config: CliExecutorConfig) {}

  execute(opts: ExecuteOptions): Execution {
    const args = [
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      opts.permissionMode,
    ];
    if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));
    if (opts.allowedTools.length) args.push('--allowedTools', opts.allowedTools.join(','));
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
    if (opts.model) args.push('--model', opts.model);

    const child: ChildProcess = spawn(this.config.claudeBin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      // stdin을 열어 두면 claude가 입력을 3초 기다린다.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 실행 중에는 맥북이 잠들지 않게 한다. claude가 끝나면 caffeinate도 같이 끝난다.
    if (this.config.caffeinate && child.pid) {
      spawn('caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore' }).on('error', () => undefined);
    }

    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!line.trim()) return;
      try {
        opts.onEvent(JSON.parse(line) as StreamEvent);
      } catch {
        opts.onEvent({ type: 'unparsed', text: line });
      }
    });
    createInterface({ input: child.stderr! }).on('line', (line) => opts.onStderr?.(line));

    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('error', (err) => {
        opts.onStderr?.(`실행 실패: ${err.message}`);
        resolve({ exitCode: -1, signal: null });
      });
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });

    return { pid: child.pid, stop: () => child.kill('SIGINT'), done };
  }
}
