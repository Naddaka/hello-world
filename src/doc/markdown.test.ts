import { describe, expect, it } from 'vitest';
import { toMarkdown } from './markdown';

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text, marks });
const p = (...content: object[]) => ({ type: 'paragraph', content });

describe('markdown export', () => {
  it('converts headings, marks, links and lists', () => {
    const md = toMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Северный ветер')] },
        p(t('Клип '), t('одним планом', [{ type: 'bold' }]), t(', '), t('синий час', [{ type: 'italic' }]), t(' — '), t('референс', [{ type: 'link', attrs: { href: 'https://vimeo.com/1' } }])),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('3:42'))] }, { type: 'listItem', content: [p(t('2.39:1')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('4K'))] }] }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('Пирс'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('Порт'))] }] },
        { type: 'blockquote', content: [p(t('Дальше — только море.'))] },
      ],
    });
    expect(md).toBe(
      [
        '# Северный ветер',
        '',
        'Клип **одним планом**, *синий час* — [референс](https://vimeo.com/1)',
        '',
        '- 3:42',
        '- 2.39:1',
        '  - 4K',
        '',
        '- [x] Пирс',
        '- [ ] Порт',
        '',
        '> Дальше — только море.',
        '',
      ].join('\n'),
    );
  });

  it('escapes markdown characters in plain text', () => {
    expect(toMarkdown({ type: 'doc', content: [p(t('a*b_c'))] })).toBe('a\\*b\\_c\n');
  });
});
