import { All, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AppsService } from '../apps/apps.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { IdeasService } from '../ideas/ideas.service';
import { ReposService } from '../repos/repos.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { TasksService } from '../tasks/tasks.service';
import { createHubMcpServer } from './hub-mcp.tools';

/**
 * Hub MCP 입구 (Streamable HTTP, 상태 없는 모드).
 * 요청마다 서버와 transport를 새로 만들어 세션 상태를 Hub에 두지 않는다. 토큰은 전역 가드가 검사한다.
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger('Mcp');

  constructor(
    private readonly tasks: TasksService,
    private readonly knowledge: KnowledgeService,
    private readonly ideas: IdeasService,
    private readonly apps: AppsService,
    private readonly deployments: DeploymentsService,
    private readonly repos: ReposService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = createHubMcpServer({
      tasks: this.tasks,
      knowledge: this.knowledge,
      ideas: this.ideas,
      apps: this.apps,
      deployments: this.deployments,
      repos: this.repos,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      this.logger.error(e instanceof Error ? e.stack : String(e));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: '서버 내부 오류' }, id: null });
      }
    }
  }

  /** 상태 없는 모드라 GET(SSE 스트림)과 DELETE(세션 종료)는 지원하지 않는다. */
  @All()
  notAllowed(@Res() res: Response): void {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  }
}
