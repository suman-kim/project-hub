import { ConflictException, Controller, Delete, Get, HttpCode, Param, ParseIntPipe } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { SessionViewDto } from '@hub/shared';
import { AppsService } from '../apps/apps.service';
import { ReposService } from '../repos/repos.service';
import { RulesService, toRuleDto } from '../rules/rules.service';
import { SessionsService } from '../sessions/sessions.service';
import { BgSessionsService } from './bg-sessions.service';
import { OverviewService } from './overview.service';

@Controller('api/apps')
export class OverviewController {
  constructor(
    private readonly overview: OverviewService,
    private readonly apps: AppsService,
    private readonly repos: ReposService,
    private readonly sessions: BgSessionsService,
    private readonly rules: RulesService,
    private readonly sessionViews: SessionsService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /**
   * 앱 삭제. task를 먼저 지우고(앱 삭제를 막는 연결) 앱을 지우면 저장소 목록·기획·배포 기록·히스토리·규칙·실수 기록이 함께 지워진다.
   * run 기록은 비용 합계를 위해 남긴다(task 연결만 끊긴다). 로컬 폴더, worktree, GitHub 저장소는 건드리지 않는다.
   * 진행 중인 run이 있으면 거부한다.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const app = await this.apps.get(id);
    const [busy] = await this.ds.query(
      `SELECT count(*)::int AS n FROM runs r LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.status IN ('queued', 'running', 'input')
         AND COALESCE(t.app_id, (r.result->'idea'->>'appId')::int, (r.result->'bootstrap'->>'appId')::int) = $1`,
      [id],
    );
    if (busy.n) throw new ConflictException(`앱 ${app.code}에 진행 중인 run ${busy.n}개가 있어 지울 수 없다`);
    // 자동 생성 schedule을 먼저 내린다(app.updated로 scheduler가 맞춘다).
    if (app.ideaCron) await this.apps.update(id, { ideaCron: null });
    await this.ds.transaction(async (m) => {
      await m.query('DELETE FROM tasks WHERE app_id = $1', [id]);
      await m.query('DELETE FROM apps WHERE id = $1', [id]);
    });
    // 앱 규칙이 지워졌으니 규칙 파일을 다시 쓴다.
    await this.rules.replaceAll((await this.rules.list()).map((r) => ({ appCode: toRuleDto(r).appCode, body: r.body })));
  }

  /** 사이드바: 앱마다 진행 상태와 자동 신호(점 색) */
  @Get('status')
  status() {
    return this.overview.status();
  }

  /** 앱 페이지 개요 */
  @Get(':id/overview')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.overview.overview(await this.apps.get(id));
  }

  /**
   * 이 앱 폴더에서 열려 있는 내 세션(터미널에서 연 claude). hook 기록으로 찾는다.
   * 끝남(SessionEnd)이 없고 3일 안에 활동이 있는 것만. task 패널의 "이 세션에서 하기"에 쓴다.
   */
  @Get(':id/open-sessions')
  async openSessions(@Param('id', ParseIntPipe) id: number) {
    await this.apps.get(id);
    return this.ds.query(
      `WITH s AS (
         SELECT s.id, s.claude_session_id AS "claudeSessionId", s.cwd, s.task_id AS "taskId", s.started_at AS "startedAt",
                (SELECT max(e.created_at) FROM session_events e WHERE e.session_id = s.id) AS "lastAt"
         FROM sessions s WHERE s.app_id = $1 AND s.ended_at IS NULL AND s.origin = 'local')
       SELECT * FROM s WHERE COALESCE("lastAt", "startedAt") > now() - interval '3 days'
       ORDER BY COALESCE("lastAt", "startedAt") DESC LIMIT 10`,
      [id],
    );
  }

  /** 세션 탭: 이 앱의 Claude 세션(내가 연 것과 Hub가 띄운 것) 중 7일 안에 활동한 것 */
  @Get(':id/claude-sessions')
  async claudeSessions(@Param('id', ParseIntPipe) id: number): Promise<SessionViewDto[]> {
    await this.apps.get(id);
    return this.sessionViews.views({ appId: id, limit: 60 });
  }

  /** 이 앱 폴더에서 도는 Hub 밖 세션(claude --bg): 상태, 허락을 기다리는 명령, 원격 조종 링크 */
  @Get(':id/sessions')
  async sessionsOf(@Param('id', ParseIntPipe) id: number) {
    const app = await this.apps.get(id);
    const repos = await this.repos.list(app.id);
    const list = await this.sessions.under([app.repoPath ?? '', ...repos.map((r) => r.path)]);
    const saved: Array<{ id: string; link: string | null }> = await this.ds.query(
      `SELECT result->'bootstrap'->'rc'->>'id' AS id, result->'bootstrap'->'rc'->>'link' AS link FROM runs WHERE kind = 'bootstrap' AND result->'bootstrap' ? 'rc'`,
    );
    return Promise.all(
      list.map(async (s) => ({
        id: s.id ?? s.sessionId,
        sessionId: s.sessionId,
        name: s.name ?? null,
        cwd: s.cwd,
        status: s.status,
        waitingFor: s.waitingFor ?? null,
        pending: s.status === 'waiting' ? this.sessions.pendingTool(s.sessionId) : null,
        remoteLink: s.id ? await this.sessions.remoteLink(s.id, saved.find((x) => x.id === s.id)?.link) : null,
        attachCommand: s.id ? `claude attach ${s.id}` : null,
      })),
    );
  }
}
