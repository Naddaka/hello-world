import type { TableElement } from '../model/types';
import { computeTable, type Value } from './formula';
import { fileName, saveFile } from '../storage/files';

const cell = (v: Value): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
};

/**
 * The table's computed values as CSV with ";" between fields (what Excel and
 * Numbers expect in a Russian locale) and a BOM so the Cyrillic text opens right.
 */
export function tableToCsv(cells: string[][]): string {
  const quote = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `﻿${computeTable(cells)
    .map((row) => row.map((v) => quote(cell(v))).join(';'))
    .join('\r\n')}\r\n`;
}

export function exportTableCsv(table: TableElement, title = 'Таблица') {
  return saveFile(fileName(title, 'csv'), tableToCsv(table.cells), 'text/csv', { name: 'CSV', extensions: ['csv'] });
}
