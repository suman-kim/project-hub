import type { DeployEnv, DeployStatus } from '@hub/shared';

/** GitHub 환경 이름 → Hub 환경. "Cyphers Meta / production", "Production", "daily-work / development" 등 */
export function envOf(environment: string): DeployEnv {
  const e = environment.toLowerCase();
  if (/stag/.test(e)) return 'staging';
  if (/preview|pr-\d/.test(e)) return 'preview';
  if (/dev/.test(e)) return 'development';
  return 'production';
}

/** GitHub 배포 상태 → Hub 상태 */
export function deploymentStatusOf(state: string | undefined): DeployStatus {
  switch (state) {
    case 'success':
      return 'success';
    case 'failure':
    case 'error':
      return 'failure';
    case 'inactive':
      return 'inactive';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'queued';
  }
}

/** Actions 실행 상태·결론 → Hub 상태 */
export function workflowStatusOf(status: string, conclusion: string | null): DeployStatus {
  if (status !== 'completed') return status === 'in_progress' ? 'in_progress' : 'queued';
  if (conclusion === 'success') return 'success';
  if (conclusion === 'cancelled' || conclusion === 'skipped') return 'cancelled';
  return 'failure';
}

/** 이름으로 배포 워크플로를 짐작한다. 앱(스토어) 배포인지 서버 배포인지까지 */
export function guessDeployRule(name: string): DeployEnv | null {
  if (!/배포|출시|deploy|release|promote/i.test(name)) return null;
  return /앱|app|android|ios|store|스토어/i.test(name) ? 'store' : 'production';
}

/** 태그처럼 보이는 브랜치 이름(backend-v0.1.32, v1.2.0)은 버전으로 쓴다 */
export function versionOf(headBranch: string | null, sha: string): string {
  return headBranch && /v?\d+\.\d+/.test(headBranch) ? headBranch : sha.slice(0, 7);
}
