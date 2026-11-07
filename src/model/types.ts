import type { JSONContent } from '@tiptap/core';

/** One grid unit in CSS pixels. Positions and widths are stored in grid units. */
export const GRID = 8;

export const HOME_ID = 'home';

/** Where an element lives inside its parent board. */
export type Section = 'CANVAS' | 'INBOX' | 'TRASH';

/** Card background colors, stored as theme-independent keys. */
export type CardColor = 'default' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'transparent';

/** Board tile accent colors. */
export type BoardColor = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'yellow' | 'gray';

interface ElementBase {
  id: string;
  /** Parent board id; null only for the home board. */
  parentId: string | null;
  section: Section;
  /** Position of the top-left corner, in grid units. */
  x: number;
  y: number;
  /** Width in grid units (height grows with content). */
  width: number;
  /** Stacking order within the board; larger is on top. */
  z: number;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CardElement extends ElementBase {
  type: 'CARD';
  /** Rich text document (TipTap/ProseMirror JSON). */
  content: JSONContent;
  color: CardColor;
}

export interface BoardElement extends ElementBase {
  type: 'BOARD';
  title: string;
  color: BoardColor;
}

export type ZElement = CardElement | BoardElement;
export type ElementType = ZElement['type'];

/** Fields that an update operation may change. */
export type ElementPatch = Partial<Omit<CardElement, 'id' | 'type' | 'color'>> &
  Partial<Omit<BoardElement, 'id' | 'type' | 'color'>> & { color?: CardColor | BoardColor };

export const DEFAULT_WIDTH: Record<ElementType, number> = {
  CARD: 40,
  BOARD: 14,
};

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
