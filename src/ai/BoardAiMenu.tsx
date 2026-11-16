import { useState } from 'react';
import { IconSparkle } from '../ui/icons';
import { openAiSettings } from './settings';

export interface BoardAiItem {
  label: string;
  hint: string;
  disabled?: boolean;
  run: () => void;
}

/** The AI button of the top bar: actions on the open board and the selection. */
export function BoardAiMenu({ items }: { items: () => BoardAiItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="ibtn ai-btn" aria-label="ИИ" title="ИИ: спросить доски, сводка, метки…" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconSparkle size={17} />
      </button>
      {open && (
        <div className="popover panel" style={{ left: 'auto', right: 0, width: 310, zIndex: 30 }} role="menu" onMouseLeave={() => setOpen(false)}>
          {items().map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item menu-item-2"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              openAiSettings();
            }}
          >
            Настройки ИИ…
          </button>
        </div>
      )}
    </div>
  );
}
