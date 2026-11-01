import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'hub:isPublic';
/** 토큰 검사를 건너뛴다. GET /health 에만 쓴다. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
