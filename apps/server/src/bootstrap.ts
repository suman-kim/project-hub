import express, { json } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpErrorFilter } from './common/http-error.filter';

/**
 * 화면이 아니라 서버가 받는 경로. /.well-known은 MCP 클라이언트가 OAuth 정보를 찾는 곳이라 404 JSON이어야 한다.
 * /view는 문서 탭의 프로젝트 파일 보기 주소다.
 */
const SERVER_PATHS = ['/api', '/mcp', '/ws', '/health', '/.well-known', '/view'];

/** main.ts와 e2e 테스트가 같은 설정을 쓰도록 한곳에 둔다. */
export function configureApp(app: NestExpressApplication): void {
  // PostToolUse hook 입력에는 파일 내용이 통째로 들어올 수 있어 기본 100kb로는 모자란다.
  app.use(json({ limit: '20mb' }));
  serveWeb(app, process.env.HUB_WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist'));
  app.useGlobalFilters(new HttpErrorFilter());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
}

/**
 * 빌드한 대시보드(apps/web/dist)를 /에서 내보낸다. 화면 주소(/tasks/LK-1 등)는 모두 index.html로 보내
 * 브라우저 라우터가 처리하게 한다. 로그인 화면도 여기서 나오므로 토큰 가드를 거치지 않는다.
 * 빌드하지 않았으면 아무것도 하지 않는다(API만 쓰는 개발·테스트).
 */
function serveWeb(app: NestExpressApplication, dir: string): void {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return;
  const isServerPath = (path: string) => SERVER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  app.use(
    express.static(dir, {
      index: false,
      // 빌드 파일 이름에 내용 해시가 붙어 있어 오래 둬도 된다.
      setHeaders: (res, path) => res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }),
  );
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    // 브라우저가 화면을 열 때(Accept: text/html)만 index.html로 보낸다. 다른 클라이언트는 404 JSON을 받는다.
    const page = (req.method === 'GET' || req.method === 'HEAD') && (req.headers.accept ?? '').includes('text/html');
    if (!page || isServerPath(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
