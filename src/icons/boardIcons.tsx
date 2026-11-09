import { useEffect, useState } from 'react';
import { iconMedia } from '../model/types';
import { useMediaSrc } from '../storage/media';
import { IconBoard } from '../ui/icons';

/**
 * Board icons: the Lucide set (2000+ line icons, ISC licence) and emoji with
 * Russian names (Emojibase, MIT). Both are loaded on demand, the first time a
 * board with an icon is shown or the picker is opened. An icon is stored as
 * "lucide:<name>" or "emoji:<character>", or "media:<id>.<ext>" for a picture
 * of the user's own, which fills the tile.
 */

export type LucideIcon = [name: string, svg: string, tags: string];
export type EmojiEntry = [char: string, label: string, tags: string, group: number];

let lucide: Promise<Map<string, LucideIcon>> | null = null;
let lucideReady: Map<string, LucideIcon> | null = null;
export function loadLucide() {
  lucide ??= import('./lucide.json').then((m) => {
    lucideReady = new Map((m.default as LucideIcon[]).map((i) => [i[0], i]));
    return lucideReady;
  });
  return lucide;
}

let emoji: Promise<{ groups: string[]; emoji: EmojiEntry[] }> | null = null;
export function loadEmoji() {
  emoji ??= import('./emoji-ru.json').then((m) => m.default as { groups: string[]; emoji: EmojiEntry[] });
  return emoji;
}

/** A picture of the user's own, covering the icon's box. */
function ImageIcon({ icon, size }: { icon: string; size: number }) {
  const src = useMediaSrc(iconMedia(icon));
  return src ? <img className="board-image" src={src} width={size} height={size} alt="" draggable={false} /> : <span className="board-image" style={{ width: size, height: size }} />;
}

/** The icon of a board, drawn in the tile's colour. */
export function BoardIcon({ icon, size }: { icon: string; size: number }) {
  if (icon.startsWith('media:')) return <ImageIcon icon={icon} size={size} />;
  return <GlyphIcon icon={icon} size={size} />;
}

function GlyphIcon({ icon, size }: { icon: string; size: number }) {
  const [set, setSet] = useState(lucideReady);
  const isLucide = icon.startsWith('lucide:');
  useEffect(() => {
    if (isLucide && !set) void loadLucide().then(setSet);
  }, [isLucide, set]);
  if (icon.startsWith('letter:')) {
    const text = icon.slice(7);
    return (
      <span className="board-letter" style={{ fontSize: size * (text.length > 1 ? 0.72 : 0.95), lineHeight: 1 }} aria-hidden="true">
        {text}
      </span>
    );
  }
  if (icon.startsWith('emoji:')) {
    return (
      <span className="board-emoji" style={{ fontSize: size * 1.05, lineHeight: 1 }} aria-hidden="true">
        {icon.slice(6)}
      </span>
    );
  }
  const found = set?.get(icon.slice(7));
  // An unknown name (e.g. a Milanote icon with no Lucide twin) shows the usual board glyph.
  if (set && !found) return <IconBoard size={size} strokeWidth={1.7} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: found?.[1] ?? '' }}
    />
  );
}

/**
 * Russian words → English words used in Lucide's names and tags, so the
 * picker can be searched in Russian. Keys are stems: «видео» also finds
 * «видеосъёмка».
 */
export const RU_ICON_WORDS: Record<string, string[]> = {
  видео: ['video', 'film', 'clapperboard', 'camera', 'movie'],
  кино: ['film', 'clapperboard', 'popcorn', 'movie', 'projector'],
  фильм: ['film', 'clapperboard', 'movie'],
  съём: ['camera', 'video', 'clapperboard', 'film'],
  камер: ['camera', 'video', 'cctv'],
  фото: ['camera', 'image', 'aperture', 'focus'],
  объектив: ['aperture', 'camera', 'focus'],
  кадр: ['frame', 'crop', 'scan', 'image', 'film'],
  монтаж: ['scissors', 'film', 'clapperboard', 'slice'],
  раскадров: ['layout-grid', 'film', 'images', 'gallery'],
  сцен: ['clapperboard', 'theater', 'drama', 'presentation'],
  сценар: ['scroll', 'file-text', 'notebook', 'book', 'pen'],
  текст: ['text', 'type', 'file-text', 'pilcrow'],
  документ: ['file', 'file-text', 'files', 'folder'],
  файл: ['file', 'files', 'folder'],
  папк: ['folder', 'folders', 'archive'],
  архив: ['archive', 'box', 'package'],
  шаблон: ['layout-template', 'copy', 'stamp'],
  книг: ['book', 'library', 'notebook'],
  учеб: ['graduation', 'school', 'book', 'notebook', 'pencil'],
  учёб: ['graduation', 'school', 'book', 'notebook', 'pencil'],
  школ: ['school', 'graduation', 'backpack'],
  универ: ['graduation', 'school', 'landmark'],
  наук: ['flask', 'atom', 'microscope', 'test-tube', 'telescope', 'dna'],
  истори: ['scroll', 'landmark', 'hourglass', 'history', 'castle'],
  медиц: ['stethoscope', 'hospital', 'pill', 'syringe', 'heart-pulse', 'cross', 'ambulance'],
  здоров: ['heart-pulse', 'activity', 'apple', 'dumbbell'],
  спорт: ['dumbbell', 'trophy', 'bike', 'football', 'volleyball', 'medal'],
  музык: ['music', 'headphones', 'guitar', 'piano', 'disc', 'radio'],
  звук: ['volume', 'audio', 'mic', 'speaker', 'headphones', 'waveform'],
  аудио: ['audio', 'headphones', 'mic', 'volume'],
  микрофон: ['mic', 'podcast'],
  подкаст: ['podcast', 'mic', 'radio'],
  песн: ['music', 'mic'],
  гитар: ['guitar'],
  театр: ['theater', 'drama', 'drama-masks', 'ticket'],
  актёр: ['user', 'drama', 'star', 'contact'],
  актер: ['user', 'drama', 'star', 'contact'],
  кастинг: ['users', 'contact', 'id-card', 'user-search'],
  костюм: ['shirt', 'scissors'],
  грим: ['palette', 'brush', 'sparkles'],
  реквизит: ['package', 'box', 'wrench', 'swords'],
  свет: ['lightbulb', 'lamp', 'sun', 'flashlight', 'sparkles'],
  ламп: ['lightbulb', 'lamp'],
  идея: ['lightbulb', 'sparkles', 'brain', 'zap'],
  иде: ['lightbulb', 'sparkles', 'brain'],
  мысл: ['brain', 'lightbulb', 'message-circle'],
  дизайн: ['palette', 'pen-tool', 'brush', 'shapes', 'figma', 'layers'],
  рисун: ['brush', 'pencil', 'paintbrush', 'palette', 'pen-tool'],
  рис: ['brush', 'pencil', 'paintbrush'],
  цвет: ['palette', 'paint', 'pipette', 'droplet'],
  кист: ['brush', 'paintbrush'],
  карандаш: ['pencil'],
  ручк: ['pen'],
  код: ['code', 'terminal', 'braces', 'git', 'binary'],
  программ: ['code', 'terminal', 'cpu', 'app-window'],
  компьют: ['computer', 'laptop', 'monitor', 'cpu'],
  ноутбук: ['laptop'],
  телефон: ['phone', 'smartphone'],
  смартфон: ['smartphone'],
  интернет: ['globe', 'wifi', 'link', 'earth'],
  сайт: ['globe', 'app-window', 'layout'],
  соцсет: ['share', 'thumbs-up', 'heart', 'message', 'users'],
  ютуб: ['youtube', 'play', 'video', 'tv'],
  стрим: ['radio', 'cast', 'tv', 'video'],
  телевиз: ['tv', 'monitor'],
  проектор: ['projector'],
  наушник: ['headphones', 'headset'],
  игр: ['gamepad', 'dice', 'puzzle', 'joystick', 'trophy'],
  работ: ['briefcase', 'building', 'laptop', 'clipboard'],
  проект: ['folder-kanban', 'kanban', 'briefcase', 'rocket', 'target'],
  бизнес: ['briefcase', 'building', 'chart', 'handshake'],
  офис: ['building', 'briefcase', 'printer'],
  компани: ['building', 'factory', 'briefcase'],
  клиент: ['user', 'users', 'handshake', 'contact'],
  команд: ['users', 'user-group', 'handshake'],
  люд: ['users', 'user', 'person'],
  челов: ['user', 'person', 'smile'],
  семь: ['users', 'home', 'heart', 'baby'],
  ребён: ['baby', 'toy', 'blocks'],
  дет: ['baby', 'toy', 'blocks', 'school'],
  дом: ['house', 'home', 'sofa', 'key'],
  квартир: ['house', 'building', 'key', 'sofa'],
  ремонт: ['hammer', 'wrench', 'paint-roller', 'drill'],
  встреч: ['calendar', 'users', 'handshake', 'coffee'],
  календар: ['calendar'],
  план: ['calendar', 'list-todo', 'kanban', 'target', 'map'],
  задач: ['list-todo', 'check', 'clipboard-check', 'square-check'],
  список: ['list', 'list-checks', 'list-todo'],
  готов: ['check', 'circle-check', 'badge-check', 'party-popper'],
  сделан: ['check', 'circle-check', 'badge-check'],
  врем: ['clock', 'timer', 'hourglass', 'alarm'],
  час: ['clock', 'watch', 'hourglass', 'alarm'],
  срок: ['calendar-clock', 'hourglass', 'timer', 'alarm'],
  цель: ['target', 'crosshair', 'flag', 'trophy'],
  деньг: ['banknote', 'coins', 'wallet', 'piggy-bank', 'dollar', 'credit-card'],
  финанс: ['banknote', 'coins', 'wallet', 'chart', 'piggy-bank', 'landmark'],
  бюджет: ['calculator', 'wallet', 'coins', 'piggy-bank', 'receipt'],
  смет: ['calculator', 'receipt', 'sheet', 'table'],
  покупк: ['shopping-cart', 'shopping-bag', 'store', 'receipt'],
  магазин: ['store', 'shopping-bag', 'shopping-cart'],
  подар: ['gift'],
  праздн: ['party-popper', 'cake', 'gift', 'balloon'],
  еда: ['utensils', 'pizza', 'apple', 'chef', 'soup', 'sandwich'],
  ед: ['utensils', 'pizza', 'chef', 'cooking'],
  рецепт: ['chef-hat', 'cooking-pot', 'utensils', 'book'],
  кофе: ['coffee', 'cup'],
  чай: ['coffee', 'cup', 'leaf'],
  вин: ['wine', 'grape'],
  путешеств: ['plane', 'luggage', 'map', 'compass', 'globe', 'tent'],
  отпуск: ['palmtree', 'plane', 'sun', 'luggage', 'umbrella'],
  самолёт: ['plane'],
  самолет: ['plane'],
  машин: ['car', 'truck', 'fuel'],
  авто: ['car', 'truck', 'fuel', 'car-front'],
  транспорт: ['car', 'bus', 'train', 'truck', 'bike', 'ship'],
  карт: ['map', 'map-pin', 'compass', 'globe'],
  локац: ['map-pin', 'map', 'navigation', 'locate'],
  мест: ['map-pin', 'map', 'navigation'],
  город: ['building', 'city', 'landmark', 'castle'],
  здани: ['building', 'landmark', 'warehouse', 'school'],
  церк: ['church', 'cross'],
  храм: ['church', 'landmark'],
  вер: ['church', 'cross', 'book', 'heart'],
  бог: ['church', 'cross', 'sparkles', 'sun'],
  молитв: ['hands', 'church', 'heart', 'book'],
  природ: ['trees', 'leaf', 'mountain', 'flower', 'sprout', 'sun'],
  дерев: ['tree', 'trees', 'tree-pine'],
  цвет_: ['flower'],
  цветок: ['flower', 'flower-2'],
  гор: ['mountain', 'mountain-snow'],
  мор: ['waves', 'ship', 'anchor', 'shell', 'fish'],
  вод: ['droplet', 'waves', 'glass-water'],
  огон: ['flame', 'campfire'],
  солнц: ['sun', 'sunrise', 'sunset'],
  лун: ['moon', 'moon-star'],
  звезд: ['star', 'stars', 'sparkles'],
  звёзд: ['star', 'stars', 'sparkles'],
  погод: ['cloud', 'sun', 'umbrella', 'snowflake', 'cloud-rain'],
  снег: ['snowflake', 'cloud-snow'],
  животн: ['cat', 'dog', 'bird', 'fish', 'rabbit', 'paw'],
  кот: ['cat'],
  кош: ['cat'],
  собак: ['dog'],
  птиц: ['bird', 'feather'],
  рыб: ['fish'],
  сердц: ['heart'],
  любов: ['heart', 'heart-handshake'],
  избран: ['star', 'heart', 'bookmark'],
  важн: ['star', 'flag', 'alert', 'bookmark', 'zap'],
  внимани: ['alert', 'triangle-alert', 'eye', 'bell'],
  вопрос: ['circle-help', 'message-circle-question', 'help'],
  инфо: ['info', 'circle-help'],
  сообщ: ['message', 'message-circle', 'message-square', 'mail'],
  чат: ['message-circle', 'messages', 'message-square'],
  почт: ['mail', 'inbox', 'send'],
  письм: ['mail', 'send', 'envelope'],
  уведом: ['bell', 'bell-ring'],
  настро: ['settings', 'sliders', 'cog', 'wrench'],
  инструм: ['wrench', 'hammer', 'tool', 'drill', 'ruler'],
  безопасн: ['shield', 'lock', 'key'],
  замок: ['lock', 'castle'],
  ключ: ['key'],
  пароль: ['key', 'lock', 'shield'],
  награ: ['award', 'trophy', 'medal'],
  кубок: ['trophy'],
  корон: ['crown'],
  ракет: ['rocket'],
  запуск: ['rocket', 'play', 'power'],
  стартап: ['rocket', 'lightbulb', 'trending-up'],
  рост: ['trending-up', 'chart', 'sprout'],
  график: ['chart', 'line-chart', 'bar-chart', 'gantt'],
  статист: ['chart', 'bar-chart', 'pie-chart', 'trending-up'],
  аналит: ['chart', 'bar-chart', 'pie-chart', 'search'],
  маркет: ['megaphone', 'target', 'chart', 'trending-up'],
  реклам: ['megaphone', 'badge-percent', 'tv'],
  презентац: ['presentation', 'projector', 'monitor'],
  исследов: ['search', 'microscope', 'flask', 'telescope'],
  поиск: ['search', 'scan-search'],
  заметк: ['sticky-note', 'notebook-pen', 'notepad', 'pencil'],
  блокнот: ['notebook', 'notebook-pen'],
  дневник: ['notebook', 'book-heart', 'calendar'],
  мудборд: ['layout-dashboard', 'images', 'palette'],
  референс: ['images', 'bookmark', 'eye', 'gallery'],
  вдохнов: ['sparkles', 'lightbulb', 'star', 'wand'],
  магия: ['wand', 'sparkles', 'crystal'],
  ии: ['bot', 'brain', 'sparkles', 'cpu'],
  нейро: ['brain', 'bot', 'cpu', 'sparkles'],
  робот: ['bot'],
  корзин: ['trash', 'shopping-basket'],
  удал: ['trash', 'x', 'circle-x'],
  флаг: ['flag'],
  мир: ['globe', 'earth'],
  язык: ['languages', 'globe', 'book'],
  перевод: ['languages'],
  печат: ['printer', 'stamp'],
  ссылк: ['link', 'external-link'],
  пазл: ['puzzle'],
  кубик: ['dice', 'box', 'blocks'],
  стрел: ['arrow'],
  шахмат: ['chess'],
  велосипед: ['bike'],
  спортзал: ['dumbbell'],
  бег: ['footprints', 'activity'],
  йог: ['person-standing', 'flower'],
  сон: ['moon', 'bed', 'alarm'],
  кровать: ['bed'],
  друз: ['users', 'heart-handshake', 'smile'],
  контакт: ['contact', 'phone', 'id-card', 'book-user'],
  юрид: ['scale', 'gavel', 'file-text'],
  договор: ['file-signature', 'handshake', 'pen'],
};

/** English words to look for when the query is Russian. */
export function englishTerms(query: string): string[] {
  const q = query.trim().toLocaleLowerCase('ru-RU');
  if (!q) return [];
  const terms = new Set<string>();
  for (const [stem, words] of Object.entries(RU_ICON_WORDS)) {
    const key = stem.replace(/_$/, '');
    if (q.startsWith(key) || (q.length >= 3 && key.startsWith(q))) words.forEach((w) => terms.add(w));
  }
  return [...terms];
}

/** Lucide icons matching a query (by name and tags, in English or through the Russian words). */
export function searchLucide(icons: LucideIcon[], query: string, limit = 400): LucideIcon[] {
  const q = query.trim().toLowerCase();
  if (!q) return icons.slice(0, limit);
  const terms = /[а-яё]/i.test(q) ? englishTerms(q) : [q];
  if (!terms.length) return [];
  const score = (icon: LucideIcon) => {
    const [name, , tags] = icon;
    let best = 0;
    for (const t of terms) {
      if (name === t) best = Math.max(best, 4);
      else if (name.startsWith(t)) best = Math.max(best, 3);
      else if (name.includes(t)) best = Math.max(best, 2);
      else if (` ${tags} `.includes(` ${t}`)) best = Math.max(best, 1);
    }
    return best;
  };
  return icons
    .map((i) => [i, score(i)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([i]) => i);
}

/** Emoji matching a query by their Russian (or any) name and tags. */
export function searchEmoji(list: EmojiEntry[], query: string, limit = 400): EmojiEntry[] {
  const q = query.trim().toLocaleLowerCase('ru-RU');
  if (!q) return list.slice(0, limit);
  return list.filter(([char, label, tags]) => char === q || label.toLocaleLowerCase('ru-RU').includes(q) || ` ${tags} `.includes(` ${q}`)).slice(0, limit);
}

/** Icons offered first, before any search: common board topics. */
export const SUGGESTED_ICONS = [
  'clapperboard', 'film', 'video', 'camera', 'aperture', 'mic', 'headphones', 'eighth-notes', 'scroll-text', 'notebook-pen',
  'book-open', 'graduation-cap', 'lightbulb', 'sparkles', 'palette', 'brush', 'pen-tool', 'image', 'images', 'layout-dashboard',
  'briefcase', 'building', 'users', 'user', 'handshake', 'calendar', 'list-todo', 'target', 'rocket', 'trophy',
  'chart-line', 'wallet', 'piggy-bank', 'shopping-cart', 'gift', 'house', 'heart', 'star', 'flag', 'bookmark',
  'plane', 'map-pin', 'globe', 'mountain', 'trees', 'sun', 'moon', 'coffee', 'utensils', 'dumbbell',
  'gamepad-2', 'code', 'laptop', 'smartphone', 'bot', 'brain', 'flask-conical', 'stethoscope', 'church', 'archive',
];
