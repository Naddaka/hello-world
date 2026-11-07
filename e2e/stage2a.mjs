// Stage 2a: tables with formulas, documents with export.
import { readFileSync } from 'node:fs';
import { dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 2a', 4334, async ({ page, check }) => {
  // --- a table: typing, Tab/Enter navigation, formulas
  await dragTool(page, 'Таблица', { x: 820, y: 180 });
  await page.waitForSelector('.table-box.editing');
  // One row at a time: Tab between cells, Enter goes to the start of the next row.
  const row = async (...values) => {
    for (const [i, v] of values.entries()) {
      await page.keyboard.type(v);
      await page.keyboard.press(i === values.length - 1 ? 'Enter' : 'Tab');
    }
  };
  await row('Позиция', 'Сумма');
  await row('Камера', '48000');
  await row('Стедикам', '36000');
  await row('Итого', '=SUM(B2:B3)');
  const cellLoc = (r, c) => page.locator('.zt tbody tr').nth(r).locator('td').nth(c);
  // Russian number formatting groups digits with (narrow) no-break spaces.
  const cell = (r, c) => ({
    textContent: async () => (await cellLoc(r, c).textContent())?.replace(/[\u00a0\u202f]/g, ' '),
    click: (o) => cellLoc(r, c).click(o),
  });
  check('typing fills cells; Tab moves right, Enter returns to the row start', (await cell(1, 0).textContent())?.endsWith('Камера') && (await cell(2, 1).textContent()) === '36 000');
  check('=SUM over a range computes the total', (await cell(3, 1).textContent()) === '84 000', await cell(3, 1).textContent());

  // currency format for the total
  await cell(3, 1).click({ position: { x: 40, y: 10 } });
  await page.selectOption('.table-bar select', 'currency');
  check('a cell can be formatted as currency', (await cell(3, 1).textContent())?.includes('₽'), await cell(3, 1).textContent());

  // ⌥↓ adds a row, formulas keep working
  await page.keyboard.press('Alt+ArrowDown');
  check('⌥↓ adds a row', (await page.locator('.zt tbody tr').count()) === 5);
  await page.keyboard.type('=B4*0.1');
  await page.keyboard.press('Enter');
  check('formulas can reference other formulas', (await cell(4, 1).textContent()) === '8 400');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('=1/0');
  await page.keyboard.press('Enter');
  check('errors show like a spreadsheet', (await cell(4, 1).textContent()) === '#DIV/0!');
  await page.screenshot({ path: `${OUT}/40-table-editing.png` });
  await page.keyboard.press('Escape');
  check('Esc leaves table editing', (await page.locator('.table-box.editing').count()) === 0);
  await page.keyboard.press('Control+z');
  check('undo reverts the whole table editing session at once', (await cellLoc(1, 0).textContent()) === '' && (await page.locator('.table-card').count()) === 1);

  // --- a document: write, close, export to Markdown
  await page.keyboard.press('Control+Shift+z');
  await dragTool(page, 'Документ', { x: 420, y: 700 });
  await page.waitForSelector('.doc-overlay');
  await page.fill('#doc-title', 'Синопсис');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Герой идёт против ветра к морю. ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Одним планом.');
  await page.keyboard.press('Control+b');
  await page.screenshot({ path: `${OUT}/41-document-editor.png` });
  await page.click('.doc-overlay >> text=Экспорт');
  const download = page.waitForEvent('download');
  await page.click('.doc-overlay .menu-item:has-text("Markdown")');
  const md = readFileSync(await (await download).path(), 'utf8');
  check('a document exports to Markdown with its formatting', md.startsWith('# Синопсис') && md.includes('**Одним планом.**'), JSON.stringify(md.slice(0, 80)));
  await page.keyboard.press('Escape');
  const meta = await page.locator('.tile', { hasText: 'Синопсис' }).locator('.tile-meta').textContent().catch(() => null);
  check('the document shows on the board with its word count', meta === '8 слов', String(meta));

  // a note converted to a document keeps its text
  await page.locator('.layer .note', { hasText: 'Добро пожаловать' }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Преобразовать в документ');
  check('a note can be converted into a document', await page.isVisible('.tile:has-text("Добро пожаловать в Zadum")'));
  await page.locator('.tile', { hasText: 'Добро пожаловать в Zadum' }).dblclick();
  check('the converted document opens with the note text', await page.isVisible('.doc-overlay >> text=главная доска'));
  await page.keyboard.press('Escape');

  await page.mouse.click(1300, 820);
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/42-board-light.png` });
});

process.exit(failed ? 1 : 0);
