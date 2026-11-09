import { describe, expect, it } from 'vitest';
import type { VideoMarker } from '../model/types';
import { canDropFrame, chooseFps, nearestStandardFps, clock, frameMiddle, framesToTimecode, snapFps, youtubeChapterProblems, timecode, toFcpxml, toMarkersCsv, toPremiereXml, toResolveEdl, toYoutubeChapters } from './markers';

const m = (time: number, text: string, extra: Partial<VideoMarker> = {}): VideoMarker => ({ id: `m${time}`, time, text, color: 'blue', done: false, ...extra });
const markers = [m(65.48, 'Пересветить небо', { color: 'red' }), m(2, 'Начать раньше'), m(3600 + 0.04, 'Титры', { done: true })];

describe('timecodes', () => {
  it('formats non-drop-frame timecode', () => {
    expect(framesToTimecode(0, 25)).toBe('00:00:00:00');
    expect(timecode(65.48, 25)).toBe('00:01:05:12');
    expect(timecode(3600.04, 25)).toBe('01:00:00:01');
    // 29.97 counts 30 frames per timecode second.
    expect(framesToTimecode(30, 29.97)).toBe('00:00:01:00');
    // The frame on screen is the last one that has started.
    expect(timecode(1, 23.976)).toBe('00:00:00:23');
    expect(timecode(0.999, 25)).toBe('00:00:00:24');
    // Non-drop timecode runs slow against the clock at 23.976.
    expect(timecode(100, 23.976)).toBe('00:01:39:21');
    expect(timecode(frameMiddle(51, 25), 25)).toBe('00:00:02:01');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
  });
});

describe('marker exports', () => {
  it('writes a DaVinci Resolve marker EDL on a timeline starting at 01:00:00:00', () => {
    const edl = toResolveEdl(markers, 25, 'Клип');
    const lines = edl.split('\n');
    expect(lines.slice(0, 2)).toEqual(['TITLE: Клип', 'FCM: NON-DROP FRAME']);
    expect(lines[3]).toBe('001  001      V     C        01:00:02:00 01:00:02:01 01:00:02:00 01:00:02:01  ');
    expect(lines[4]).toBe(' |C:ResolveColorBlue |M:Начать раньше |D:1');
    expect(edl).toContain(' |C:ResolveColorRed |M:Пересветить небо |D:1');
    expect(edl).toContain('003  001      V     C        02:00:00:01');
  });

  it('writes Premiere XML with sequence markers at frame positions', () => {
    const xml = toPremiereXml(markers, 25, { name: 'clip.mov', duration: 4000, path: '/Users/r/Media/clip.mov' });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect([...doc.querySelectorAll('sequence > marker > in')].map((n) => n.textContent)).toEqual(['50', '1637', '90001']);
    expect(doc.querySelector('pathurl')!.textContent).toBe('file://localhost/Users/r/Media/clip.mov');
    expect(doc.querySelector('sequence > rate > timebase')!.textContent).toBe('25');
  });

  it('writes FCPXML with rational times and to-do markers', () => {
    const xml = toFcpxml(markers, 25, { name: 'clip.mov', duration: 4000 });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const ms = [...doc.querySelectorAll('marker')];
    expect(ms.map((x) => x.getAttribute('start'))).toEqual(['50/25s', '1637/25s', '90001/25s']);
    expect(ms.map((x) => x.getAttribute('completed'))).toEqual(['0', '0', '1']);
    expect(doc.querySelector('format')!.getAttribute('frameDuration')).toBe('1/25s');
    expect(toFcpxml([m(1, 'x')], 29.97, { name: 'a', duration: 2 })).toContain('frameDuration="1001/30000s"');
  });

  it('writes the start of the frame in CSV seconds', () => {
    expect(toMarkersCsv([m(frameMiddle(51, 25), 'x')], 25)).toContain('00:00:02:01;2.040;x');
  });

  it('writes CSV and YouTube chapters', () => {
    expect(toMarkersCsv([m(2, 'Сцена; дубль 2')], 25)).toBe('﻿Таймкод;Секунды;Комментарий;Исправлено\r\n00:00:02:00;2.000;"Сцена; дубль 2";нет\r\n');
    expect(toYoutubeChapters(markers)).toBe('0:00 Начало\n0:02 Начать раньше\n1:05 Пересветить небо\n1:00:00 Титры\n');
    expect(toYoutubeChapters([m(0, 'Вступление'), m(30, 'Обзор')])).toBe('0:00 Вступление\n0:30 Обзор\n');
  });
});

describe('frame rates and drop-frame timecode', () => {
  it('snaps measured rates to the standard ones', () => {
    expect(snapFps(29.97002997)).toBe(29.97);
    expect(snapFps(30.0004)).toBe(30);
    expect(snapFps(23.976023)).toBe(23.976);
    expect(snapFps(12.5)).toBe(12.5);
    // Variable-rate files: the nearest rate editing software uses.
    expect(nearestStandardFps(30.246)).toBe(30);
    expect(nearestStandardFps(60.525)).toBe(60);
    expect(nearestStandardFps(29.563)).toBe(29.97);
    // What the review uses for a detected rate.
    expect(chooseFps(30, false)).toEqual({ fps: 30, rounded: false });
    expect(chooseFps(29.97002997, false)).toEqual({ fps: 29.97, rounded: false });
    expect(chooseFps(90000 / 1487, false)).toEqual({ fps: 60, rounded: true }); // screen recording, 60.525
    expect(chooseFps(239 / 12, false)).toEqual({ fps: 19.917, rounded: false }); // far from any standard rate
    expect(chooseFps(30.34, true)).toEqual({ fps: 30, rounded: true });
    expect(chooseFps(8.4, true)).toEqual({ fps: 8.4, rounded: false }); // not turned into 23.976
    expect(canDropFrame(29.97)).toBe(true);
    expect(canDropFrame(30)).toBe(false);
  });

  it('skips frame numbers at each minute except every tenth', () => {
    expect(framesToTimecode(1799, 29.97, true)).toBe('00:00:59;29');
    expect(framesToTimecode(1800, 29.97, true)).toBe('00:01:00;02');
    expect(framesToTimecode(17982, 29.97, true)).toBe('00:10:00;00');
    expect(framesToTimecode(107892, 29.97, true)).toBe('01:00:00;00');
    expect(framesToTimecode(3600, 59.94, true)).toBe('00:01:00;04');
    // Without drop-frame, or at a rate that has none, nothing changes.
    expect(framesToTimecode(1800, 29.97)).toBe('00:01:00:00');
    expect(framesToTimecode(1800, 30, true)).toBe('00:01:00:00');
  });

  it('marks drop-frame in the exports', () => {
    // Drop-frame timecode matches the clock at every ten minutes.
    const edl = toResolveEdl([m(600, 'x')], 29.97, 'T', 1, true);
    expect(edl).toContain('FCM: DROP FRAME');
    expect(edl).toContain('01:10:00;00');
    expect(toFcpxml([m(1, 'x')], 29.97, { name: 'a', duration: 2 }, true)).toContain('tcFormat="DF"');
    expect(toPremiereXml([m(1, 'x')], 29.97, { name: 'a', duration: 2 }, true)).toContain('<displayformat>DF</displayformat>');
  });
});

describe('YouTube chapter rules', () => {
  it('explains why YouTube would ignore the chapters', () => {
    expect(youtubeChapterProblems([m(2, 'a'), m(5, 'b')], 60)).toEqual(['короче 10 секунд глав: 2']);
    expect(youtubeChapterProblems([m(30, 'a')], 60)).toEqual(['нужно хотя бы 3 главы, а получилось 2']);
    expect(youtubeChapterProblems([m(0, 'a'), m(20, 'b'), m(40, 'c')], 60)).toEqual([]);
  });
});
