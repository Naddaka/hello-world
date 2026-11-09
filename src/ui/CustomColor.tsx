import { useEffect, useRef, useState } from 'react';
import { isHexColor, recentColors, rememberColor, type HexColor } from './colors';

/**
 * The end of a palette: recently used custom colours and a rainbow "+" that
 * opens the system colour panel. While the colour is dragged it is previewed
 * (onPreview); the choice is made when the panel reports a change or the colour
 * stays put for a moment, which gives one undo step per choice.
 */
export function CustomColors({
  value,
  onPick,
  onPreview,
  swatchClass,
  swatchStyle = (c) => ({ background: c }),
}: {
  /** The current colour, when all selected things share one. */
  value: string | null | undefined;
  onPick: (hex: HexColor) => void;
  onPreview?: (hex: HexColor) => void;
  swatchClass: string;
  swatchStyle?: (hex: HexColor) => React.CSSProperties;
}) {
  const [recent, setRecent] = useState(recentColors);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ onPick, onPreview });
  latest.current = { onPick, onPreview };

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    let timer = 0;
    let pending: HexColor | null = null;
    const pick = () => {
      window.clearTimeout(timer);
      if (!pending) return;
      const hex = pending;
      pending = null;
      rememberColor(hex);
      setRecent(recentColors());
      latest.current.onPick(hex);
    };
    const onInput = () => {
      const hex = el.value.toLowerCase();
      if (!isHexColor(hex)) return;
      pending = hex;
      if (latest.current.onPreview) {
        latest.current.onPreview(hex);
        window.clearTimeout(timer);
        timer = window.setTimeout(pick, 700);
      }
    };
    el.addEventListener('input', onInput);
    const onChange = () => {
      onInput();
      pick();
      // Give the keyboard back to the board, so ⌘Z undoes the colour right away.
      el.blur();
    };
    el.addEventListener('change', onChange);
    return () => {
      // Closing the palette mid-drag keeps the colour that was shown.
      pick();
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onChange);
    };
  }, []);

  const shown = [...(isHexColor(value) && !recent.includes(value) ? [value] : []), ...recent].slice(0, 8);
  return (
    <>
      {shown.map((c) => (
        <button key={c} type="button" className={`${swatchClass}${c === value ? ' on' : ''}`} style={swatchStyle(c)} aria-label={`Свой цвет ${c}`} aria-pressed={c === value} title={c.toUpperCase()} onClick={() => onPick(c)} />
      ))}
      <span className={`${swatchClass} custom-color`} title="Свой цвет…">
        <input ref={input} type="color" aria-label="Свой цвет" defaultValue={isHexColor(value) ? value : '#2f54eb'} onPointerDown={(e) => e.stopPropagation()} />
      </span>
    </>
  );
}
