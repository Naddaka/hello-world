import { describe, expect, it } from 'vitest';
import { shortcutKey } from './keys';

describe('shortcutKey', () => {
  it('uses the typed letter on Latin layouts', () => {
    expect(shortcutKey({ key: 'z', code: 'KeyZ' })).toBe('z');
    expect(shortcutKey({ key: 'D', code: 'KeyD' })).toBe('d');
    // AZERTY: the key labelled Z sits where QWERTY has W — follow the label.
    expect(shortcutKey({ key: 'z', code: 'KeyW' })).toBe('z');
  });

  it('falls back to the physical key on Cyrillic layouts', () => {
    expect(shortcutKey({ key: 'я', code: 'KeyZ' })).toBe('z');
    expect(shortcutKey({ key: 'В', code: 'KeyD' })).toBe('d');
    expect(shortcutKey({ key: 'х', code: 'BracketLeft' })).toBe('[');
    expect(shortcutKey({ key: 'ъ', code: 'BracketRight' })).toBe(']');
    expect(shortcutKey({ key: 'і', code: 'KeyS' })).toBe('s');
  });

  it('leaves named keys, digits and symbols alone', () => {
    expect(shortcutKey({ key: 'Escape', code: 'Escape' })).toBe('Escape');
    expect(shortcutKey({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('ArrowUp');
    expect(shortcutKey({ key: '0', code: 'Digit0' })).toBe('0');
    expect(shortcutKey({ key: '=', code: 'Equal' })).toBe('=');
  });
});
