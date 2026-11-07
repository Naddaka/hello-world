import { describe, expect, it } from 'vitest';
import { asUrl, embedFor } from './embeds';

describe('embeds', () => {
  it('recognises YouTube links in all common forms', () => {
    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) {
      expect(embedFor(url)?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
    expect(embedFor('https://youtu.be/dQw4w9WgXcQ?t=42')?.src).toContain('start=42');
  });

  it('recognises Vimeo, Spotify, SoundCloud and Google Maps', () => {
    expect(embedFor('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871');
    expect(embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toMatchObject({ provider: 'spotify', height: 152 });
    expect(embedFor('https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3')).toMatchObject({ provider: 'spotify', height: 352 });
    expect(embedFor('https://soundcloud.com/artist/track-name')?.provider).toBe('soundcloud');
    expect(embedFor('https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z')?.src).toContain('q=Eiffel%20Tower');
  });

  it('ignores ordinary pages', () => {
    expect(embedFor('https://example.com/watch?v=1')).toBeNull();
    expect(embedFor('not a url')).toBeNull();
  });

  it('turns typed addresses into URLs', () => {
    expect(asUrl('vimeo.com/123')).toBe('https://vimeo.com/123');
    expect(asUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(asUrl('просто текст')).toBeNull();
  });
});
