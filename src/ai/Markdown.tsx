import { useMemo } from 'react';
import { generateHTML } from '@tiptap/core';
import { noteExtensions } from '../editor/extensions';
import { markdownToDoc } from './markdown';

const extensions = noteExtensions();

/** The model's markdown shown as the app's rich text. */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return generateHTML(markdownToDoc(text), extensions);
    } catch {
      return '';
    }
  }, [text]);
  if (!html) return <div className={`rt ai-md ${className}`} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  return <div className={`rt ai-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
