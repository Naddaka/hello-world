import type { MarkerColor, VideoMarker } from '../model/types';

/**
 * Timecodes and marker exports for editing software: DaVinci Resolve (EDL),
 * Premiere Pro (FCP 7 XML), Final Cut Pro (FCPXML), plus CSV and YouTube
 * chapters. Timecodes are non-drop-frame unless drop-frame is chosen for
 * 29.97 or 59.94 fps (HH:MM:SS;FF, as NTSC broadcast counts).
 */

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const DEFAULT_FPS = 25;

/** A measured rate snapped to the standard one it stands for (29.969… → 29.97). */
export function snapFps(raw: number): number {
  // 29.97 and 30 are only 0.1 % apart: take the nearest, and only when it is really close.
  const nearest = FRAME_RATES.reduce((best, r) => (Math.abs(r - raw) < Math.abs(best - raw) ? r : best));
  return Math.abs(nearest - raw) / nearest < 0.0005 ? nearest : Math.round(raw * 1000) / 1000;
}

/** Rates editing software works in; a variable-rate video is treated as the nearest one. */
const EDIT_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const nearestStandardFps = (raw: number) => EDIT_RATES.reduce((best, r) => (Math.abs(r - raw) < Math.abs(best - raw) ? r : best));

/**
 * The rate to work with for a detected one. Exact standard rates are kept; a
 * constant rate a little off the standard (a screen recording at 60.525) and a
 * variable rate near one are rounded to it ("rounded" says so); anything far
 * from every standard rate (a variable 8.4 fps clip) is kept as it is rather
 * than turned into something it is not.
 */
export function chooseFps(raw: number, variable: boolean): { fps: number; rounded: boolean } {
  const exact = snapFps(raw);
  if (!variable && FRAME_RATES.includes(exact)) return { fps: exact, rounded: false };
  const nearest = nearestStandardFps(raw);
  const off = Math.abs(nearest - raw) / nearest;
  if (off < (variable ? 0.1 : 0.02)) return { fps: nearest, rounded: nearest !== raw };
  return { fps: Math.round(raw * 1000) / 1000, rounded: false };
}

/** Drop-frame timecode exists only for the NTSC rates 29.97 and 59.94. */
export const canDropFrame = (fps: number) => Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;

/** Frames per second as counted in timecode (29.97 counts as 30). */
export const timecodeBase = (fps: number) => Math.round(fps);
const isNtsc = (fps: number) => Math.abs(fps - Math.round(fps)) > 0.001;

/** The frame on screen at a moment: the last one that started at or before it (a hair of tolerance for float error). */
export const frameOf = (seconds: number, fps: number) => Math.max(0, Math.floor(seconds * fps + 1e-6));

/** A moment in the middle of a frame: seeking there shows exactly that frame. */
export const frameMiddle = (frame: number, fps: number) => (Math.max(0, frame) + 0.5) / fps;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * Frame count → HH:MM:SS:FF. With drop-frame, frame numbers 0 and 1 (0–3 at
 * 59.94) are skipped at the start of every minute except each tenth, so the
 * timecode keeps up with the clock.
 */
export function framesToTimecode(frames: number, fps: number, dropFrame = false): string {
  const base = timecodeBase(fps);
  let n = frames;
  const df = dropFrame && canDropFrame(fps);
  if (df) {
    const drop = base === 60 ? 4 : 2;
    const per10 = Math.round(fps * 600);
    const perMinute = base * 60 - drop;
    const tens = Math.floor(n / per10);
    const rest = n % per10;
    n += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
  }
  const ff = n % base;
  const total = Math.floor(n / base);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}${df ? ';' : ':'}${pad(ff)}`;
}

export const timecode = (seconds: number, fps: number, dropFrame = false) => framesToTimecode(frameOf(seconds, fps), fps, dropFrame);

/** Frames in one hour of timecode (01:00:00:00 is where editors start timelines). */
const hourFrames = (fps: number, dropFrame: boolean) => (dropFrame && canDropFrame(fps) ? Math.round(fps * 3600) : 3600 * timecodeBase(fps));

/** Short clock for the UI and YouTube chapters: m:ss or h:mm:ss. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export const sortMarkers = (markers: VideoMarker[]) => [...markers].sort((a, b) => a.time - b.time);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RESOLVE_COLORS: Record<MarkerColor, string> = { blue: 'Blue', red: 'Red', green: 'Green', yellow: 'Yellow', purple: 'Purple' };

/**
 * EDL that DaVinci Resolve reads with "Timeline → Import → Timeline Markers
 * from EDL". Times are timeline times: the default timeline starts at 01:00:00:00.
 */
export function toResolveEdl(markers: VideoMarker[], fps: number, title: string, startHour = 1, dropFrame = false): string {
  const df = dropFrame && canDropFrame(fps);
  const offset = startHour * hourFrames(fps, df);
  const lines = [`TITLE: ${title}`, `FCM: ${df ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  sortMarkers(markers).forEach((m, i) => {
    const f = frameOf(m.time, fps) + offset;
    const a = framesToTimecode(f, fps, df);
    const b = framesToTimecode(f + 1, fps, df);
    lines.push(`${pad(i + 1, 3)}  001      V     C        ${a} ${b} ${a} ${b}  `);
    lines.push(` |C:ResolveColor${RESOLVE_COLORS[m.color]} |M:${m.text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/')} |D:1`);
    lines.push('');
  });
  return lines.join('\n');
}

/** FCP 7 XML: a sequence with the clip and its markers, which Premiere Pro imports. */
export function toPremiereXml(markers: VideoMarker[], fps: number, clip: { name: string; duration: number; path?: string; width?: number; height?: number }, dropFrame = false): string {
  const base = timecodeBase(fps);
  const ntsc = isNtsc(fps) ? 'TRUE' : 'FALSE';
  const rate = `<rate><timebase>${base}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const dur = Math.max(1, frameOf(clip.duration, fps));
  const url = clip.path ? `file://localhost${encodeURI(clip.path)}` : encodeURI(clip.name);
  const markerXml = sortMarkers(markers)
    .map((m) => `    <marker>\n      <name>${esc(m.text.split('\n')[0].slice(0, 60))}</name>\n      <comment>${esc(m.text)}</comment>\n      <in>${frameOf(m.time, fps)}</in>\n      <out>-1</out>\n    </marker>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${esc(clip.name)} — ревью</name>
    <duration>${dur}</duration>
    ${rate}
    <timecode>${rate}<string>${dropFrame && canDropFrame(fps) ? '00:00:00;00' : '00:00:00:00'}</string><frame>0</frame><displayformat>${dropFrame && canDropFrame(fps) ? 'DF' : 'NDF'}</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${clip.width ?? 1920}</width><height>${clip.height ?? 1080}</height></samplecharacteristics></format>
        <track>
          <clipitem id="clipitem-1">
            <name>${esc(clip.name)}</name>
            <duration>${dur}</duration>
            ${rate}
            <start>0</start><end>${dur}</end><in>0</in><out>${dur}</out>
            <file id="file-1">
              <name>${esc(clip.name)}</name>
              <pathurl>${esc(url)}</pathurl>
              ${rate}
              <duration>${dur}</duration>
              <media><video><samplecharacteristics>${rate}<width>${clip.width ?? 1920}</width><height>${clip.height ?? 1080}</height></samplecharacteristics></video><audio/></media>
            </file>
          </clipitem>
        </track>
      </video>
    </media>
${markerXml}
  </sequence>
</xmeml>
`;
}

/** Rational time for FCPXML: frame count × frame duration. */
function fcpTime(frames: number, fps: number): string {
  if (isNtsc(fps)) {
    const base = Math.round(fps);
    return `${frames * 1001}/${base * 1000}s`;
  }
  return `${frames}/${fps}s`;
}

/** FCPXML 1.10: a project with the clip and its markers (unfinished comments become to-do markers). */
export function toFcpxml(markers: VideoMarker[], fps: number, clip: { name: string; duration: number; path?: string; width?: number; height?: number }, dropFrame = false): string {
  const dur = Math.max(1, frameOf(clip.duration, fps));
  const frameDuration = fcpTime(1, fps);
  const src = clip.path ? `file://${encodeURI(clip.path)}` : encodeURI(clip.name);
  const markerXml = sortMarkers(markers)
    .map((m) => `              <marker start="${fcpTime(frameOf(m.time, fps), fps)}" duration="${frameDuration}" value="${esc(m.text.replace(/\n/g, ' '))}" completed="${m.done ? 1 : 0}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" frameDuration="${frameDuration}" width="${clip.width ?? 1920}" height="${clip.height ?? 1080}"/>
    <asset id="r2" name="${esc(clip.name)}" start="0s" duration="${fcpTime(dur, fps)}" hasVideo="1" hasAudio="1" format="r1">
      <media-rep kind="original-media" src="${esc(src)}"/>
    </asset>
  </resources>
  <library>
    <event name="Zadum">
      <project name="${esc(clip.name)} — ревью">
        <sequence format="r1" duration="${fcpTime(dur, fps)}" tcStart="0s" tcFormat="${dropFrame && canDropFrame(fps) ? 'DF' : 'NDF'}">
          <spine>
            <asset-clip ref="r2" name="${esc(clip.name)}" offset="0s" duration="${fcpTime(dur, fps)}" start="0s" format="r1">
${markerXml}
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

/** Spreadsheet-friendly list (";" separated, with a BOM for Cyrillic). */
export function toMarkersCsv(markers: VideoMarker[], fps: number, dropFrame = false): string {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = sortMarkers(markers).map((m) => [timecode(m.time, fps, dropFrame), m.time.toFixed(3), q(m.text), m.done ? 'да' : 'нет'].join(';'));
  return `﻿${['Таймкод;Секунды;Комментарий;Исправлено', ...rows].join('\r\n')}\r\n`;
}

/**
 * Chapters for a YouTube description: the list must start at 0:00, so a
 * first chapter is added when there is no marker at the very start.
 */
export function toYoutubeChapters(markers: VideoMarker[]): string {
  const list = sortMarkers(markers).filter((m) => m.text.trim());
  const lines = list.map((m) => `${clock(m.time)} ${m.text.split('\n')[0].trim()}`);
  if (!list.length || list[0].time >= 1) lines.unshift('0:00 Начало');
  return `${lines.join('\n')}\n`;
}

/**
 * Why YouTube would not turn the chapters into a chapter bar: it needs at
 * least three chapters, the first at 0:00, each at least ten seconds long.
 */
export function youtubeChapterProblems(markers: VideoMarker[], duration: number): string[] {
  const times = toYoutubeChapters(markers)
    .trim()
    .split('\n')
    .map((line) => line.split(' ')[0].split(':').reduce((acc, part) => acc * 60 + Number(part), 0));
  const problems: string[] = [];
  if (times.length < 3) problems.push(`нужно хотя бы 3 главы, а получилось ${times.length}`);
  const ends = [...times.slice(1), duration || Infinity];
  const short = times.filter((t, i) => ends[i] - t < 10).length;
  if (short) problems.push(`короче 10 секунд глав: ${short}`);
  return problems;
}
