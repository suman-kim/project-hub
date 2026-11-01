import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** 모든 오류를 { error: { status, message, details? } } 형식으로 돌려준다. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      const details = typeof body === 'object' ? (body as { details?: unknown }).details : undefined;
      res.status(status).json({ error: { status, message, ...(details ? { details } : {}) } });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { status: 500, message: '서버 내부 오류' } });
  }
}
