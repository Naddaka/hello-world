import { useLayoutEffect, useRef, useState } from 'react';

const LINES = 2;

/**
 * A tile title on at most two lines, shortened at a word boundary with "…".
 * CSS line clamping alone sometimes cuts a word without the ellipsis in
 * WebKit, so the text is measured (in a hidden twin that React leaves empty)
 * and shortened here; the full title shows on hover.
 */
export function TileTitle({ text }: { text: string }) {
  const measure = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(text);

  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    const fit = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 17;
      const max = lineHeight * LINES + 1;
      const fits = (s: string) => {
        el.textContent = s;
        return el.scrollHeight <= max;
      };
      if (fits(text)) return setShown(text);
      // Longest prefix that fits with an ellipsis, then back to the last word boundary.
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(`${text.slice(0, mid).trimEnd()}…`)) lo = mid;
        else hi = mid - 1;
      }
      const cut = text.slice(0, lo);
      const space = cut.search(/\s\S*$/);
      const words = space > lo * 0.6 ? cut.slice(0, space) : cut;
      setShown(`${words.trimEnd().replace(/[\s,.;:(–—-]+$/, '')}…`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      {shown === text ? (
        <div className="tile-title">{text}</div>
      ) : (
        // Shortened on screen; the full title stays readable for screen readers and search.
        <div className="tile-title" title={text}>
          <span aria-hidden="true">{shown}</span>
          <span className="sr-only">{text}</span>
        </div>
      )}
      <div ref={measure} className="tile-title tile-measure" aria-hidden="true" />
    </>
  );
}
