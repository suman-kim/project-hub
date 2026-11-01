import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { extname } from 'node:path';
import { Public } from '../../common/public.decorator';
import { ProjectFilesService } from './project-files.service';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

@Controller('api/apps/:id/files')
export class ProjectFilesController {
  constructor(private readonly files: ProjectFilesService) {}

  /** 문서 탭: 앱 폴더와 저장소마다의 docs/·design/ 파일과 보기 주소 */
  @Get()
  list(@Param('id', ParseIntPipe) id: number) {
    return this.files.list(id);
  }
}

/**
 * 문서 탭의 보기 주소. 쿠키 없이 서명으로 연다. 디자인 HTML의 스크립트가 대시보드 쿠키·API에 닿지 않게
 * sandbox(다른 출처로 취급)로 내보내고, 주소가 외부 글꼴 요청 등에 실려 나가지 않게 referrer를 끈다.
 */
@Controller('view')
export class ProjectViewController {
  constructor(private readonly files: ProjectFilesService) {}

  @Public()
  @Get(':token/*path')
  async view(@Param('token') token: string, @Param('path') path: string | string[], @Res() res: Response) {
    const segments = Array.isArray(path) ? path : path.split('/');
    // sandbox 안의 페이지(출처 없음)가 같은 폴더의 파일을 fetch로 읽을 수 있게 한다. 주소 자체가 열쇠다.
    // 없는 파일도 CORS 오류가 아니라 404로 보이게 오류 응답에도 붙인다.
    res.setHeader('Access-Control-Allow-Origin', '*');
    const file = await this.files.resolve(token, segments);
    const ext = extname(file).toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-cache');
    // PDF는 sandbox에서 브라우저 보기 화면이 뜨지 않는다. PDF에는 스크립트가 돌지 않으니 뺀다.
    if (ext !== '.pdf') res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads');
    res.sendFile(file);
  }
}
