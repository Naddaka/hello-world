// Stage 2c: templates, board shortcuts, synced notes, comments, board export.
import { readFileSync } from 'node:fs';
import { centre, drag, dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 2c', 4336, async ({ page, check }) => {
  const notes = (t) => page.locator('.layer .note', { hasText: t });

  // --- template picker on a new empty board
  await dragTool(page, 'Доска', { x: 900, y: 600 });
  await page.waitForSelector('.tile-input');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Новый ролик');
  await page.keyboard.press('Enter');
  await page.locator('.tile', { hasText: 'Новый ролик' }).dblclick();
  await page.waitForSelector('.template-picker');
  check('an empty board offers templates', await page.isVisible('.template-item:has-text("Проект ролика")'));
  await page.click('.template-item:has-text("Проект ролика")');
  check('a built-in template fills the board', (await page.locator('.layer .column').count()) === 1 && (await page.locator('.layer .tasklist').count()) === 1 && (await page.locator('.layer .table-card').count()) === 1);
  check('the template table computes its total', (await page.locator('.zt tbody tr').last().textContent())?.includes('₽'));
  check('the picker hides once the board has content', (await page.locator('.template-picker').count()) === 0);
  await page.screenshot({ path: `${OUT}/60-template.png` });
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // own template: mark a board as template, use it on another empty board
  await page.locator('.tile', { hasText: 'Новый ролик' }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Сделать шаблоном');
  check('a board can become a template', await page.isVisible('.tile:has-text("Новый ролик") .tile-meta:has-text("Шаблон")'));
  await dragTool(page, 'Доска', { x: 1150, y: 600 });
  await page.waitForSelector('.tile-input');
  await page.keyboard.press('Enter');
  await page.locator('.tile', { hasText: 'Новая доска' }).dblclick();
  await page.click('.template-picker >> text=Ещё шаблоны');
  await page.click('.template-item:has-text("Новый ролик")');
  check('your own template can be used on another board', (await page.locator('.layer .table-card').count()) === 1);
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // --- long board titles are shortened at a word with an ellipsis; the full title shows on hover
  await dragTool(page, 'Доска', { x: 1300, y: 300 });
  await page.waitForSelector('.tile-input');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Глава первая (От первых замыслов до готового сценария)');
  await page.keyboard.press('Enter');
  const long = page.locator('.tile', { hasText: 'Глава первая' }).locator('.tile-title:not(.tile-measure)');
  const shown = await long.locator('[aria-hidden="true"]').textContent();
  check('a long title is cut at a word with "…"', shown.endsWith('…') && /\p{L}…$/u.test(shown) && 'Глава первая (От первых замыслов до готового сценария)'.startsWith(shown.slice(0, -1).trimEnd()), shown);
  check('the full title shows on hover', (await long.getAttribute('title')) === 'Глава первая (От первых замыслов до готового сценария)');
  const lines = await long.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  check('a tile title takes at most two lines', lines <= 2, String(lines));

  // --- board shortcut
  await page.locator('.tile', { hasText: 'Мой первый проект' }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Создать ярлык на доску');
  check('a shortcut tile appears with the badge', (await page.locator('.tile:has-text("Мой первый проект") .shortcut-badge').count()) === 1);
  await page.locator('.tile', { has: page.locator('.shortcut-badge') }).dblclick();
  check('opening a shortcut opens the original board', await page.isVisible('.crumb.current:has-text("Мой первый проект")'));
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // --- synced note
  await notes('Добро пожаловать').click({ button: 'right' });
  await page.click('.ctxmenu >> text=Создать синхронную копию');
  check('a synced copy shows its status', (await page.locator('.sync-footer').count()) === 2);
  const copy = notes('Добро пожаловать').nth(1);
  await copy.dblclick();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Синхронно!');
  await page.keyboard.press('Escape');
  check('editing one synced copy changes the other', (await notes('Синхронно!').count()) === 2);

  // --- comment pinned to a card
  await dragTool(page, 'Коммент', { x: 1100, y: 300 });
  await page.waitForSelector('.comment-form textarea');
  await page.keyboard.type('Пересветить небо в грейдинге');
  await page.keyboard.press('Enter');
  check('a comment can be posted', await page.isVisible('.comment-text:has-text("Пересветить небо")'));
  await page.locator('.comment-card .reaction').first().click();
  check('a reaction can be added', (await page.locator('.reaction.on').count()) === 1);
  await page.keyboard.press('Escape');
  const head = await centre(page.locator('.layer .comment-card'));
  await drag(page, head, await centre(page.locator('.layer .tile', { hasText: 'Мой первый проект' }).first().locator('.tile-icon')));
  check('dropping a comment on a board tile moves it into that board', (await page.locator('.layer .comment-card').count()) === 0);
  await page.keyboard.press('Control+z');
  const head2 = await centre(page.locator('.layer .comment-card'));
  await drag(page, head2, await centre(notes('Добро пожаловать').first()));
  check('dropping a comment on a card pins it as a marker', (await page.locator('.layer .comment-card').count()) === 0 && (await page.locator('.comment-marker').count()) === 1);
  await page.click('.comment-marker');
  check('the marker opens the thread', await page.isVisible('.comment-pop >> text=Пересветить небо'));
  await page.mouse.click(1300, 820);

  // --- board export
  await page.click('.topbar >> text=Экспорт');
  let download = page.waitForEvent('download');
  await page.click('.menu-item:has-text("Markdown")');
  const md = readFileSync(await (await download).path(), 'utf8');
  check('the board exports to Markdown in reading order', md.startsWith('# Главная') && md.includes('Добро пожаловать') && md.includes('Доска «Мой первый проект»'), JSON.stringify(md.slice(0, 120)));
  await page.click('.topbar >> text=Экспорт');
  download = page.waitForEvent('download');
  await page.click('.menu-item:has-text("PNG")');
  const png = readFileSync(await (await download).path());
  check('the board exports to a PNG image', png.subarray(1, 4).toString() === 'PNG' && png.length > 20000, `${png.length} bytes`);
  await page.click('.topbar >> text=Экспорт');
  await page.click('.menu-item:has-text("ZIP")');
  const told = await page.waitForSelector('.toast:has-text("нет файлов")', { timeout: 5000 }).then(() => true, () => false);
  check('ZIP export explains when there are no files', told, await page.locator('.toast').textContent().catch(() => 'no toast'));
});

process.exit(failed ? 1 : 0);
