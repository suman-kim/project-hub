import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 개발 중에는 vite(5173)가 화면을 내고 API·WebSocket은 Hub(2424, HUB_URL로 바꿀 수 있다)로 넘긴다.
// 빌드한 파일은 Hub가 직접 내보낸다.
const hub = process.env.HUB_URL ?? 'http://127.0.0.1:2424';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // @hub/shared는 서버용 CommonJS로 빌드되므로, 화면은 TypeScript 원본을 직접 묶는다.
    alias: { '@hub/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Host를 바꾸지 않아야 서버가 데이터를 바꾸는 요청의 Origin(5173)과 Host가 같은지 확인할 수 있다.
    proxy: {
      '/api': { target: hub, changeOrigin: false },
      // 문서 탭의 파일 보기 주소 (/view/<서명>/docs/…)
      '/view': { target: hub, changeOrigin: false },
      '/ws': { target: hub.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
    },
  },
});
