import { describe, expect, it } from 'vitest';
import { boardTint, cardStyle, isHexColor, labelTint, lineStroke, normalizeHex, textOn } from './colors';
import { iconMedia, mediaRefsOf, type ZElement } from '../model/types';
import { iconSize } from '../icons/iconImage';

describe('custom colours', () => {
  it('tells a custom colour from a preset key', () => {
    expect(isHexColor('#7cd651')).toBe(true);
    expect(isHexColor('blue')).toBe(false);
    expect(isHexColor('#7cd65')).toBe(false);
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#7CD651ff')).toBe('#7cd651');
    expect(normalizeHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(normalizeHex('blue')).toBeNull();
  });

  it('picks readable text by brightness', () => {
    expect(textOn('#ffffff')).toBe('#16181d');
    expect(textOn('#fff6d6')).toBe('#16181d');
    expect(textOn('#16181d')).toBe('#ffffff');
    expect(textOn('#2f54eb')).toBe('#ffffff');
    expect(textOn('#f5c400')).toBe('#16181d');
  });

  it('draws presets from the theme and custom colours as they are', () => {
    expect(cardStyle('yellow')).toEqual({ background: 'var(--card-yellow)' });
    expect(cardStyle('transparent')).toEqual({});
    expect(cardStyle('#16181d')).toMatchObject({ background: '#16181d', color: '#ffffff', '--ink': '#ffffff' });
    expect(boardTint('green').fg).toBe('var(--board-green-fg)');
    expect(boardTint('#ff8d48')).toMatchObject({ fg: '#ff8d48' });
    expect(boardTint('#ff8d48').bg).toContain('color-mix');
    expect(lineStroke('red')).toBe('var(--line-red)');
    expect(lineStroke('#123456')).toBe('#123456');
    expect(labelTint('#123456').dot).toBe('#123456');
  });
});

describe('board pictures', () => {
  it('reads the stored picture of an icon and keeps it from being cleaned up', () => {
    expect(iconMedia('media:abc123.png')).toEqual({ id: 'abc123', ext: 'png' });
    expect(iconMedia('lucide:film')).toBeNull();
    expect(iconMedia('emoji:🎬')).toBeNull();
    expect(iconMedia('media:../x.png')).toBeNull();
    const board = { id: 'b', type: 'BOARD', icon: 'media:abc123.jpg' } as unknown as ZElement;
    expect(mediaRefsOf(board)).toEqual([{ id: 'abc123', ext: 'jpg' }]);
    expect(mediaRefsOf({ ...board, icon: 'lucide:film' } as ZElement)).toEqual([]);
  });

  it('scales large pictures down to 320 px, never up', () => {
    expect(iconSize(4000, 3000)).toEqual({ width: 320, height: 240 });
    expect(iconSize(100, 1000)).toEqual({ width: 32, height: 320 });
    expect(iconSize(64, 64)).toEqual({ width: 64, height: 64 });
  });
});
