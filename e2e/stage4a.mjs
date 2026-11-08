// Stage 4a: the screenplay editor.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 4a', 4338, async ({ page, check }) => {
  const kinds = () => page.locator('.sp-rt .sl').evaluateAll((els) => els.map((e) => `${e.dataset.kind}:${e.textContent}`));

  await dragTool(page, 'Сценарий', { x: 900, y: 600 });
  await page.waitForSelector('.sp-overlay .sp-rt');
  check('the script tool opens the screenplay editor', await page.isVisible('.sp-paper'));

  // Type a short scene the way a screenwriter would.
  await page.keyboard.type('инт. кухня — день');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Маша варит кофе. За окном дождь.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('маша');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Доброе утро.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Пе');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('петя');
  await page.keyboard.press('Enter');
  await page.keyboard.type('(');
  await page.keyboard.type('сонно');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Кофе есть?');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('ма');
  check('character names are suggested', await page.isVisible('.sp-suggest >> text=МАША'));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Есть.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('инт. ку');
  check('locations are suggested in scene headings', await page.isVisible('.sp-suggest >> text=КУХНЯ'));
  await page.keyboard.press('Tab');
  await page.keyboard.type('н');
  check('times of day are suggested after the dash', await page.isVisible('.sp-suggest >> text=НОЧЬ'));
  await page.keyboard.press('Enter');
  const list = await kinds();
  check(
    'Enter, Tab and "(" produce the standard paragraph sequence',
    JSON.stringify(list.slice(0, 9)) ===
      JSON.stringify(['scene:инт. кухня — день', 'action:Маша варит кофе. За окном дождь.', 'character:маша', 'dialogue:Доброе утро.', 'character:петя', 'parenthetical:сонно', 'dialogue:Кофе есть?', 'character:МАША', 'dialogue:Есть.']),
    JSON.stringify(list),
  );
  check('a heading picked from suggestions is complete', list.at(-1).toUpperCase() === 'SCENE:ИНТ. КУХНЯ — НОЧЬ', JSON.stringify(list.at(-1)));
  check('headings and names are shown in capitals', (await page.locator('.sl[data-kind="scene"]').first().evaluate((el) => getComputedStyle(el).textTransform)) === 'uppercase');
  check('the navigator lists scenes with their length', (await page.locator('.sp-scenes li').count()) === 2 && (await page.locator('.sp-scenes li').first().textContent()).includes('1/8'));
  await page.click('.sp-tabs >> text=Персонажи');
  check('the cast list counts speeches', await page.isVisible('.sp-chars td:has-text("МАША")'));
  check('page count and timing are shown', await page.isVisible('.sp-head >> text=1 страница · ≈1 мин · 2 сц.'));
  await page.screenshot({ path: `${OUT}/80-script-editor.png` });

  // Format switch changes the page.
  const w1 = await page.locator('.sp-paper').evaluate((el) => el.getBoundingClientRect().width);
  await page.selectOption('.sp-select', 'hollywood');
  const w2 = await page.locator('.sp-paper').evaluate((el) => el.getBoundingClientRect().width);
  check('switching to US Letter changes the page width', Math.round(w2) === 816 && Math.round(w1) !== 816, `${w1} → ${w2}`);

  // Title page and Fountain export.
  await page.click('.sp-head >> text=Титульный лист');
  await page.fill('.sp-field:has-text("Авторы") input', 'Роман');
  await page.click('.modal >> text=Сохранить');
  await page.click('.sp-head >> text=Экспорт');
  const download = page.waitForEvent('download');
  await page.click('.menu-item:has-text("Fountain")');
  const fountain = readFileSync(await (await download).path(), 'utf8');
  check('Fountain export has the title page and the scene', fountain.includes('Author: Роман') && fountain.includes('ИНТ. КУХНЯ — ДЕНЬ') && fountain.includes('@МАША'), JSON.stringify(fountain.slice(0, 160)));

  // Open a Fountain file into a new script.
  await page.click('.sp-head >> text=← К доске');
  check('the tile shows the script on the board', await page.isVisible('.tile:has-text("Новый сценарий") .tile-meta:has-text("1 страница · 2 сц.")'));
  await dragTool(page, 'Сценарий', { x: 1100, y: 600 });
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.setInputFiles('.sp-head input[type="file"]', path.resolve('e2e/fixtures/sample.fountain'));
  await page.waitForSelector('.sl:has-text("Лампа маяка")');
  const imported = await kinds();
  check('a Fountain file opens with its structure', imported[0] === 'scene:ИНТ. МАЯК — НОЧЬ' && imported.includes('parenthetical:шёпотом') && imported.at(-1) === 'transition:СМЕНА ПЛАНА:', JSON.stringify(imported));
  check('the title comes from the title page', (await page.inputValue('#sp-title')) === 'Северный ветер');

  // Scenes to the board.
  await page.click('.sp-head >> text=Сцены на доску');
  await page.waitForSelector('.layer .column:has-text("Сцены · Северный ветер")');
  const cards = page.locator('.layer .column', { hasText: 'Сцены · Северный ветер' }).locator('.note');
  check('scenes are laid out as cards in a column', (await cards.count()) === 2 && (await cards.first().textContent()).includes('1. ИНТ. МАЯК — НОЧЬ'));
  await page.screenshot({ path: `${OUT}/81-scenes-on-board.png` });

  // Undo removes the scene cards; the script is kept after a reload.
  await page.keyboard.press('Control+z');
  check('placing scenes on the board can be undone', (await page.locator('.layer .column:has-text("Сцены · Северный ветер")').count()) === 0);
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  await page.locator('.tile', { hasText: 'Северный ветер' }).dblclick();
  await page.waitForSelector('.sp-overlay .sp-rt');
  check('the script survives a reload', await page.isVisible('.sl:has-text("Это просто ветер.")'));
  await page.keyboard.press('Escape');
  check('Escape closes the editor', (await page.locator('.sp-overlay').count()) === 0);
});

process.exit(failed ? 1 : 0);
