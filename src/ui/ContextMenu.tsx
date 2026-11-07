import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | 'sep';

interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[] | null;
}

export const useMenu = create<MenuState>(() => ({ x: 0, y: 0, items: null }));

export function openMenu(x: number, y: number, items: MenuEntry[]) {
  useMenu.setState({ x, y, items });
}

export function closeMenu() {
  useMenu.setState({ items: null });
}

export function ContextMenu() {
  const { x, y, items } = useMenu();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!items) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [items]);

  if (!items) return null;
  // Keep the menu inside the window.
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 16);
  return (
    <div ref={ref} className="ctxmenu panel" role="menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              closeMenu();
              item.run();
            }}
          >
            {item.label}
            {item.hint && <span className="hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
