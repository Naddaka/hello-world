import * as formulajs from '@formulajs/formulajs';

/** A computed cell value. Errors are strings starting with '#'. */
export type Value = number | string | boolean | Date | null;

export class FormulaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

// ---------- addresses ----------
export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(name: string): number {
  return [...name.toUpperCase()].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

// ---------- parsing raw input ----------
const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_RU = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** Interprets what was typed into a cell (when it is not a formula). */
export function literal(raw: string): Value {
  const t = raw.trim();
  if (t === '') return null;
  const upper = t.toUpperCase();
  if (upper === 'TRUE' || upper === 'ИСТИНА') return true;
  if (upper === 'FALSE' || upper === 'ЛОЖЬ') return false;
  const num = t.replace(/[\s ]/g, '').replace(/[₽$€£]$/, '').replace(/^[₽$€£]/, '');
  if (/^-?\d+(?:[.,]\d+)?%$/.test(num)) return Number(num.slice(0, -1).replace(',', '.')) / 100;
  if (/^-?\d+(?:[.,]\d+)?(?:e-?\d+)?$/i.test(num)) return Number(num.replace(',', '.'));
  let m = t.match(DATE_ISO);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(DATE_RU);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return t;
}

// ---------- tokenizer ----------
type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; r: number; c: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; } | { t: ')' } | { t: ',' } | { t: ':' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length) {
        if (src[j] === '"' && src[j + 1] === '"') {
          s += '"';
          j += 2;
        } else if (src[j] === '"') break;
        else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError('#ERROR!');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = src.slice(i).match(/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const ref = src.slice(i).match(/^\$?([A-Za-z]{1,3})\$?(\d+)(?![\w(.])/);
    if (ref) {
      out.push({ t: 'ref', r: Number(ref[2]) - 1, c: colIndex(ref[1]) });
      i += ref[0].length;
      continue;
    }
    const name = src.slice(i).match(/^[A-Za-zА-Яа-яЁё_][\w.А-Яа-яЁё]*/);
    if (name) {
      out.push({ t: 'name', v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const op = src.slice(i).match(/^(<=|>=|<>|[-+*/^&=<>%])/);
    if (op) {
      out.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ':') {
      out.push({ t: ch } as Tok);
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      out.push({ t: ',' });
      i++;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  return out;
}

// ---------- parser (precedence climbing) ----------
type Node =
  | { k: 'lit'; v: Value }
  | { k: 'ref'; r: number; c: number }
  | { k: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'pct'; a: Node };

const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

function parse(tokens: Tok[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t: Tok['t']) => {
    if (peek()?.t !== t) throw new FormulaError('#ERROR!');
    return next();
  };

  const primary = (): Node => {
    const tok = next();
    if (!tok) throw new FormulaError('#ERROR!');
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) return { k: 'un', op: tok.v, a: unary() };
    if (tok.t === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (tok.t === 'ref') {
      if (peek()?.t === ':') {
        next();
        const end = expect('ref') as Extract<Tok, { t: 'ref' }>;
        return { k: 'range', r1: Math.min(tok.r, end.r), c1: Math.min(tok.c, end.c), r2: Math.max(tok.r, end.r), c2: Math.max(tok.c, end.c) };
      }
      return { k: 'ref', r: tok.r, c: tok.c };
    }
    if (tok.t === 'name') {
      if (peek()?.t === '(') {
        next();
        const args: Node[] = [];
        if (peek()?.t !== ')') {
          do args.push(expr(0));
          while (peek()?.t === ',' && next());
        }
        expect(')');
        return { k: 'call', name: tok.v, args };
      }
      if (tok.v === 'TRUE' || tok.v === 'ИСТИНА') return { k: 'lit', v: true };
      if (tok.v === 'FALSE' || tok.v === 'ЛОЖЬ') return { k: 'lit', v: false };
      throw new FormulaError('#NAME?');
    }
    throw new FormulaError('#ERROR!');
  };
  const unary = (): Node => {
    let n = primary();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '%') {
      next();
      n = { k: 'pct', a: n };
    }
    return n;
  };
  const expr = (min: number): Node => {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok?.t !== 'op' || !(tok.v in PREC) || PREC[tok.v] < min) return left;
      next();
      // ^ is right-associative, everything else left-associative.
      const right = expr(tok.v === '^' ? PREC[tok.v] : PREC[tok.v] + 1);
      left = { k: 'bin', op: tok.v, a: left, b: right };
    }
  };
  const tree = expr(0);
  if (pos !== tokens.length) throw new FormulaError('#ERROR!');
  return tree;
}

// ---------- evaluation ----------
type Fn = (...args: unknown[]) => unknown;
const extra: Record<string, Fn> = {
  COUNTUNIQUE: (...args) => new Set(args.flat(Infinity as 1).filter((v) => v !== null && v !== '').map(String)).size,
  SPLIT: (text, sep) => String(text).split(String(sep)).join(', '),
};

function lookup(name: string): Fn | null {
  if (extra[name]) return extra[name];
  const lib = formulajs as unknown as Record<string, unknown>;
  const direct = lib[name] ?? lib[name.replace(/\./g, '')];
  if (typeof direct === 'function') return direct as Fn;
  const nested = name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], lib);
  return typeof nested === 'function' ? (nested as Fn) : null;
}

// Not a type guard on purpose: a failed check must not rule out ordinary strings.
const isError = (v: unknown): boolean => typeof v === 'string' && /^#[A-Z/0!?]+[!?]?$/.test(v);

function toNumber(v: Value): number {
  if (isError(v)) throw new FormulaError(v as string);
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime() / 86_400_000 + 25569;
  if (typeof v === 'number') return v;
  const n = literal(v);
  if (typeof n === 'number') return n;
  throw new FormulaError('#VALUE!');
}

function normalise(result: unknown): Value {
  if (result instanceof Error) {
    const code = (result as Error & { value?: string }).value ?? result.message;
    return code.startsWith('#') ? code : '#ERROR!';
  }
  if (typeof result === 'number') return Number.isFinite(result) ? result : '#NUM!';
  if (result === undefined) return null;
  if (Array.isArray(result)) return normalise(result.flat(Infinity as 1)[0]);
  return result as Value;
}

export type CellGetter = (r: number, c: number) => Value;

function evaluate(node: Node, get: CellGetter): Value | Value[][] {
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'ref':
      return get(node.r, node.c);
    case 'range': {
      const rows: Value[][] = [];
      for (let r = node.r1; r <= node.r2; r++) {
        const row: Value[] = [];
        for (let c = node.c1; c <= node.c2; c++) row.push(get(r, c));
        rows.push(row);
      }
      return rows;
    }
    case 'pct':
      return toNumber(scalar(evaluate(node.a, get))) / 100;
    case 'un': {
      const v = toNumber(scalar(evaluate(node.a, get)));
      return node.op === '-' ? -v : v;
    }
    case 'bin': {
      const a = scalar(evaluate(node.a, get));
      const b = scalar(evaluate(node.b, get));
      if (isError(a)) return a;
      if (isError(b)) return b;
      switch (node.op) {
        case '+': return toNumber(a) + toNumber(b);
        case '-': return toNumber(a) - toNumber(b);
        case '*': return toNumber(a) * toNumber(b);
        case '/': {
          const d = toNumber(b);
          return d === 0 ? '#DIV/0!' : toNumber(a) / d;
        }
        case '^': return Math.pow(toNumber(a), toNumber(b));
        case '&': return `${a ?? ''}${b ?? ''}`;
        default: {
          const both = typeof a === 'number' || typeof b === 'number';
          const x = both ? toNumber(a) : String(a ?? '').toLowerCase();
          const y = both ? toNumber(b) : String(b ?? '').toLowerCase();
          return { '=': x === y, '<>': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[node.op] ?? '#ERROR!';
        }
      }
    }
    case 'call': {
      const fn = lookup(node.name);
      if (!fn) return '#NAME?';
      const args = node.args.map((a) => evaluate(a, get));
      try {
        return normalise(fn(...args));
      } catch (error) {
        return error instanceof FormulaError ? error.code : '#ERROR!';
      }
    }
  }
}

function scalar(v: Value | Value[][]): Value {
  return Array.isArray(v) ? (v[0]?.[0] ?? null) : v;
}

/** Computes a formula (without the leading '='). */
export function compute(formula: string, get: CellGetter): Value {
  try {
    const v = evaluate(parse(tokenize(formula)), get);
    return normalise(scalar(v));
  } catch (error) {
    return error instanceof FormulaError ? error.code : '#ERROR!';
  }
}

/** Evaluates every cell of a table, following references, with cycle detection. */
export function computeTable(cells: string[][]): Value[][] {
  const rows = cells.length;
  const cols = rows ? Math.max(...cells.map((r) => r.length)) : 0;
  const memo = new Map<string, Value>();
  const visiting = new Set<string>();
  const get: CellGetter = (r, c) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    const key = `${r},${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return '#CYCLE!';
    const raw = cells[r]?.[c] ?? '';
    let value: Value;
    if (raw.startsWith('=') && raw.length > 1) {
      visiting.add(key);
      value = compute(raw.slice(1), get);
      visiting.delete(key);
    } else value = literal(raw);
    memo.set(key, value);
    return value;
  };
  return cells.map((_, r) => Array.from({ length: cols }, (_c, c) => get(r, c)));
}

export const FUNCTION_NAMES = Object.keys(formulajs).concat(Object.keys(extra)).sort();
