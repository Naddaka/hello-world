import type { AiRequest } from './run';

/** What the board features ask Claude, and how its answers are checked before anything changes on a board. */

// ---------- summary ----------

export function summaryRequest(material: string, whole: boolean): AiRequest {
  return {
    system: [
      'Ты помогаешь человеку разобраться в его рабочих досках: заметки, задачи, ссылки, таблицы, идеи для видео.',
      'Сделай по материалу краткую, полезную сводку на языке материала, в Markdown:',
      '- сначала 2–3 предложения о главном;',
      '- затем разделы с заголовками «##» по темам, которые в материале действительно есть (например: идеи, решения, открытые вопросы, задачи и сроки);',
      '- пиши конкретно, с именами, числами и формулировками из карточек; не добавляй того, чего в материале нет;',
      '- в конце, если есть, раздел «Что сделать дальше» списком.',
    ].join('\n'),
    context: material,
    prompt: whole ? 'Сделай сводку этой доски.' : 'Сделай сводку этих карточек.',
  };
}

// ---------- arrange notes into columns ----------

export const ARRANGE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Короткое название колонки' }, ids: { type: 'array', items: { type: 'string' }, description: 'id заметок этой колонки' } },
        required: ['title', 'ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const;

export function arrangeRequest(material: string, count: number): AiRequest {
  return {
    system: [
      'Ты помогаешь навести порядок на доске: раскладываешь заметки по колонкам по смыслу.',
      'Правила:',
      `- Сделай от 2 до ${Math.max(2, Math.min(7, Math.ceil(count / 2)))} колонок с короткими названиями (1–3 слова) на языке заметок.`,
      '- Каждая заметка попадает ровно в одну колонку; используй id в точности как в материале (то, что в квадратных скобках).',
      '- Группируй по теме или назначению, а не по формальным признакам. Заметки, которые никуда не подходят, собери в одну колонку «Разное».',
      '- Внутри колонки ставь заметки в осмысленном порядке: от общего к частному или по ходу работы.',
    ].join('\n'),
    context: material,
    prompt: 'Разложи эти заметки по колонкам.',
    schema: ARRANGE_SCHEMA,
  };
}

export interface Group {
  title: string;
  ids: string[];
}

/** Groups made safe: known ids only, each note once, no empty columns. */
export function checkGroups(groups: Group[] | undefined, candidates: Set<string>): Group[] {
  const used = new Set<string>();
  const out: Group[] = [];
  for (const g of groups ?? []) {
    const ids = (Array.isArray(g?.ids) ? g.ids : []).filter((id) => typeof id === 'string' && candidates.has(id) && !used.has(id) && (used.add(id), true));
    const title = String(g?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (ids.length) out.push({ title: title || 'Без названия', ids });
  }
  return out.slice(0, 12);
}

// ---------- labels ----------

export const LABELS_SCHEMA = {
  type: 'object',
  properties: {
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Название метки, 1–2 слова' }, ids: { type: 'array', items: { type: 'string' }, description: 'id карточек с этой меткой' } },
        required: ['name', 'ids'],
        additionalProperties: false,
      },
    },
  },
  required: ['labels'],
  additionalProperties: false,
} as const;

export function labelsRequest(material: string, existing: string[]): AiRequest {
  return {
    system: [
      'Ты помогаешь размечать карточки на доске метками, чтобы их было легко находить и фильтровать.',
      'Правила:',
      '- Предложи от 2 до 6 меток: короткие (1–2 слова), на языке карточек, с заглавной буквы.',
      '- Метка должна подходить хотя бы двум карточкам и что-то значить для работы: тема, статус, тип материала. Не делай метку на каждую карточку.',
      '- У карточки может быть несколько меток или ни одной.',
      '- Используй id карточек в точности как в материале (то, что в квадратных скобках).',
      existing.length ? `- Уже есть метки: ${existing.join(', ')}. Где подходит по смыслу, используй их (с тем же написанием), а не похожие новые.` : '- Меток пока нет.',
    ].join('\n'),
    context: material,
    prompt: 'Предложи метки для этих карточек.',
    schema: LABELS_SCHEMA,
  };
}

export interface LabelProposal {
  name: string;
  ids: string[];
}

/** Labels made safe: known cards only, tidy unique names, nothing empty. Cards that already carry the label are dropped. */
export function checkLabels(labels: LabelProposal[] | undefined, candidates: Set<string>, has: (id: string, name: string) => boolean): LabelProposal[] {
  const seen = new Map<string, LabelProposal>();
  for (const l of labels ?? []) {
    const name = String(l?.name ?? '').replace(/\s+/g, ' ').trim().replace(/^#/, '').slice(0, 30);
    if (!name) continue;
    const key = name.toLocaleLowerCase('ru-RU');
    const entry = seen.get(key) ?? { name, ids: [] };
    for (const id of Array.isArray(l?.ids) ? l.ids : []) if (typeof id === 'string' && candidates.has(id) && !entry.ids.includes(id) && !has(id, name)) entry.ids.push(id);
    seen.set(key, entry);
  }
  return [...seen.values()].filter((l) => l.ids.length).slice(0, 10);
}

// ---------- pictures ----------

export const IMAGE_SYSTEM = [
  'Ты описываешь изображение, чтобы его можно было найти поиском по словам.',
  '- description: одно-два предложения по-русски — что на изображении: объекты, люди, место, время суток, крупность плана, настроение, стиль. Без слов «на изображении» и без оценок.',
  '- text: весь читаемый текст с изображения дословно, на языке оригинала, строки через перевод строки. Если текста нет — пустая строка.',
].join('\n');

export const IMAGE_SCHEMA = {
  type: 'object',
  properties: { description: { type: 'string' }, text: { type: 'string' } },
  required: ['description', 'text'],
  additionalProperties: false,
} as const;

export interface ImageNote {
  description: string;
  text: string;
}

export function checkImageNote(note: Partial<ImageNote> | null | undefined): ImageNote {
  return { description: String(note?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 600), text: String(note?.text ?? '').trim().slice(0, 4000) };
}

/** What is stored on the image for search: the description, then the text read from it. */
export const imageSearchText = (note: ImageNote) => [note.description, note.text].filter(Boolean).join('\n');

// ---------- review comments into tasks ----------

export const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Что сделать, одно действие' }, timecodes: { type: 'array', items: { type: 'string' }, description: 'Таймкоды комментариев, из которых получилась задача' } },
        required: ['text', 'timecodes'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
} as const;

export function tasksRequest(fileName: string, comments: string): AiRequest {
  return {
    system: [
      'Ты помощник режиссёра монтажа. Из комментариев к видео с таймкодами ты делаешь список правок для монтажёра.',
      'Правила:',
      '- Каждая задача — одно конкретное действие в повелительном наклонении: «Укоротить паузу», «Заменить музыку».',
      '- Объединяй комментарии об одном и том же; не теряй ни одного замечания по существу; похвалу и комментарии без действия пропускай.',
      '- В timecodes перечисли таймкоды исходных комментариев в точности как в материале.',
      '- Порядок — по ходу ролика. Язык — как у комментариев.',
    ].join('\n'),
    context: `Видео: ${fileName}\nКомментарии:\n${comments}`,
    prompt: 'Составь список правок.',
    schema: TASKS_SCHEMA,
  };
}

export interface TaskProposal {
  text: string;
  timecodes: string[];
}

export function checkTasks(tasks: TaskProposal[] | undefined, known: Set<string>): TaskProposal[] {
  return (tasks ?? [])
    .map((t) => ({ text: String(t?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), timecodes: (Array.isArray(t?.timecodes) ? t.timecodes : []).filter((c) => typeof c === 'string' && known.has(c)) }))
    .filter((t) => t.text)
    .slice(0, 100);
}
