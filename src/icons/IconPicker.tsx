import { useEffect, useMemo, useRef, useState } from 'react';
import { boardTint } from '../ui/colors';
import { isIconImageFile, storeIconImage } from './iconImage';
import { letterIcon } from './letters';
import { BoardIcon, SUGGESTED_ICONS, loadEmoji, loadLucide, searchEmoji, searchLucide, type EmojiEntry, type LucideIcon } from './boardIcons';

type Tab = 'icons' | 'emoji' | 'own';
const PAGE = 240;

/** Picks a board icon from the Lucide set or emoji, with search in Russian or English. */
export function IconPicker({ value, color, onPick, onClose, anchor }: { value: string | null | undefined; color: string; onPick: (icon: string | null) => void; onClose: () => void; anchor: DOMRect }) {
  const [tab, setTab] = useState<Tab>(value?.startsWith('emoji:') ? 'emoji' : value?.startsWith('media:') || value?.startsWith('letter:') ? 'own' : 'icons');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isIconImageFile(file)) return setError('Это не изображение. Подойдут PNG, JPG, GIF, WebP или SVG.');
    setError('');
    setBusy(true);
    try {
      pickRef.current(await storeIconImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить изображение');
    } finally {
      setBusy(false);
    }
  };
  const takeFileRef = useRef(takeFile);
  takeFileRef.current = takeFile;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [icons, setIcons] = useState<LucideIcon[] | null>(null);
  const [emoji, setEmoji] = useState<{ groups: string[]; emoji: EmojiEntry[] } | null>(null);
  const [group, setGroup] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadLucide().then((m) => setIcons([...m.values()]));
    void loadEmoji().then(setEmoji);
    input.current?.focus();
  }, []);
  useEffect(() => setLimit(PAGE), [query, tab, group]);
  useEffect(() => {
    if (tab !== 'own') return;
    // A picture pasted while this tab is open becomes the icon (not a card on the board).
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find(isIconImageFile);
      if (!file) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void takeFileRef.current(file);
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [tab]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const shownIcons = useMemo(() => {
    if (!icons) return [];
    if (query.trim()) return searchLucide(icons, query, limit);
    // Common board topics first, then everything.
    const byName = new Map(icons.map((i) => [i[0], i]));
    const first = SUGGESTED_ICONS.map((n) => byName.get(n)).filter((i): i is LucideIcon => !!i);
    const rest = icons.filter((i) => !SUGGESTED_ICONS.includes(i[0]));
    return [...first, ...rest].slice(0, limit);
  }, [icons, query, limit]);
  const totalIcons = icons ? (query.trim() ? searchLucide(icons, query, 5000).length : icons.length) : 0;

  const shownEmoji = useMemo(() => {
    if (!emoji) return [];
    if (query.trim()) return searchEmoji(emoji.emoji, query, limit);
    return emoji.emoji.filter((e) => e[3] === group).slice(0, limit);
  }, [emoji, query, group, limit]);

  const width = 380;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const below = anchor.bottom + 8 + 420 < window.innerHeight;
  const style: React.CSSProperties = below ? { left, top: anchor.bottom + 8, width } : { left, bottom: window.innerHeight - anchor.top + 8, width };

  return (
    <div ref={box} className="icon-picker panel" role="dialog" aria-label="Иконка доски" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="icon-picker-head">
        <div className="sp-tabs" role="tablist" style={{ padding: 0, position: 'static' }}>
          <button type="button" role="tab" aria-selected={tab === 'icons'} className={tab === 'icons' ? 'on' : ''} onClick={() => setTab('icons')}>
            Иконки{icons ? ` · ${icons.length}` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>
            Эмодзи{emoji ? ` · ${emoji.emoji.length}` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'own'} className={tab === 'own' ? 'on' : ''} onClick={() => setTab('own')}>
            Своё
          </button>
        </div>
        {tab !== 'own' && <input ref={input} className="icon-search" placeholder={tab === 'icons' ? 'Поиск: видео, деньги, учёба…' : 'Поиск: кот, огонь, праздник…'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск иконки" />}
        {tab === 'emoji' && !query.trim() && emoji && (
          <div className="icon-groups">
            {emoji.groups.map((g, i) =>
              i === 2 ? null : (
                <button key={g} type="button" className={`icon-group${i === group ? ' on' : ''}`} onClick={() => setGroup(i)}>
                  {g}
                </button>
              ),
            )}
          </div>
        )}
      </div>
      <div className="icon-grid" style={{ color: boardTint(color).fg }}>
        {tab === 'icons' &&
          shownIcons.map(([name]) => (
            <button key={name} type="button" className={`icon-cell${value === `lucide:${name}` ? ' on' : ''}`} title={name} aria-label={name} onClick={() => onPick(`lucide:${name}`)}>
              <BoardIcon icon={`lucide:${name}`} size={22} />
            </button>
          ))}
        {tab === 'emoji' &&
          shownEmoji.map(([char, label]) => (
            <button key={char} type="button" className={`icon-cell emoji${value === `emoji:${char}` ? ' on' : ''}`} title={label} aria-label={label} onClick={() => onPick(`emoji:${char}`)}>
              {char}
            </button>
          ))}
        {tab === 'icons' && icons && !shownIcons.length && <p className="col-empty">Ничего не нашлось — попробуйте другое слово или английское название</p>}
        {tab === 'emoji' && emoji && !shownEmoji.length && <p className="col-empty">Ничего не нашлось</p>}
        {tab !== 'own' && (!icons || !emoji) && <p className="col-empty">Загрузка…</p>}
        {tab === 'own' && (
          <div
            className={`icon-own${dropping ? ' drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropping(false);
              void takeFile(e.dataTransfer.files[0]);
            }}
          >
            {value?.startsWith('media:') && <BoardIcon icon={value} size={96} />}
            <button type="button" className="btn-accent" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Сохраняю…' : value?.startsWith('media:') ? 'Заменить изображение…' : 'Выбрать изображение…'}
            </button>
            <p>Или перетащите файл сюда, или вставьте картинку из буфера (⌘V). PNG, JPG, GIF, WebP или SVG; большое изображение уменьшится до 320 пикселей.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <form
              className="icon-letter"
              onSubmit={(e) => {
                e.preventDefault();
                const text = letterIcon(new FormData(e.currentTarget).get('letter')?.toString() ?? '');
                if (text) onPick(`letter:${text}`);
              }}
            >
              <label htmlFor="icon-letter">Или буквы:</label>
              <input id="icon-letter" name="letter" maxLength={2} placeholder="АБ" defaultValue={value?.startsWith('letter:') ? value.slice(7) : ''} onKeyDown={(e) => e.stopPropagation()} />
              <button type="submit" className="link-btn">Поставить</button>
            </form>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/heic,.png,.jpg,.jpeg,.gif,.webp,.svg,.heic"
              hidden
              aria-label="Файл изображения"
              onChange={(e) => {
                void takeFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>
      <footer className="icon-picker-foot">
        <button type="button" className="link-btn" onClick={() => onPick(null)} disabled={!value}>
          Без иконки
        </button>
        {tab === 'icons' && shownIcons.length < totalIcons && (
          <button type="button" className="link-btn" onClick={() => setLimit(limit + PAGE)}>
            Показать ещё ({totalIcons - shownIcons.length})
          </button>
        )}
      </footer>
    </div>
  );
}
