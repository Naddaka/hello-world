// Stage 4b: script breakdown, storyboard from a script, frames and shot list.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 4b', 4339, async ({ page, check }) => {
  await dragTool(page, 'Сценарий', { x: 900, y: 600 });
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.setInputFiles('.sp-head input[type="file"]', path.resolve('e2e/fixtures/sample.fountain'));
  await page.waitForSelector('.sl:has-text("Лампа маяка")');

  // --- breakdown: add from the side panel, and from a selection in the text
  await page.click('.sp-tabs >> text=Разбор');
  await page.selectOption('.sp-bd-add select', 'props');
  await page.fill('.sp-bd-add input', 'лампа');
  await page.keyboard.press('Enter');
  check('a breakdown item is highlighted in the text', (await page.locator('.sp-paper .bd-props').count()) === 1 && (await page.locator('.sp-paper .bd-props').textContent()) === 'Лампа');
  check('the panel counts the scenes an item is in', await page.isVisible('.sp-bd-cat:has-text("Реквизит") >> text=1 сц.'));
  await page.locator('.sl', { hasText: 'Маша идёт по мокрым доскам' }).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForSelector('.sp-bd-quick');
  await page.selectOption('.sp-bd-quick select', 'set');
  await page.click('.sp-bd-quick >> text=В разбор');
  await page.locator('.sl', { hasText: 'Маша идёт по мокрым доскам' }).click();
  // ProseMirror reads a click's selection on the next selectionchange event; a person never types that fast.
  await page.waitForTimeout(50);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Под ногами — мокрые доски.');
  check('typing after a click keeps the text', (await page.locator('.sl', { hasText: 'Маша идёт по мокрым доскам.' }).count()) === 1);
  check('a selection can be added to the breakdown', (await page.locator('.sp-bd-cat:has-text("Декорация") .sp-bd-name').inputValue()) === 'Маша');
  // The selected word form can be renamed.
  await page.fill('.sp-bd-cat:has-text("Декорация") .sp-bd-name', 'Маш');
  await page.keyboard.press('Enter');
  check('a breakdown item can be renamed', (await page.locator('.sp-bd-cat:has-text("Декорация") .sp-bd-name').inputValue()) === 'Маш');
  await page.click('.sp-bd-cat:has-text("Декорация") button[aria-label^="Убрать"]');
  check('an item can be removed again', (await page.locator('.sp-bd-cat:has-text("Декорация")').count()) === 0);
  await page.fill('.sp-bd-add input', 'мокрые доски');
  await page.selectOption('.sp-bd-add select', 'set');
  await page.keyboard.press('Enter');
  check('items are found in any word form', (await page.locator('.sp-paper .bd-set').count()) === 2, String(await page.locator('.sp-paper .bd-set').count()));
  await page.screenshot({ path: `${OUT}/82-breakdown.png` });

  // --- breakdown table on the board
  await page.click('.sp-head >> text=На доску');
  await page.click('.menu-item >> text=Разбор по сценам');
  await page.waitForSelector('.layer .table-card');
  const header = await page.locator('.layer .zt thead, .layer .zt tbody tr').first().textContent();
  check('the breakdown table has a column per category', header.includes('Реквизит') && header.includes('Декорация') && header.includes('Персонажи'), header);
  check('scenes are rows of the breakdown table', (await page.locator('.layer .zt tbody tr').count()) >= 2);

  // --- storyboard from the script
  await page.locator('.tile', { hasText: 'Северный ветер' }).first().dblclick();
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.click('.sp-head >> text=На доску');
  await page.click('.menu-item >> text=Раскадровка');
  await page.waitForSelector('.tile:has-text("Раскадровка · Северный ветер")');
  await page.locator('.tile', { hasText: 'Раскадровка · Северный ветер' }).dblclick();
  await page.waitForSelector('.crumb.current:has-text("Раскадровка")');
  await page.keyboard.press('z');
  check('the storyboard has a row of frames for each scene', (await page.locator('.layer .frame-card').count()) === 6 && (await page.locator('.layer .note', { hasText: '1. ИНТ. МАЯК — НОЧЬ' }).count()) === 1);
  check('frames are numbered by scene and shot', (await page.locator('.frame-no').allTextContents()).join(' ') === '1.1 1.2 1.3 2.1 2.2 2.3');

  // shot settings
  const first = page.locator('.layer .el', { has: page.locator('.frame-no', { hasText: '1.1' }) });
  await first.click({ button: 'right' });
  await page.click('.ctxmenu >> text=Параметры кадра…');
  await page.fill('.sp-field:has-text("Крупность") input', 'Крупный');
  await page.fill('.sp-field:has-text("Движение камеры") input', 'Наезд');
  await page.fill('.sp-field:has-text("Длительность") input', '4');
  await page.fill('.sp-field:has-text("Описание") textarea', 'Лампа маяка');
  const modal = await page.locator('.modal').boundingBox();
  const duration = await page.locator('.sp-field:has-text("Длительность") input').boundingBox();
  check('the shot dialog fields fit inside it', duration.x + duration.width <= modal.x + modal.width - 10, `${duration.x + duration.width} vs ${modal.x + modal.width}`);
  await page.click('.modal >> text=Сохранить');
  check('shot settings show on the frame', (await first.locator('.frame-facts').textContent()) === 'CU · Наезд' && (await first.locator('.frame-dur').textContent()) === '4 с');

  // add a frame after the last one of scene 1
  await page.locator('.layer .el', { has: page.locator('.frame-no', { hasText: '1.3' }) }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Добавить кадр после');
  check('a new frame continues the numbering', (await page.locator('.frame-no', { hasText: '1.4' }).count()) === 1);

  // a picture under the drawing
  await first.click({ button: 'right' });
  const chooser = page.waitForEvent('filechooser');
  await page.click('.ctxmenu >> text=Изображение под рисунком…');
  await (await chooser).setFiles(path.resolve('e2e/fixtures/location.png'));
  await page.waitForFunction(() => [...document.querySelectorAll('.frame-card .sketch-surface')].some((el) => el.style.backgroundImage.includes('blob:')));
  check('a frame can have a picture under the drawing', true);

  // shot list
  await first.click({ button: 'right' });
  await page.click('.ctxmenu >> text=Shot list по кадрам доски');
  await page.waitForSelector('.layer .table-card');
  const rows = await page.locator('.layer .zt tbody tr').allTextContents();
  check('the shot list has a row per frame and a total', rows.length === 9 && rows[0].includes('Сцена') && rows.at(-1).includes('Итого') && rows.at(-1).includes('4'), `${rows.length} rows, last: ${rows.at(-1)}`);
  await page.keyboard.press('z');
  await page.screenshot({ path: `${OUT}/83-storyboard.png` });

  await page.locator('.layer .table-card').click({ button: 'right' });
  const download = page.waitForEvent('download');
  await page.click('.ctxmenu >> text=Экспорт в CSV');
  const csv = readFileSync(await (await download).path(), 'utf8');
  check('a table exports to CSV', csv.startsWith('﻿Сцена;Кадр;Крупность') && csv.includes('1;1;Крупный;;Наезд;;4;Лампа маяка'), JSON.stringify(csv.slice(0, 120)));

  await page.keyboard.press('Control+z');
  check('the shot list can be undone', (await page.locator('.layer .table-card').count()) === 0);
});

process.exit(failed ? 1 : 0);
