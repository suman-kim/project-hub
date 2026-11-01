import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { onUnauthorized } from './api/client';
import { keys, useMe, type Me } from './api/queries';
import { useLiveUpdates } from './api/ws';
import { HubDown } from './components/HubDown';
import { Layout } from './components/Layout';
import { PaletteProvider } from './components/Palette';
import { Login } from './screens/Login';
import { DialogsProvider } from './components/GlobalDialogs';
import { AppPage } from './screens/AppPage';
import { NewApp } from './screens/NewApp';
import { Board } from './screens/Board';
import { Today } from './screens/Today';
import { Ideas } from './screens/Ideas';
import { Runs } from './screens/Runs';
import { RunDetail } from './screens/RunDetail';
import { Session } from './screens/Session';
import { Sessions } from './screens/Sessions';
import { SessionPanelHost } from './components/SessionPanel';
import { Rules } from './screens/Rules';
import { Environment } from './screens/Environment';
import { Mine } from './screens/Mine';
import { Costs } from './screens/Costs';
import { TaskPanelHost } from './components/TaskPanel';

export function App() {
  const qc = useQueryClient();
  const me = useMe();
  const loggedIn = !!me.data?.loggedIn;
  useLiveUpdates(loggedIn);

  useEffect(
    () =>
      onUnauthorized(() => {
        const prev = qc.getQueryData<Me>(keys.me);
        qc.setQueryData<Me>(keys.me, { loggedIn: false, passwordSet: prev?.passwordSet ?? true });
      }),
    [qc],
  );

  if (me.isLoading) return null;
  if (me.isError) return <HubDown onRetry={() => void me.refetch()} />;
  if (!loggedIn) return <Login me={me.data} />;

  return (
    <PaletteProvider>
      <DialogsProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/board" element={<Board />} />
            <Route path="/ideas" element={<Ideas />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:code/:sid" element={<Session />} />
            <Route path="/new-app" element={<NewApp />} />
            <Route path="/apps" element={<Navigate to="/new-app" replace />} />
            <Route path="/apps/:code/:tab?" element={<AppPage />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/environment" element={<Environment />} />
            <Route path="/mine" element={<Mine />} />
            <Route path="/costs" element={<Costs />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
        <TaskPanelHost />
        <SessionPanelHost />
      </DialogsProvider>
    </PaletteProvider>
  );
}
