import type { BreakdownCategory, BreakdownItem, ScriptElement } from '../model/types';
import { FORMATS, eighthsLabel, parseHeading, scriptStats } from './layout';

/**
 * Script breakdown: the things each scene needs. Cast and locations are read
 * from the script; everything else is tagged by the writer or the assistant
 * director and found again wherever it is mentioned.
 */

export const CATEGORIES: { id: BreakdownCategory; label: string; color: string }[] = [
  { id: 'extras', label: 'Массовка', color: '#16a34a' },
  { id: 'props', label: 'Реквизит', color: '#7c3aed' },
  { id: 'wardrobe', label: 'Костюм', color: '#db2777' },
  { id: 'makeup', label: 'Грим', color: '#ea580c' },
  { id: 'set', label: 'Декорация', color: '#0891b2' },
  { id: 'vehicles', label: 'Транспорт', color: '#ca8a04' },
  { id: 'animals', label: 'Животные', color: '#65a30d' },
  { id: 'stunts', label: 'Трюки', color: '#dc2626' },
  { id: 'sfx', label: 'Спецэффекты', color: '#2563eb' },
  { id: 'vfx', label: 'Графика (VFX)', color: '#4f46e5' },
  { id: 'sound', label: 'Звук и музыка', color: '#0d9488' },
  { id: 'equipment', label: 'Спецтехника', color: '#57534e' },
  { id: 'notes', label: 'Заметки', color: '#6b7280' },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<BreakdownCategory, string>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A pattern that finds a name in any grammatical form: each word is matched by
 * its stem (all but the last two letters of longer words), so «револьвер»
 * finds «револьвером» and «старый грузовик» finds «старого грузовика».
 */
export function itemPattern(name: string): RegExp | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // An ending is a few letters at most, so «кот» finds «кота», but not «котлета»;
  // a short word ending in a vowel changes it («Маша» → «Машу», «Машей», not «Машина»).
  const parts = words.map((w) => {
    const letters = [...w];
    const long = letters.length >= 5 && /\p{L}$/u.test(w);
    const vowel = letters.length === 4 && /[аяоеёьйыиуюэ]$/iu.test(w);
    const stem = long ? letters.slice(0, -2) : vowel ? letters.slice(0, -1) : letters;
    return `${escapeRe(stem.join(''))}\\p{L}{0,${long ? 4 : vowel ? 2 : 3}}`;
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s\\-]+')}(?![\\p{L}])`, 'giu');
}

/** Where an item is mentioned in a text: [from, to) ranges. */
export function findItem(text: string, name: string): [number, number][] {
  const re = itemPattern(name);
  if (!re) return [];
  return [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length]);
}

export interface SceneBreakdown {
  number: number;
  heading: string;
  /** ИНТ., НАТ., INT. … */
  setting: string;
  location: string;
  time: string;
  page: number;
  eighths: number;
  /** Characters who speak in the scene, then those only mentioned in its action. */
  cast: string[];
  items: Partial<Record<BreakdownCategory, string[]>>;
}

/** Breakdown sheet data for every scene. */
export function breakdownScenes(script: Pick<ScriptElement, 'blocks' | 'format' | 'breakdown'>): SceneBreakdown[] {
  const stats = scriptStats(script.blocks, FORMATS[script.format]);
  const items = script.breakdown ?? [];
  // Everyone who speaks somewhere in the script; they count in a scene where they only appear in the action, too.
  const speakers = stats.characters.map((c) => c.name);
  return stats.scenes.map((scene, i) => {
    const end = stats.scenes[i + 1]?.block ?? script.blocks.length;
    const text = script.blocks
      .slice(scene.block, end)
      .map((b) => b.text)
      .join('\n');
    const action = script.blocks
      .slice(scene.block, end)
      .filter((b) => b.type === 'action' || b.type === 'scene')
      .map((b) => b.text)
      .join('\n');
    const found: Partial<Record<BreakdownCategory, string[]>> = {};
    for (const item of items) {
      if (findItem(text, item.name).length) (found[item.category] ??= []).push(item.name);
    }
    const h = parseHeading(script.blocks[scene.block].text);
    return {
      number: scene.number,
      heading: scene.heading,
      setting: h.prefix.toLocaleUpperCase('ru-RU'),
      location: h.location.toLocaleUpperCase('ru-RU'),
      time: h.time.toLocaleUpperCase('ru-RU'),
      page: scene.page,
      eighths: scene.eighths,
      cast: [...scene.characters, ...speakers.filter((name) => !scene.characters.includes(name) && findItem(action, name).length)],
      items: found,
    };
  });
}

/** The breakdown as rows of a table: one row per scene, a column per category in use. */
export function breakdownTable(script: Pick<ScriptElement, 'blocks' | 'format' | 'breakdown'>): string[][] {
  const scenes = breakdownScenes(script);
  const used = CATEGORIES.filter((c) => scenes.some((s) => s.items[c.id]?.length));
  const header = ['№', 'Режим', 'Объект', 'Время', 'Стр.', 'Объём', 'Персонажи', ...used.map((c) => c.label)];
  const rows = scenes.map((s) => [String(s.number), s.setting, s.location, s.time, String(s.page), eighthsLabel(s.eighths), s.cast.join(', '), ...used.map((c) => (s.items[c.id] ?? []).join(', '))]);
  return [header, ...rows];
}

/** How many scenes mention each item. */
export function itemSceneCounts(script: Pick<ScriptElement, 'blocks' | 'format' | 'breakdown'>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const scene of breakdownScenes(script)) {
    for (const names of Object.values(scene.items)) for (const n of names ?? []) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

export function addItem(list: BreakdownItem[] | undefined, item: BreakdownItem): BreakdownItem[] {
  const existing = list ?? [];
  const key = item.name.trim().toLocaleLowerCase('ru-RU');
  if (!key || existing.some((i) => i.name.toLocaleLowerCase('ru-RU') === key && i.category === item.category)) return existing;
  return [...existing, { ...item, name: item.name.trim() }];
}

/** Renames an item (e.g. from the word form that was selected to the base form). */
export function renameItem(list: BreakdownItem[], id: string, name: string): BreakdownItem[] {
  const clean = name.trim();
  if (!clean) return list;
  return list.map((i) => (i.id === id ? { ...i, name: clean } : i));
}
