// Stage 1c: lines between cards, labels, colour swatches.
import { centre, drag, dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 1c', 4333, async ({ page, check }) => {
  const welcome = page.locator('.layer > .el', { hasText: 'Добро пожаловать' });
  const tile = page.locator('.layer > .el', { hasText: 'Мой первый проект' });

  // --- a line from a card's handle to a board
  await welcome.click();
  const handle = await centre(welcome.locator('.line-from'));
  await drag(page, handle, await centre(tile.locator('.tile-icon')));
  check('dragging the card handle onto another card creates a line', (await page.locator('.line-path').count()) === 1);
  const d1 = await page.locator('.line-path').getAttribute('d');

  // the line follows when the card moves
  await page.mouse.click(1200, 800);
  const wb = await welcome.boundingBox();
  await drag(page, { x: wb.x + 60, y: wb.y + 30 }, { x: wb.x + 60, y: wb.y + 330 });
  const d2 = await page.locator('.line-path').getAttribute('d');
  check('an attached line follows its card', d1 !== d2);

  // bend, label, colour
  const hit = page.locator('.line-hit');
  const box = await page.locator('.line-path').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  check('clicking a line selects it', (await page.locator('.line.selected').count()) === 1);
  const mid = await centre(page.locator('.line-handle.mid'));
  await drag(page, mid, { x: mid.x + 60, y: mid.y - 60 });
  check('dragging the middle handle bends the line', (await page.locator('.line-path').getAttribute('d')) !== d2);
  // A point that is really on the (curved) stroke, at a third of its length.
  const onCurve = await hit.evaluate((path) => {
    const p = path.getPointAtLength(path.getTotalLength() / 3);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  });
  await page.mouse.dblclick(onCurve.x, onCurve.y);
  await page.keyboard.type('до съёмки');
  await page.keyboard.press('Enter');
  check('a line can carry a label', await page.isVisible('.line-label:has-text("до съёмки")'));
  await page.locator('.line-label').click({ button: 'right' });
  await page.click('.ctxmenu >> text=Синяя');
  check('line colour can be changed', (await page.locator('.line-path').getAttribute('stroke')) === 'var(--line-blue)');

  // a free line from the toolbar, deleted with Delete
  await dragTool(page, 'Линия', { x: 1000, y: 700 });
  check('the Line tool draws a free line', (await page.locator('.line-path').count()) === 2);
  await page.keyboard.press('Delete');
  check('Delete removes a selected line', (await page.locator('.line-path').count()) === 1);

  // --- labels
  await page.mouse.click(1200, 800);
  await welcome.click({ button: 'right' });
  await page.click('.ctxmenu >> text=Метки…');
  await page.keyboard.type('свет');
  await page.keyboard.press('Enter');
  await page.mouse.click(1250, 820);
  check('a new label is created and shown on the card', await page.isVisible('.layer .label-chip:has-text("свет")'));
  await tile.click({ button: 'right' });
  await page.click('.ctxmenu >> text=Метки…');
  await page.locator('.label-row', { hasText: 'свет' }).locator('input[type="checkbox"]').check();
  check('an existing label can be added to another card', (await page.locator('.layer .label-chip:has-text("свет")').count()) === 2);
  check('the picker shows how often a label is used', await page.isVisible('.label-row:has-text("свет") .label-usage:has-text("2")'));
  await page.locator('.label-row .label-name', { hasText: 'свет' }).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('свет и тень');
  await page.keyboard.press('Enter');
  await page.mouse.click(1250, 820);
  check('renaming a label changes it everywhere', (await page.locator('.layer .label-chip:has-text("свет и тень")').count()) === 2);
  await page.keyboard.press('Control+f');
  await page.keyboard.type('тень');
  check('search finds cards by label', (await page.locator('.search-item').count()) === 2);
  await page.keyboard.press('Escape');

  // --- colour swatch
  await dragTool(page, 'Цвет', { x: 1150, y: 300 });
  await page.waitForSelector('.swatch-card');
  check('the Color tool adds a named swatch', ((await page.locator('.swatch-name').textContent()) ?? '').length > 0);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '#E2725B');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check('pasting a HEX value recolours the selected swatch', (await page.locator('.swatch-value').textContent()) === '#E2725B' && (await page.locator('.swatch-name').textContent()) === 'Терракота');
  await page.locator('.swatch-card').click({ button: 'right' });
  await page.click('.ctxmenu >> text=Показывать: RGB');
  check('a swatch can show RGB', (await page.locator('.swatch-value').textContent()) === 'rgb(226, 114, 91)');

  await page.keyboard.press('Control+z');
  await page.mouse.click(1250, 820);
  await page.screenshot({ path: `${OUT}/30-lines-labels-light.png` });
  await page.keyboard.press('Control+Shift+d');
  await page.screenshot({ path: `${OUT}/31-lines-labels-dark.png` });

  // deleting a label removes it from cards
  await page.keyboard.press('Control+Shift+d');
  await welcome.click({ button: 'right' });
  await page.click('.ctxmenu >> text=Метки…');
  page.once('dialog', (dlg) => dlg.accept());
  await page.locator('.label-row', { hasText: 'свет и тень' }).locator('.task-del').click();
  await page.mouse.click(1250, 820);
  check('deleting a label removes it from every card', (await page.locator('.label-chip').count()) === 0);
});

process.exit(failed ? 1 : 0);
