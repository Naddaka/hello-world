import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * The app's own confirmation dialog. window.confirm cannot be used: in the
 * desktop app's web view it returns true without asking anything.
 */
interface Ask {
  title: string;
  message: string;
  confirm: string;
  cancel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ ask: Ask | null }>(() => ({ ask: null }));

export function confirmDialog(options: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().ask?.resolve(false);
    useConfirm.setState({ ask: { ...options, resolve } });
  });
}

export function ConfirmDialog() {
  const ask = useConfirm((s) => s.ask);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const okButton = useRef<HTMLButtonElement>(null);

  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    useConfirm.setState({ ask: null });
  };

  useEffect(() => {
    if (!ask) return;
    // A destructive action starts on "Cancel", so a stray Enter does no harm.
    (ask.danger ? cancelButton : okButton).current?.focus();
    // Capture phase: Escape answers this dialog and never reaches the editor underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        answer(false);
      } else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  if (!ask) return null;
  return (
    <div className="modal-backdrop confirm-backdrop" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="modal panel confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
        <div className="modal-body">
          <h2 id="confirm-title" className="confirm-title">
            {ask.title}
          </h2>
          <p id="confirm-text">{ask.message}</p>
          <footer className="modal-foot">
            <button ref={cancelButton} type="button" className="ibtn wide" onClick={() => answer(false)}>
              {ask.cancel ?? 'Отмена'}
            </button>
            <button ref={okButton} type="button" className={ask.danger ? 'btn-accent btn-danger' : 'btn-accent'} onClick={() => answer(true)}>
              {ask.confirm}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
