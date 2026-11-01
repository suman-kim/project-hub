import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePalette } from './Palette';
import { AppRegisterDialog } from '../screens/dialogs/AppRegisterDialog';
import { CreateTaskDialog, type CreateTaskPreset } from '../screens/dialogs/CreateTaskDialog';
import { ConceptGenDialog, GenDialog } from '../screens/dialogs/GenDialogs';

/** 어느 화면에서든 여는 창. 팔레트의 "동작"도 여기로 연다 */
export type DialogRequest = { kind: 'appReg' } | ({ kind: 'createTask' } & CreateTaskPreset) | { kind: 'gen'; app?: string } | { kind: 'conceptGen' };

interface DialogsApi {
  open(d: DialogRequest): void;
}

const DialogsContext = createContext<DialogsApi | null>(null);

export function useDialogs(): DialogsApi {
  const d = useContext(DialogsContext);
  if (!d) throw new Error('DialogsProvider 밖에서 useDialogs를 불렀다');
  return d;
}

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const palette = usePalette();
  const api = useMemo<DialogsApi>(() => ({ open: setCurrent }), []);

  useEffect(
    () =>
      palette.register([
        { key: 'act-createTask', label: 'task 추가', sub: '동작', run: () => setCurrent({ kind: 'createTask' }) },
        { key: 'act-gen', label: '기획 지금 생성', sub: '동작', run: () => setCurrent({ kind: 'gen' }) },
        { key: 'act-conceptGen', label: '새 앱 기획 생성', sub: '동작', run: () => setCurrent({ kind: 'conceptGen' }) },
        { key: 'act-appReg', label: '앱 등록', sub: '동작', run: () => setCurrent({ kind: 'appReg' }) },
      ]),
    [palette],
  );

  const close = () => setCurrent(null);
  return (
    <DialogsContext.Provider value={api}>
      {children}
      {current?.kind === 'appReg' && <AppRegisterDialog onClose={close} />}
      {current?.kind === 'createTask' && <CreateTaskDialog preset={current} onClose={close} />}
      {current?.kind === 'gen' && <GenDialog app={current.app} onClose={close} />}
      {current?.kind === 'conceptGen' && <ConceptGenDialog onClose={close} />}
    </DialogsContext.Provider>
  );
}
