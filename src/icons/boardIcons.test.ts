import { describe, expect, it } from 'vitest';
import lucide from './lucide.json';
import emojiData from './emoji-ru.json';
import { RU_ICON_WORDS, SUGGESTED_ICONS, englishTerms, searchEmoji, searchLucide, type EmojiEntry, type LucideIcon } from './boardIcons';

const icons = lucide as unknown as LucideIcon[];
const emoji = (emojiData as unknown as { emoji: EmojiEntry[] }).emoji;

describe('board icons', () => {
  it('has the full sets', () => {
    expect(icons.length).toBeGreaterThan(2000);
    expect(emoji.length).toBeGreaterThan(1800);
  });

  it('suggests only icons that exist', () => {
    const names = new Set(icons.map((i) => i[0]));
    expect(SUGGESTED_ICONS.filter((n) => !names.has(n))).toEqual([]);
  });

  it('every Russian word finds icons', () => {
    const dead = Object.keys(RU_ICON_WORDS).filter((w) => searchLucide(icons, w.replace(/_$/, ''), 5).length === 0);
    expect(dead).toEqual([]);
  });

  it('searches in Russian and English', () => {
    expect(englishTerms('видеосъёмка')).toContain('video');
    expect(searchLucide(icons, 'видео', 50).map((i) => i[0])).toContain('clapperboard');
    expect(searchLucide(icons, 'деньги', 80).map((i) => i[0])).toContain('piggy-bank');
    expect(searchLucide(icons, 'rocket', 5)[0][0]).toBe('rocket');
    expect(searchEmoji(emoji, 'кот', 20).length).toBeGreaterThan(0);
    expect(searchEmoji(emoji, 'праздник', 20).length).toBeGreaterThan(0);
  });
});
