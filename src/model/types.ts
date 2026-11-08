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
  /** Notes sharing a sync group always show the same text. */
  syncGroup?: string;
}

export interface BoardElement extends ElementBase {
  type: 'BOARD';
  title: string;
  color: BoardColor;
  /** Offered in the template picker of empty boards. */
  isTemplate?: boolean;
}

/** A shortcut to a board that lives somewhere else. */
export interface AliasElement extends ElementBase {
  type: 'ALIAS';
  targetId: string;
}

export interface CommentMessage {
  id: string;
  text: string;
  at: number;
  reactions: string[];
}

export interface CommentElement extends ElementBase {
  type: 'COMMENT';
  messages: CommentMessage[];
  /** Card the comment is pinned to; it then shows as a marker on that card. */
  attachedTo: string | null;
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
  /** Drawing over the image, in units of 1000 per image width. */
  annotations?: Stroke[];
}

export type MarkerColor = 'blue' | 'red' | 'green' | 'yellow' | 'purple';

/** A review comment at a moment of a video or audio file. */
export interface VideoMarker {
  id: string;
  /** Seconds from the start. */
  time: number;
  text: string;
  color: MarkerColor;
  done: boolean;
}

export interface FileElement extends ElementBase {
  type: 'FILE';
  media: MediaRef;
  name: string;
  size: number;
  mime: string;
  autoplay: boolean;
  loop: boolean;
  /** Review comments by timecode (video and audio). */
  markers?: VideoMarker[];
  /** Frame rate used for timecodes and exports. */
  fps?: number;
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

/** A freehand stroke: flat [x0, y0, x1, y1, …] coordinates. */
export interface Stroke {
  color: string;
  size: number;
  points: number[];
}

/** Freehand drawing made directly on the board; points in pixels from its top-left. */
export interface DrawingElement extends ElementBase {
  type: 'DRAWING';
  strokes: Stroke[];
  /** Height in pixels (width is the element width). */
  height: number;
}

/** Storyboard data of a frame: where it belongs and how it is shot. */
export interface ShotInfo {
  /** Scene number, e.g. "12" or "12A". */
  scene: string;
  /** Shot number within the scene, e.g. "3". */
  shot: string;
  /** Shot size (крупность), e.g. "Крупный". */
  size: string;
  angle: string;
  movement: string;
  lens: string;
  /** Planned length in seconds. */
  duration: number | null;
}

/** A card to draw on (storyboard frames); points in units of 1000 per card width. */
export interface SketchElement extends ElementBase {
  type: 'SKETCH';
  strokes: Stroke[];
  /** Width divided by height. */
  aspect: number;
  caption: string;
  /** Set on storyboard frames. */
  shot?: ShotInfo;
  /** A picture under the drawing (a reference still, a photo of the location). */
  backdrop?: MediaRef | null;
}

/** Kinds of screenplay paragraphs (the standard set used by Final Draft and Fountain). */
export type ScriptBlockType = 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'shot' | 'centered';

export interface ScriptBlock {
  id: string;
  type: ScriptBlockType;
  /** Plain text; parentheticals are stored without their brackets. */
  text: string;
  /** On a character line: this speech runs beside the previous one (dual dialogue). */
  dual?: boolean;
}

/** Page layouts: Hollywood (US Letter), European A4, Russian A4. */
export type ScriptFormat = 'hollywood' | 'a4' | 'russian';

export interface ScriptTitlePage {
  title: string;
  credit: string;
  authors: string;
  source: string;
  draftDate: string;
  contact: string;
}

export type BreakdownCategory =
  | 'extras'
  | 'props'
  | 'wardrobe'
  | 'makeup'
  | 'set'
  | 'vehicles'
  | 'animals'
  | 'stunts'
  | 'sfx'
  | 'vfx'
  | 'sound'
  | 'equipment'
  | 'notes';

/** An element of the script breakdown; it is found in the text wherever its name occurs (in any grammatical form). */
export interface BreakdownItem {
  id: string;
  category: BreakdownCategory;
  name: string;
}

/** A screenplay, shown on the board as a tile and edited full screen. */
export interface ScriptElement extends ElementBase {
  type: 'SCRIPT';
  title: string;
  blocks: ScriptBlock[];
  format: ScriptFormat;
  titlePage: ScriptTitlePage;
  sceneNumbers: boolean;
  /** Props, wardrobe, vehicles… tagged in the text (cast and locations come from the script itself). */
  breakdown?: BreakdownItem[];
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
  | DocumentElement
  | DrawingElement
  | SketchElement
  | AliasElement
  | CommentElement
  | ScriptElement;
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
  Partial<Omit<DocumentElement, 'id' | 'type'>> &
  Partial<Omit<DrawingElement, 'id' | 'type'>> &
  Partial<Omit<SketchElement, 'id' | 'type'>> &
  Partial<Omit<AliasElement, 'id' | 'type'>> &
  Partial<Omit<CommentElement, 'id' | 'type'>> &
  Partial<Omit<ScriptElement, 'id' | 'type'>> & { color?: CardColor | BoardColor | LineColor | LabelColor };

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
  DRAWING: 10,
  SKETCH: 32,
  ALIAS: 14,
  COMMENT: 34,
  SCRIPT: 14,
};

/** Types that can be placed inside a column. */
export function fitsInColumn(type: ElementType): boolean {
  return type !== 'COLUMN' && type !== 'LINE' && type !== 'LABEL';
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
