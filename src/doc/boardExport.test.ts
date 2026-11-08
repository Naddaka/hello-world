import { describe, expect, it } from 'vitest';
import { withExtension } from './boardExport';

describe('file names in the board ZIP', () => {
  it('end in the stored file\'s real extension', () => {
    expect(withExtension('Скетч', 'svg')).toBe('Скетч.svg');
    expect(withExtension('изображение.jpg', 'svg')).toBe('изображение.svg');
    expect(withExtension('photo.JPG', 'jpg')).toBe('photo.JPG');
    expect(withExtension('photo.jpeg', 'jpg')).toBe('photo.jpeg');
    expect(withExtension('Сцена 1.2', 'png')).toBe('Сцена 1.2.png');
    expect(withExtension('', 'pdf')).toBe('файл.pdf');
  });
});
