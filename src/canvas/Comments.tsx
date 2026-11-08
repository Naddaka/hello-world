import { useMemo, useState } from 'react';
import { actions, useStore } from '../model/store';
import type { CommentElement } from '../model/types';
import { IconComment } from '../ui/icons';
import { usePresent } from '../ui/Presentation';

const REACTIONS = ['👍', '❤️', '🎬', '✅'];
const timeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A comment thread: messages, reactions and a reply field. */
export function CommentThread({ element, autoFocus = false }: { element: CommentElement; autoFocus?: boolean }) {
  const [draft, setDraft] = useState('');
  const send = () => {
    actions.addCommentMessage(element.id, draft);
    setDraft('');
  };
  return (
    <div className="comment" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {element.messages.map((m) => (
        <div key={m.id} className="comment-msg">
          <div className="comment-meta">
            <span className="comment-avatar" aria-hidden="true">Я</span>
            <span>Вы · {timeFmt.format(m.at)}</span>
          </div>
          <div className="comment-text">{m.text}</div>
          <div className="comment-reactions">
            {REACTIONS.map((r) => (
              <button key={r} type="button" className={`reaction${m.reactions.includes(r) ? ' on' : ''}`} aria-pressed={m.reactions.includes(r)} onClick={() => actions.toggleReaction(element.id, m.id, r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      ))}
      <form className="comment-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor={`reply-${element.id}`}>{element.messages.length ? 'Ответить' : 'Комментарий'}</label>
        <textarea
          id={`reply-${element.id}`}
          autoFocus={autoFocus}
          value={draft}
          rows={2}
          placeholder={element.messages.length ? 'Ответить…' : 'Напишите комментарий…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="btn-accent" disabled={!draft.trim()}>Отправить</button>
      </form>
      {element.attachedTo && (
        <button type="button" className="link-btn" onClick={() => actions.update(element.id, { attachedTo: null })}>Открепить от карточки</button>
      )}
    </div>
  );
}

export function CommentCard({ element, selected }: { element: CommentElement; selected: boolean }) {
  return (
    <div className={`note comment-card${selected ? ' selected' : ''}`}>
      <div className="comment-head"><IconComment size={15} /> Комментарий</div>
      <CommentThread element={element} autoFocus={element.messages.length === 0} />
    </div>
  );
}

/** Markers of comments pinned to a card; a click opens the thread next to it. */
export function CommentMarkers({ elementId }: { elementId: string }) {
  const elements = useStore((s) => s.elements);
  const hidden = usePresent((s) => s.active && s.hideComments);
  const pinned = useMemo(() => Object.values(elements).filter((e): e is CommentElement => e.type === 'COMMENT' && e.attachedTo === elementId && e.section !== 'TRASH'), [elements, elementId]);
  const [open, setOpen] = useState<string | null>(null);
  if (pinned.length === 0 || hidden) return null;
  return (
    <div className="comment-markers" onPointerDown={(e) => e.stopPropagation()}>
      {pinned.map((c) => (
        <div key={c.id} style={{ position: 'relative' }}>
          <button type="button" className="comment-marker" aria-label={`Комментарий: ${c.messages.length}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
            <IconComment size={13} />
            {c.messages.length}
          </button>
          {open === c.id && (
            <div className="comment-pop panel">
              <CommentThread element={c} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function newCommentFields() {
  return { type: 'COMMENT' as const, messages: [], attachedTo: null };
}
