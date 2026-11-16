import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { noteExtensions } from '../editor/extensions';
import { docText } from '../model/text';
import { markdownToDoc } from './markdown';

const schema = getSchema(noteExtensions());

describe('markdown from the model', () => {
  it('becomes rich text the editor accepts', () => {
    const doc = markdownToDoc(
      [
        '# Сводка',
        '',
        'Первый абзац с **жирным**, *курсивом*, `кодом` и [ссылкой](https://example.com).',
        'Продолжение абзаца.',
        '',
        '## Задачи',
        '- раз',
        '- два',
        '  - вложенный',
        '  - ещё',
        '- три',
        '',
        '1. первый',
        '2. второй',
        '',
        '> цитата',
        '',
        '```',
        'код',
        '```',
        '---',
        '### Мелкий заголовок',
      ].join('\n'),
    );
    Node.fromJSON(schema, doc).check();
    expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'heading']);
    expect(doc.content![0].attrs).toEqual({ level: 1 });
    expect(doc.content![8].attrs).toEqual({ level: 2 });
    const marks = doc.content![1].content!.flatMap((n) => (n.marks ?? []).map((m) => m.type));
    expect(marks).toEqual(['bold', 'italic', 'code', 'link']);
    const list = doc.content![3];
    expect(list.content).toHaveLength(3);
    expect(list.content![1].content![1]).toMatchObject({ type: 'bulletList' });
    expect(list.content![1].content![1].content).toHaveLength(2);
    expect(docText(doc)).toContain('Продолжение абзаца.');
  });

  it('keeps odd input as text', () => {
    const doc = markdownToDoc('a * b * c и 2*3=6\n\n**не закрыто');
    Node.fromJSON(schema, doc).check();
    expect(docText(doc)).toContain('**не закрыто');
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
