import { describe, expect, it } from 'vitest';
import type { VideoMarker } from '../model/types';
import { frameImageSize, framePrompt, shotWords } from './framePrompt';
import { markersAsTasks, markersForModel } from './reviewAi';

describe('generated storyboard frames', () => {
  const shot = { scene: '2', shot: '1', size: 'Крупный', angle: 'Снизу', movement: 'Наезд', lens: '85 мм', duration: 4 };

  it('picks the picture size closest to the frame', () => {
    expect(frameImageSize(16 / 9)).toBe('1536x1024');
    expect(frameImageSize(2.39)).toBe('1536x1024');
    expect(frameImageSize(1)).toBe('1024x1024');
    expect(frameImageSize(9 / 16)).toBe('1024x1536');
  });

  it('builds the prompt from the description, the shot and the style', () => {
    expect(shotWords({ shot })).toBe('close-up, low angle, 85 мм lens');
    expect(shotWords({ shot: undefined })).toBe('');
    const prompt = framePrompt('  Женщина идёт   по пирсу ', { shot, aspect: 16 / 9 }, 'sketch');
    expect(prompt.split('\n')).toEqual(['Женщина идёт по пирсу', 'Shot: close-up, low angle, 85 мм lens.', expect.stringContaining('storyboard sketch')]);
    expect(framePrompt('Пирс', { shot: undefined, aspect: 2.39 }, 'film')).toContain('2.39:1');
    // An unknown style falls back to the sketch.
    expect(framePrompt('Пирс', { shot: undefined, aspect: 1 }, 'nope' as never)).toContain('storyboard sketch');
  });
});

describe('review comments as tasks', () => {
  const markers: VideoMarker[] = [
    { id: 'a', time: 2, text: ' Пересветить   небо ', color: 'blue', done: true },
    { id: 'b', time: 65.5, text: 'Звук громче', color: 'red', done: false },
    { id: 'c', time: 70, text: '   ', color: 'blue', done: false },
  ];
  const tc = (s: number) => `00:0${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}:00`;

  it('makes one task per comment with its timecode, keeping what is done', () => {
    const tasks = markersAsTasks(markers, tc);
    expect(tasks.map((t) => [t.text, t.done, t.indent, t.due])).toEqual([
      ['00:00:02:00 — Пересветить небо', true, 0, null],
      ['00:01:05:00 — Звук громче', false, 0, null],
    ]);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(2);
  });

  it('writes the comments for the model, one per line', () => {
    expect(markersForModel(markers, tc)).toBe('00:00:02:00 (уже сделано) — Пересветить небо\n00:01:05:00 — Звук громче');
  });
});
