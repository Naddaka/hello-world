import type { JSONContent } from '@tiptap/core';

/** One grid unit in CSS pixels. Positions and widths are stored in grid units. */
export const GRID = 8;

export const HOME_ID = 'home';

/** Days an element stays in the trash before it is deleted for good. */
export const TRASH_RETENTION_DAYS = 90;

/** Where an element lives inside its parent (a board or a column). */
export type Section = 'CANVAS' | 'INBOX' | 'TRASH';

/** Card background colors, stored as theme-independent keys. */
export type CardColor = 'default' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'transparent';

/** Board tile accent colors. */
export type BoardColor = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'yellow' | 'gray';

interface ElementBase {
  id: string;
  /**
   * Parent board or column id; null only for the home board. Items inside a
   * column have the column as parent and are ordered by `z`.
   */
  parentId: string | null;
  section: Section;
  /** Position of the top-left corner, in grid units (ignored inside columns). */
  x: number;
  y: number;
  /** Width in grid units (height grows with content). */
  width: number;
  /** Stacking order on a canvas, or order inside a column / panel. */
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

export interface ColumnElement extends ElementBase {
  type: 'COLUMN';
  title: string;
  collapsed: boolean;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  /** Due date as a timestamp (ms), or null. */
  due: number | null;
  /** 0 for top level, 1 for a sub-task. */
  indent: number;
}

export interface TaskListElement extends ElementBase {
  type: 'TASK_LIST';
  title: string;
  showTitle: boolean;
  items: TaskItem[];
}

/** A file stored in the local media library. */
export interface MediaRef {
  id: string;
  ext: string;
}

export interface ImageElement extends ElementBase {
  type: 'IMAGE';
  media: MediaRef;
  name: string;
  /** Natural size in pixels, for the aspect ratio. */
  naturalWidth: number;
  naturalHeight: number;
  caption: string;
  showCaption: boolean;
}

export interface FileElement extends ElementBase {
  type: 'FILE';
  media: MediaRef;
  name: string;
  size: number;
  mime: string;
  autoplay: boolean;
  loop: boolean;
}

export interface LinkElement extends ElementBase {
  type: 'LINK';
  url: string;
  title: string;
  description: string;
  siteName: string;
  /** Preview image saved locally, so it works offline. */
  image: MediaRef | null;
  showImage: boolean;
  showDescription: boolean;
  status: 'empty' | 'loading' | 'ready' | 'error';
}

export type ZElement = CardElement | BoardElement | ColumnElement | TaskListElement | ImageElement | FileElement | LinkElement;
export type ElementType = ZElement['type'];

type BaseKeys = 'id' | 'parentId' | 'section' | 'x' | 'y' | 'z' | 'width' | 'createdAt' | 'updatedAt';
/** The type-specific fields of an element (distributes over the element union). */
export type ElementFields<E extends ZElement = ZElement> = E extends ZElement ? Omit<E, BaseKeys> : never;

/** Fields that an update operation may change. */
export type ElementPatch = Partial<Omit<CardElement, 'id' | 'type' | 'color'>> &
  Partial<Omit<BoardElement, 'id' | 'type' | 'color'>> &
  Partial<Omit<ColumnElement, 'id' | 'type'>> &
  Partial<Omit<TaskListElement, 'id' | 'type'>> &
  Partial<Omit<ImageElement, 'id' | 'type'>> &
  Partial<Omit<FileElement, 'id' | 'type'>> &
  Partial<Omit<LinkElement, 'id' | 'type'>> & { color?: CardColor | BoardColor };

export const DEFAULT_WIDTH: Record<ElementType, number> = {
  CARD: 40,
  BOARD: 14,
  COLUMN: 36,
  TASK_LIST: 40,
  IMAGE: 32,
  FILE: 40,
  LINK: 40,
};

/** Types that can be placed inside a column. */
export function fitsInColumn(type: ElementType): boolean {
  return type !== 'COLUMN';
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
