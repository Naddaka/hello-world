// Stage 1a: columns, task lists, Unsorted, trash, search, copy and paste.
import { centre, drag, dragTool, OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 1a', 4331, async ({ page, check }) => {
  const notes = (text) => page.locator('.note', { hasText: text });

  // --- a column from the toolbar, renamed
  await dragTool(page, 'Колонка', { x: 900, y: 140 });
  await page.waitForSelector('.col-title-input');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Референсы');
  await page.keyboard.press('Enter');
  check('column created from the toolbar and named', await page.isVisible('.col-title:has-text("Референсы")'));

  // --- two notes dropped into the column, in order
  for (const [text, y] of [['Синий час', 560], ['Силуэт героя', 700]]) {
    await page.mouse.dblclick(420, y);
    await page.keyboard.type(text);
    await page.keyboard.press('Escape');
  }
  const column = page.locator('.column', { hasText: 'Референсы' });
  await drag(page, await centre(notes('Синий час')), await centre(column.locator('.col-body')));
  const colBody = await column.locator('.col-body').boundingBox();
  await drag(page, await centre(notes('Силуэт героя')), { x: colBody.x + colBody.width / 2, y: colBody.y + 4 });
  const order = await column.locator('.note .rt').allTextContents();
  check('notes dropped into a column land where the indicator shows', order.join('|') === 'Силуэт героя|Синий час', order.join('|'));
  check('column counts its cards', await column.locator('.col-count:has-text("2 карточки")').isVisible());

  // --- drag a note back out of the column onto the canvas
  await drag(page, await centre(column.locator('.note', { hasText: 'Синий час' })), { x: 520, y: 620 });
  check('a note dragged out of a column goes back on the canvas', (await column.locator('.note').count()) === 1 && (await page.locator('.layer > .el .note', { hasText: 'Синий час' }).count()) === 1);
  await page.keyboard.press('Control+z');
  check('undo puts it back in the column', (await column.locator('.note').count()) === 2);

  // --- collapse
  await column.locator('.col-toggle').click();
  check('column collapses', (await column.locator('.col-body').count()) === 0);
  await column.locator('.col-toggle').click();

  // --- task list
  await dragTool(page, 'Задачи', { x: 520, y: 560 });
  await page.waitForSelector('.task-input');
  await page.keyboard.type('Найти пирс');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Разрешение на съёмку');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Письмо в порт');
  await page.keyboard.press('Tab');
  await page.screenshot({ path: `${OUT}/10-tasks-editing.png` });
  await page.keyboard.press('Escape');
  const tasks = page.locator('.tasklist');
  check('task list keeps typed tasks', (await tasks.locator('.task').count()) === 3);
  check('Tab makes a sub-task', (await tasks.locator('.task').nth(2).getAttribute('style'))?.includes('padding-left: 24px'));
  await tasks.locator('.task input[type="checkbox"]').first().click();
  check('ticking a task updates progress', await tasks.locator('.tasks-count:has-text("1 из 3")').isVisible());
  await tasks.locator('.task-del').first().click();
  check('a completed task can be deleted', (await tasks.locator('.task').count()) === 2);

  // --- Unsorted: drop a board onto the tile, find the card in that board's panel
  await page.mouse.dblclick(1150, 760);
  await page.keyboard.type('Идея на потом');
  await page.keyboard.press('Escape');
  await drag(page, await centre(notes('Идея на потом')), await centre(page.locator('.tile-icon').first()));
  await page.locator('.tile').first().dblclick();
  await page.waitForSelector('.crumb.current:has-text("Мой первый проект")');
  check('Unsorted button shows the count of waiting cards', await page.isVisible('.inbox-btn .badge:has-text("1")'));
  await page.click('.inbox-btn');
  check('the card dropped on the board waits in its Unsorted panel', await page.isVisible('.side-panel >> text=Идея на потом'));
  await drag(page, await centre(page.locator('.side-panel .note', { hasText: 'Идея на потом' })), { x: 600, y: 500 });
  check('dragging out of Unsorted places it on the canvas', (await page.locator('.layer .note', { hasText: 'Идея на потом' }).count()) === 1);
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // --- trash: drag onto the trash button, restore, empty
  await drag(page, await centre(tasks), await centre(page.locator('[data-drop-trash]')));
  check('dragging onto Корзина deletes', (await page.locator('.layer .tasklist').count()) === 0);
  await page.click('[data-drop-trash]');
  check('the trash lists what was deleted', await page.isVisible('.side-panel >> text=Разрешение на съёмку'));
  await page.click('.side-panel button:has-text("Восстановить")');
  check('restore puts it back on the board', (await page.locator('.layer .tasklist').count()) === 1);
  await page.mouse.click(1300, 820);
  await page.locator('.layer .tasklist').click();
  await page.keyboard.press('Delete');
  await page.click('.danger-btn');
  check('emptying the trash asks first', await page.isVisible('.confirm-dialog >> text=Очистить корзину?'));
  await page.click('.confirm-dialog >> text=Удалить навсегда');
  check('emptying the trash removes items for good', await page.isVisible('.side-panel >> text=Корзина пуста'));
  await page.keyboard.press('Escape');

  // --- search across boards
  await page.keyboard.press('Control+f');
  await page.keyboard.type('потом');
  check('search finds a card on another board', await page.isVisible('.search-item >> text=Мой первый проект'));
  await page.screenshot({ path: `${OUT}/11-search.png` });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.crumb.current:has-text("Мой первый проект")');
  check('choosing a result opens its board and selects the card', await page.isVisible('.note.selected:has-text("Идея на потом")'));
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // --- copy and paste
  await notes('Добро пожаловать').click();
  await page.keyboard.press('Control+c');
  await page.mouse.move(700, 700);
  await page.keyboard.press('Control+v');
  check('⌘C / ⌘V copies a note', (await notes('Добро пожаловать').count()) === 2);
  await page.locator('.tile', { hasText: 'Мой первый проект' }).click();
  await page.keyboard.press('Control+c');
  await page.mouse.move(1100, 300);
  await page.keyboard.press('Control+v');
  check('a pasted board brings its content', (await page.locator('.tile:has-text("Мой первый проект") .tile-meta:has-text("2 карточки")').count()) === 2);

  // --- group into column via the context menu
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.locator('.layer > .el .note').first().click({ button: 'right', modifiers: [] });
  await page.click('.ctxmenu >> text=Сгруппировать в колонку');
  check('selected cards can be grouped into a column', (await page.locator('.column').count()) >= 2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');

  await page.keyboard.press('z');
  await page.mouse.click(1300, 820);
  await page.screenshot({ path: `${OUT}/12-board-light.png` });
  await page.keyboard.press('Control+Shift+d');
  await page.screenshot({ path: `${OUT}/13-board-dark.png` });
});

process.exit(failed ? 1 : 0);
