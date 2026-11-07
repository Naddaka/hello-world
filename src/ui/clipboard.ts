import { useEffect } from 'react';
import { actions, descendants, useStore } from '../model/store';
import type { ZElement } from '../model/types';
import { elementText, textToDoc } from '../model/text';
import { lastPointer, viewportCentreGrid } from '../canvas/runtime';

const MARK = 'data-zadum-clipboard';

interface Payload {
  zadum: 1;
  roots: string[];
  elements: ZElement[];
}

function toBase64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  // Chunked so large boards do not exceed the argument limit of fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const fromBase64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Set while a menu command runs the copy, so it applies to cards even if a field has focus. */
let menuRequest: 'copy' | 'cut' | null = null;

/** Copies (or cuts) the selected cards from a menu, through the normal copy event. */
export function copySelection(cut: boolean) {
  menuRequest = cut ? 'cut' : 'copy';
  document.execCommand('copy');
  menuRequest = null;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
}

function pastePoint() {
  return lastPointer.valid ? { x: lastPointer.x, y: lastPointer.y } : viewportCentreGrid();
}

/**
 * Copy, cut and paste of cards. The clipboard carries both readable text (for
 * other apps) and a payload with the full elements (for pasting into Zadum).
 */
export function useClipboard() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      // While typing, copy and cut work on the text, not on the cards.
      if (!menuRequest && isTyping(e.target)) return;
      const { selection, elements } = useStore.getState();
      const roots = selection.map((id) => elements[id]).filter(Boolean);
      if (roots.length === 0 || !e.clipboardData) return;
      const all = [...roots, ...roots.flatMap((r) => descendants(elements, r.id).map((id) => elements[id]))];
      const payload: Payload = { zadum: 1, roots: roots.map((r) => r.id), elements: all };
      const text = roots.map(elementText).join('\n\n');
      e.clipboardData.setData('text/plain', text);
      e.clipboardData.setData('text/html', `<div ${MARK}="${toBase64(JSON.stringify(payload))}">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`);
      e.preventDefault();
      if (cut || menuRequest === 'cut') actions.trash(roots.map((r) => r.id));
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      const html = e.clipboardData.getData('text/html');
      const match = html.match(new RegExp(`${MARK}="([^"]+)"`));
      const at = pastePoint();
      if (match) {
        e.preventDefault();
        try {
          const payload = JSON.parse(fromBase64(match[1])) as Payload;
          const roots = payload.elements.filter((el) => payload.roots.includes(el.id));
          actions.paste(roots, payload.elements, at);
        } catch {
          actions.showToast('Не удалось вставить: данные в буфере повреждены');
        }
        return;
      }
      const text = e.clipboardData.getData('text/plain').trim();
      if (text) {
        e.preventDefault();
        actions.createCard(useStore.getState().boardId, at.x, at.y, { content: textToDoc(text), edit: false });
      }
    };

    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}
