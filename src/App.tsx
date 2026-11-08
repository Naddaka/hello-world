import { useEffect } from 'react';
import { actions, flushPersist, useStore } from './model/store';
import { openRepo, isTauri } from './storage/repo';
import { Canvas, dropPoint } from './canvas/Canvas';
import { isOverViewport } from './canvas/runtime';
import { addFiles } from './model/importing';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { ContextMenu } from './ui/ContextMenu';
import { useShortcuts } from './ui/useShortcuts';
import { useClipboard } from './ui/clipboard';
import { InboxPanel, TrashPanel } from './ui/Panels';
import { SearchPanel } from './ui/SearchPanel';
import { LabelPicker } from './ui/Labels';
import { DocumentOverlay } from './doc/DocumentView';
import { SketchEditorOverlay } from './draw/SketchEditor';
import { PresentBar, usePresent } from './ui/Presentation';
import { MilanoteImportDialog } from './import/MilanoteImport';
import { ScriptOverlay } from './script/ScriptEditor';

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
  const presenting = usePresent((s) => s.active);
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
    let unlistenDrop: (() => void) | undefined;
    if (isTauri()) {
      // Files dragged in from Finder arrive as paths, so large videos are copied natively.
      import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type !== 'drop' || event.payload.paths.length === 0) return;
            const ratio = window.devicePixelRatio || 1;
            const x = event.payload.position.x / ratio;
            const y = event.payload.position.y / ratio;
            if (!isOverViewport(x, y)) return;
            const { point, parent } = dropPoint(x, y);
            void addFiles(event.payload.paths, point, parent);
          })
          .then((fn) => (unlistenDrop = fn)),
      );
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
      unlistenDrop?.();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!ready) return <div className="loading">Загрузка…</div>;
  return (
    <div className={`app${presenting ? ' presenting' : ''}`}>
      {!presenting && <TopBar />}
      <div style={{ position: 'relative', flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <Canvas />
        {!presenting && <Toolbar />}
        {!presenting && panel === 'inbox' && <InboxPanel />}
        {!presenting && panel === 'trash' && <TrashPanel />}
        <PresentBar />
        <Toast />
      </div>
      {panel === 'search' && <SearchPanel />}
      <ContextMenu />
      <LabelPicker />
      <DocumentOverlay />
      <SketchEditorOverlay />
      <ScriptOverlay />
      <MilanoteImportDialog />
    </div>
  );
}
