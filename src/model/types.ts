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
  /** Ids of labels (LABEL elements) attached to this element. */
  labels?: string[];
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

/** One end of a line: attached to an element, or a free point in grid units. */
export interface LineEnd {
  elementId: string | null;
  x: number;
  y: number;
}

export type LineColor = 'default' | 'blue' | 'red' | 'green' | 'orange' | 'purple';

export interface LineElement extends ElementBase {
  type: 'LINE';
  start: LineEnd;
  end: LineEnd;
  /** Sideways offset of the curve's middle, in canvas pixels (0 = straight). */
  bend: number;
  label: string;
  color: LineColor;
  weight: 1 | 2 | 3;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface SwatchElement extends ElementBase {
  type: 'COLOR_SWATCH';
  /** #rrggbb */
  hex: string;
  name: string;
  display: 'hex' | 'rgb' | 'hsl' | 'none';
}

export type CellKind = 'auto' | 'number' | 'currency' | 'percent' | 'checkbox' | 'text' | 'date';

export interface CellFormat {
  kind?: CellKind;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  /** Background, as a card colour key. */
  fill?: CardColor;
}

export interface TableElement extends ElementBase {
  type: 'TABLE';
  /** What was typed in each cell, row by row; formulas start with "=". */
  cells: string[][];
  /** Column widths in pixels. */
  colWidths: number[];
  /** Formats keyed by "row,col". */
  formats: Record<string, CellFormat>;
  /** The first row is styled as a header. */
  header: boolean;
}

export interface DocumentElement extends ElementBase {
  type: 'DOCUMENT';
  title: string;
  content: JSONContent;
  /** Show the beginning of the text on the board instead of an icon. */
  preview: boolean;
}

/** A label definition. Labels live outside boards (parentId null). */
export interface LabelElement extends ElementBase {
  type: 'LABEL';
  name: string;
  color: LabelColor;
}

export type LabelColor = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'yellow' | 'red' | 'gray';

export type ZElement =
  | CardElement
  | BoardElement
  | ColumnElement
  | TaskListElement
  | ImageElement
  | FileElement
  | LinkElement
  | LineElement
  | SwatchElement
  | LabelElement
  | TableElement
  | DocumentElement;
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
  Partial<Omit<LinkElement, 'id' | 'type'>> &
  Partial<Omit<LineElement, 'id' | 'type' | 'color'>> &
  Partial<Omit<SwatchElement, 'id' | 'type'>> &
  Partial<Omit<LabelElement, 'id' | 'type' | 'color'>> &
  Partial<Omit<TableElement, 'id' | 'type'>> &
  Partial<Omit<DocumentElement, 'id' | 'type'>> & { color?: CardColor | BoardColor | LineColor | LabelColor };

export const DEFAULT_WIDTH: Record<ElementType, number> = {
  CARD: 40,
  BOARD: 14,
  COLUMN: 36,
  TASK_LIST: 40,
  IMAGE: 32,
  FILE: 40,
  LINK: 40,
  LINE: 0,
  COLOR_SWATCH: 12,
  LABEL: 0,
  TABLE: 46,
  DOCUMENT: 14,
};

/** Types that can be placed inside a column. */
export function fitsInColumn(type: ElementType): boolean {
  return type !== 'COLUMN' && type !== 'LINE' && type !== 'LABEL';
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
