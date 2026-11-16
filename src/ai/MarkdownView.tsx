import { useMemo } from 'react';
import { generateHTML } from '@tiptap/core';
import { noteExtensions } from '../editor/extensions';
import { media } from '../storage/media';
import { CARD_LINK } from './boardText';
import { markdownToDoc } from './markdown';

const extensions = noteExtensions();

/** The model's markdown shown as the app's rich text. Links to cards call `onCard`; web links open in the browser. */
export function Markdown({ text, className = '', onCard }: { text: string; className?: string; onCard?: (id: string) => void }) {
  const html = useMemo(() => {
    try {
      return generateHTML(markdownToDoc(text), extensions);
    } catch {
      return '';
    }
  }, [text]);
  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    // Never let a link navigate the app's own window.
    e.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith(CARD_LINK)) onCard?.(href.slice(CARD_LINK.length));
    else if (/^https?:\/\//i.test(href)) void media().then((m) => m.openUrl(href));
  };
  if (!html) return <div className={`rt ai-md ${className}`} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  return <div className={`rt ai-md ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
