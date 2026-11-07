import { describe, expect, it } from 'vitest';
import { colIndex, colName, computeTable, literal } from './formula';

const calc = (cells: string[][]) => computeTable(cells);

describe('formula engine', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 25, 26, 27, 701].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
    expect(colIndex('AA')).toBe(26);
  });

  it('reads typed values', () => {
    expect(literal('48 000')).toBe(48000);
    expect(literal('3,5')).toBe(3.5);
    expect(literal('15%')).toBe(0.15);
    expect(literal('1 200 ₽')).toBe(1200);
    expect(literal('07.11.2026')).toEqual(new Date(2026, 10, 7));
    expect(literal('Стедикам')).toBe('Стедикам');
  });

  it('computes arithmetic with precedence, references and ranges', () => {
    const v = calc([
      ['48000', '2'],
      ['36000', '=A1*B1'],
      ['=SUM(A1:A2)', '=2+3*4^2'],
      ['=-A1/4', '=(1+2)*3'],
    ]);
    expect(v[1][1]).toBe(96000);
    expect(v[2][0]).toBe(84000);
    expect(v[2][1]).toBe(50);
    expect(v[3][0]).toBe(-12000);
    expect(v[3][1]).toBe(9);
  });

  it('runs library functions, including ; as separator and lower case', () => {
    const v = calc([
      ['10', '20', '30'],
      ['=average(A1:C1)', '=IF(A1>5;"много";"мало")', '=ROUND(2.345, 2)'],
      ['=CONCATENATE("Кадр ", A1)', '=COUNTIF(A1:C1, ">15")', '=VLOOKUP(20, A1:C1, 1, FALSE)'],
      ['=COUNTUNIQUE(A1:C1, 10)', '=MAX(A1:C1)-MIN(A1:C1)', '=A1&"/"&B1'],
    ]);
    expect(v[1]).toEqual([20, 'много', 2.35]);
    expect(v[2][0]).toBe('Кадр 10');
    expect(v[2][1]).toBe(2);
    expect(v[3]).toEqual([3, 20, '10/20']);
  });

  it('reports errors like a spreadsheet', () => {
    const v = calc([['=1/0', '=NOSUCH(1)', '=B2', '=A1+1'], ['', '=C1', '=SUM(', '']]);
    expect(v[0][0]).toBe('#DIV/0!');
    expect(v[0][1]).toBe('#NAME?');
    expect(v[0][2]).toBe('#CYCLE!');
    expect(v[1][2]).toBe('#ERROR!');
    expect(v[0][3]).toBe('#DIV/0!');
  });
});
