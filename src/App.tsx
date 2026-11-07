import { useEffect } from 'react';
import { actions, flushPersist, useStore } from './model/store';
import { openRepo, isTauri } from './storage/repo';
import { Canvas } from './canvas/Canvas';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { ContextMenu } from './ui/ContextMenu';
import { useShortcuts } from './ui/useShortcuts';
import { useClipboard } from './ui/clipboard';
import { InboxPanel, TrashPanel } from './ui/Panels';
import { SearchPanel } from './ui/SearchPanel';

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => actions.hideToast(), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  return toast ? (
    <div className="toast" role="status">
      {toast}
    </div>
  ) : null;
}

export function App() {
  const ready = useStore((s) => s.ready);
  const theme = useStore((s) => s.theme);
  const panel = useStore((s) => s.panel);
  useShortcuts();
  useClipboard();

  useEffect(() => {
    openRepo()
      .then((repo) => actions.init(repo))
      .catch((error) => {
        console.error(error);
        actions.showToast('Не удалось открыть хранилище данных');
      });
    const flush = () => void flushPersist();
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onCloseRequested(async () => {
            await flushPersist();
          })
          .then((fn) => (unlisten = fn)),
      );
    }
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!ready) return <div className="loading">Загрузка…</div>;
  return (
    <div className="app">
      <TopBar />
      <div style={{ position: 'relative', flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <Canvas />
        <Toolbar />
        {panel === 'inbox' && <InboxPanel />}
        {panel === 'trash' && <TrashPanel />}
        <Toast />
      </div>
      {panel === 'search' && <SearchPanel />}
      <ContextMenu />
    </div>
  );
}
