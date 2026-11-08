import type { MarkerColor, VideoMarker } from '../model/types';

/**
 * Timecodes and marker exports for editing software: DaVinci Resolve (EDL),
 * Premiere Pro (FCP 7 XML), Final Cut Pro (FCPXML), plus CSV and YouTube
 * chapters. Timecodes are non-drop-frame, as editors show them by default.
 */

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const DEFAULT_FPS = 25;

/** Frames per second as counted in timecode (29.97 counts as 30). */
export const timecodeBase = (fps: number) => Math.round(fps);
const isNtsc = (fps: number) => Math.abs(fps - Math.round(fps)) > 0.001;

/** The frame on screen at a moment: the last one that started at or before it (a hair of tolerance for float error). */
export const frameOf = (seconds: number, fps: number) => Math.max(0, Math.floor(seconds * fps + 1e-6));

/** A moment in the middle of a frame: seeking there shows exactly that frame. */
export const frameMiddle = (frame: number, fps: number) => (Math.max(0, frame) + 0.5) / fps;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Frame count → HH:MM:SS:FF. */
export function framesToTimecode(frames: number, fps: number): string {
  const base = timecodeBase(fps);
  const ff = frames % base;
  const total = Math.floor(frames / base);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(ff)}`;
}

export const timecode = (seconds: number, fps: number) => framesToTimecode(frameOf(seconds, fps), fps);

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
export function toResolveEdl(markers: VideoMarker[], fps: number, title: string, startHour = 1): string {
  const offset = startHour * 3600 * timecodeBase(fps);
  const lines = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
  sortMarkers(markers).forEach((m, i) => {
    const f = frameOf(m.time, fps) + offset;
    const a = framesToTimecode(f, fps);
    const b = framesToTimecode(f + 1, fps);
    lines.push(`${pad(i + 1, 3)}  001      V     C        ${a} ${b} ${a} ${b}  `);
    lines.push(` |C:ResolveColor${RESOLVE_COLORS[m.color]} |M:${m.text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/')} |D:1`);
    lines.push('');
  });
  return lines.join('\n');
}

/** FCP 7 XML: a sequence with the clip and its markers, which Premiere Pro imports. */
export function toPremiereXml(markers: VideoMarker[], fps: number, clip: { name: string; duration: number; path?: string; width?: number; height?: number }): string {
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
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
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
export function toFcpxml(markers: VideoMarker[], fps: number, clip: { name: string; duration: number; path?: string; width?: number; height?: number }): string {
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
        <sequence format="r1" duration="${fcpTime(dur, fps)}" tcStart="0s" tcFormat="NDF">
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
export function toMarkersCsv(markers: VideoMarker[], fps: number): string {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = sortMarkers(markers).map((m) => [timecode(m.time, fps), m.time.toFixed(3), q(m.text), m.done ? 'да' : 'нет'].join(';'));
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
