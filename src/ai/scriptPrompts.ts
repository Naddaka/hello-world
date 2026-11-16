import { CATEGORIES, findItem } from '../script/breakdown';
import { FORMATS, scriptLanguage, scriptStats, type Language, type SceneInfo } from '../script/layout';
import { SHOT_ANGLES, SHOT_MOVES, SHOT_SIZES } from '../script/storyboard';
import type { BreakdownCategory, BreakdownItem, ScriptBlock, ScriptBlockType, ScriptElement } from '../model/types';
import type { AiRequest } from './run';

/**
 * What the script features ask Claude, and how its answers are checked before
 * anything reaches the script. The script is always sent in the same form, so
 * several actions on one script share the cached text.
 */

type Script = Pick<ScriptElement, 'title' | 'blocks' | 'format'>;

/** The script as plain text with numbered scenes: "### Сцена 3. ИНТ. КУХНЯ — НОЧЬ". */
export function scriptForModel(script: Script): string {
  const stats = scriptStats(script.blocks, FORMATS[script.format]);
  const sceneAt = new Map(stats.scenes.map((s) => [s.block, s.number]));
  const lines: string[] = [`Сценарий: ${script.title || 'без названия'}`, ''];
  script.blocks.forEach((b, i) => {
    const text = b.text.trim();
    if (!text) return;
    if (b.type === 'scene') lines.push('', `### Сцена ${sceneAt.get(i) ?? '?'}. ${text}`, '');
    else if (b.type === 'character') lines.push('', `    ${text.toLocaleUpperCase('ru-RU')}`);
    else if (b.type === 'parenthetical') lines.push(`    (${text})`);
    else if (b.type === 'dialogue') lines.push(`    ${text}`);
    else if (b.type === 'transition') lines.push('', `${text.toLocaleUpperCase('ru-RU')}`, '');
    else lines.push(text);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The text of one scene, from its heading to the next one. */
export function sceneText(script: Script, scene: SceneInfo): string {
  const stats = scriptStats(script.blocks, FORMATS[script.format]);
  const next = stats.scenes.find((s) => s.block > scene.block)?.block ?? script.blocks.length;
  return script.blocks
    .slice(scene.block, next)
    .map((b) => b.text)
    .join('\n');
}

const answerLanguage = (script: Script): string => (scriptLanguage(script.blocks, FORMATS[script.format]) === 'en' ? 'английском' : 'русском');

// ---------- 1. breakdown ----------

const CATEGORY_HINTS: Record<BreakdownCategory, string> = {
  extras: 'массовка и групповка: прохожие, посетители, толпа (не персонажи с репликами)',
  props: 'реквизит: предметы, которые актёры берут в руки или которые играют в кадре',
  wardrobe: 'костюм: упомянутая одежда, обувь, аксессуары',
  makeup: 'грим и причёски: раны, кровь, шрамы, старение, особый грим',
  set: 'декорация и обстановка: мебель и элементы интерьера, которые нужно подготовить',
  vehicles: 'транспорт: машины, лодки, велосипеды в кадре',
  animals: 'животные',
  stunts: 'трюки: падения, драки, погони, опасные действия',
  sfx: 'спецэффекты на площадке: дождь, дым, огонь, выстрелы, взрывы',
  vfx: 'компьютерная графика: то, что явно дорисовывается',
  sound: 'звук и музыка: музыка в кадре, значимые звуки, фонограмма',
  equipment: 'спецтехника съёмки: кран, дрон, подводный бокс — только если это прямо следует из текста',
  notes: 'заметки для производства: ночная смена, дети на площадке, съёмка на воде',
};

export const BREAKDOWN_SYSTEM = [
  'Ты второй режиссёр, который делает разбор сценария для подготовки съёмок.',
  'Найди в сценарии всё, что нужно подготовить, и отнеси к категориям:',
  ...CATEGORIES.map((c) => `- ${c.id} — ${c.label}: ${CATEGORY_HINTS[c.id]}`),
  '',
  'Правила:',
  '- Название элемента — слово или короткое словосочетание, которое буквально встречается в тексте сценария, в начальной форме (именительный падеж, единственное число, если в тексте не множественное): «револьвер», «старый грузовик». Приложение находит элемент по упоминаниям в тексте, поэтому не придумывай названий, которых в тексте нет.',
  '- Не включай персонажей с репликами и места действия из заголовков сцен: они берутся из сценария сами.',
  '- Один предмет — один элемент, даже если он встречается в нескольких сценах. В scenes перечисли номера сцен, где он нужен.',
  '- Не дроби на очевидные мелочи обстановки (стена, пол, дверь), если они не играют.',
  '- Пиши названия на языке сценария.',
].join('\n');

export interface ProposedItem {
  category: BreakdownCategory;
  name: string;
  scenes: number[];
}

export const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES.map((c) => c.id) },
          name: { type: 'string', description: 'Как в тексте, в начальной форме' },
          scenes: { type: 'array', items: { type: 'integer' }, description: 'Номера сцен' },
        },
        required: ['category', 'name', 'scenes'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export function breakdownRequest(script: Script): AiRequest {
  return { system: BREAKDOWN_SYSTEM, context: scriptForModel(script), prompt: 'Сделай разбор этого сценария целиком: перечисли все элементы по категориям.', schema: BREAKDOWN_SCHEMA };
}

export interface CheckedItem extends ProposedItem {
  /** Scenes where the app itself finds the name in the text. */
  found: number;
  /** Already in the script's breakdown. */
  known: boolean;
}

/** The model's items made safe: known categories only, tidy names, no duplicates, with how many scenes mention each. */
export function checkItems(proposed: ProposedItem[] | undefined, script: Pick<ScriptElement, 'blocks' | 'format'>, existing: BreakdownItem[]): CheckedItem[] {
  const stats = scriptStats(script.blocks, FORMATS[script.format]);
  const texts = stats.scenes.map((scene, i) => {
    const end = stats.scenes[i + 1]?.block ?? script.blocks.length;
    return script.blocks
      .slice(scene.block, end)
      .map((b) => b.text)
      .join('\n');
  });
  const key = (category: string, name: string) => `${category}|${name.toLocaleLowerCase('ru-RU')}`;
  const have = new Set(existing.map((i) => key(i.category, i.name)));
  const seen = new Set<string>();
  const out: CheckedItem[] = [];
  for (const item of proposed ?? []) {
    const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (!name || name.length > 60 || !CATEGORIES.some((c) => c.id === item.category)) continue;
    const k = key(item.category, name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ category: item.category, name, scenes: (item.scenes ?? []).filter((n) => Number.isInteger(n)), found: texts.filter((t) => findItem(t, name).length).length, known: have.has(k) });
  }
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return out.sort((a, b) => order.get(a.category)! - order.get(b.category)! || b.found - a.found || a.name.localeCompare(b.name, 'ru'));
}

// ---------- 2. shots of a scene ----------

export const SHOTS_SYSTEM = [
  'Ты режиссёр-постановщик и оператор. По сцене сценария ты составляешь план съёмки: последовательность кадров, из которой сцена монтируется.',
  'Правила:',
  '- Кадры идут в порядке монтажа и покрывают всё действие и все реплики сцены.',
  '- Обычно это 3–10 кадров на сцену; не дроби без нужды.',
  '- description — что в кадре и что происходит, одно-два коротких предложения на языке сценария.',
  '- lens — фокусное расстояние вроде «35 мм», если это важно, иначе пустая строка.',
  '- duration — примерная длительность кадра в секундах.',
  '- Крупность, ракурс и движение выбирай только из предложенных значений.',
].join('\n');

export interface ProposedShot {
  size: string;
  angle: string;
  movement: string;
  lens: string;
  duration: number;
  description: string;
}

export const SHOTS_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          size: { type: 'string', enum: SHOT_SIZES.map((s) => s.label) },
          angle: { type: 'string', enum: SHOT_ANGLES },
          movement: { type: 'string', enum: SHOT_MOVES },
          lens: { type: 'string' },
          duration: { type: 'integer', description: 'Секунды' },
          description: { type: 'string' },
        },
        required: ['size', 'angle', 'movement', 'lens', 'duration', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['shots'],
  additionalProperties: false,
} as const;

export function shotsRequest(script: Script, scene: SceneInfo): AiRequest {
  return { system: SHOTS_SYSTEM, context: scriptForModel(script), prompt: `Составь план съёмки для сцены ${scene.number} («${scene.heading}»). Остальные сцены — только для понимания истории.`, schema: SHOTS_SCHEMA };
}

/** The model's shots made safe: values from the app's lists, sane durations, short texts. */
export function checkShots(proposed: ProposedShot[] | undefined): ProposedShot[] {
  const pick = (value: unknown, list: string[]) => (typeof value === 'string' && list.includes(value) ? value : '');
  return (proposed ?? [])
    .map((s) => ({
      size: pick(s?.size, SHOT_SIZES.map((x) => x.label)),
      angle: pick(s?.angle, SHOT_ANGLES),
      movement: pick(s?.movement, SHOT_MOVES),
      lens: String(s?.lens ?? '').trim().slice(0, 24),
      duration: Number.isFinite(s?.duration) ? Math.max(1, Math.min(600, Math.round(s.duration))) : 0,
      description: String(s?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }))
    .filter((s) => s.description || s.size)
    .slice(0, 40);
}

// ---------- 3. editor's notes and rewrites ----------

export function notesRequest(script: Script, scene: SceneInfo | null): AiRequest {
  const lang = answerLanguage(script);
  return {
    system: [
      'Ты опытный редактор сценариев. Ты читаешь текст и даёшь автору конкретные, применимые замечания — без общих слов и без пересказа.',
      `Отвечай на ${lang} языке, в Markdown: короткие разделы с заголовками «##», списки, цитаты из текста в кавычках с номером сцены.`,
      'Разделы: «Что работает» (кратко), «Структура и темп», «Персонажи и мотивация», «Диалоги», «Что сделать в первую очередь» (3–5 пунктов по важности).',
      'Не переписывай сценарий целиком. Если предлагаешь правку реплики, дай один вариант.',
    ].join('\n'),
    context: scriptForModel(script),
    prompt: scene ? `Дай замечания по сцене ${scene.number} («${scene.heading}») в контексте всего сценария. Разделы, к которым нечего сказать, пропусти.` : 'Дай замечания по сценарию целиком.',
    effort: 'high',
  };
}

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, note: { type: 'string', description: 'Чем этот вариант отличается, несколько слов' } },
        required: ['text', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['variants'],
  additionalProperties: false,
} as const;

export interface Variant {
  text: string;
  note: string;
}

export function rewriteRequest(script: Script, fragment: string, kind: ScriptBlockType, scene: SceneInfo | null): AiRequest {
  const what: Record<ScriptBlockType, string> = { scene: 'заголовок сцены', action: 'описание действия', character: 'имя персонажа', parenthetical: 'ремарка', dialogue: 'реплика', transition: 'переход', shot: 'указание кадра', centered: 'текст по центру' };
  return {
    system: [
      'Ты редактор сценариев. Тебе дают фрагмент сценария, и ты предлагаешь три варианта этого фрагмента: точнее, живее, короче — в голосе автора и персонажа.',
      'Каждый вариант — готовая замена того же фрагмента: тот же язык, тот же смысл в сюжете, без кавычек и пояснений внутри text.',
      'Не добавляй оформление сценария (имя персонажа, ремарки в скобках), если их нет во фрагменте.',
    ].join('\n'),
    context: scriptForModel(script),
    prompt: `Фрагмент (${what[kind]}${scene ? `, сцена ${scene.number}` : ''}):\n«${fragment}»\n\nПредложи три варианта.`,
    schema: REWRITE_SCHEMA,
  };
}

// ---------- 4. translation ----------

export const TRANSLATE_CHUNK = 220;

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer', description: 'Номер строки из задания' }, text: { type: 'string' } },
        required: ['i', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

const KIND_NAME: Record<ScriptBlockType, string> = { scene: 'scene', action: 'action', character: 'character', parenthetical: 'parenthetical', dialogue: 'dialogue', transition: 'transition', shot: 'shot', centered: 'centered' };

export function translateSystem(to: Language): string {
  const target = to === 'en' ? 'английский' : 'русский';
  return [
    `Ты переводчик сценариев. Переведи строки сценария на ${target} язык так, как пишут сценарии на этом языке.`,
    'Каждая строка задания: «номер|тип|текст». Верни перевод каждой строки с тем же номером; не объединяй и не пропускай строки.',
    to === 'en'
      ? '- scene: заголовок сцены по голливудскому стандарту: ИНТ. → INT., НАТ. → EXT., ИНТ./НАТ. → INT./EXT., время суток: ДЕНЬ → DAY, НОЧЬ → NIGHT, УТРО → MORNING, ВЕЧЕР → EVENING; всё прописными.'
      : '- scene: заголовок сцены по русскому стандарту: INT. → ИНТ., EXT. → НАТ., INT./EXT. → ИНТ./НАТ., DAY → ДЕНЬ, NIGHT → НОЧЬ, MORNING → УТРО, EVENING → ВЕЧЕР; всё прописными.',
    to === 'en' ? '- character: имя прописными; транслитерируй имена одинаково во всём тексте; (ЗК) → (V.O.), (ВПЗ) → (O.S.), (ПРОД.) → (CONT’D).' : '- character: имя прописными; передавай имена одинаково во всём тексте; (V.O.) → (ЗК), (O.S.) → (ВПЗ), (CONT’D) → (ПРОД.).',
    to === 'en' ? '- transition: СМЕНА КАДРА / ПЕРЕХОД → CUT TO:, ЗАТЕМНЕНИЕ → FADE OUT., ИЗ ЗАТЕМНЕНИЯ → FADE IN:' : '- transition: CUT TO: → СМЕНА КАДРА:, FADE OUT. → ЗАТЕМНЕНИЕ., FADE IN: → ИЗ ЗАТЕМНЕНИЯ:',
    '- dialogue: живая речь, а не подстрочник; сохраняй характер и регистр персонажа.',
    '- parenthetical: без скобок, как в задании.',
    '- action: настоящее время, коротко.',
  ].join('\n');
}

export function translateLines(blocks: ScriptBlock[], from: number, to: number): string {
  return blocks
    .slice(from, to)
    .map((b, k) => `${from + k}|${KIND_NAME[b.type]}|${b.text.replace(/\n/g, ' ')}`)
    .join('\n');
}

/** Puts translated lines over a copy of the blocks; lines the model skipped keep the original text. Returns how many were translated. */
export function applyTranslation(blocks: ScriptBlock[], lines: { i: number; text: string }[], newId: () => string): { blocks: ScriptBlock[]; translated: number } {
  const byIndex = new Map<number, string>();
  for (const line of lines ?? []) if (Number.isInteger(line?.i) && typeof line.text === 'string' && line.i >= 0 && line.i < blocks.length) byIndex.set(line.i, line.text.trim());
  let translated = 0;
  const out = blocks.map((b, i) => {
    const text = byIndex.get(i);
    const filled = text !== undefined && (text !== '' || b.text.trim() === '');
    if (filled && b.text.trim()) translated++;
    return { ...b, id: newId(), text: filled ? (b.type === 'parenthetical' ? text!.replace(/^\(|\)$/g, '') : text!) : b.text };
  });
  return { blocks: out, translated };
}
