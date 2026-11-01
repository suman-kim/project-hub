import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { UiProvider } from './components/ui';
import { applyTheme, PrefsProvider, readPref, type Theme } from './lib/prefs';
import './styles/tokens.css';
import './styles/ui.css';

// 첫 그림부터 고른 테마로 그린다.
applyTheme(readPref<Theme>('hub.theme', 'system', ['system', 'light', 'dark']));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 데이터가 바뀌면 WebSocket 이벤트로 다시 읽으므로 창을 다시 볼 때마다 읽을 필요는 없다.
      refetchOnWindowFocus: false,
      staleTime: 10_000,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PrefsProvider>
          <UiProvider>
            <App />
          </UiProvider>
        </PrefsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
