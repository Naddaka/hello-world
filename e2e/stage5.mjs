// Properties bar over the selection; board icons.
import path from 'node:path';
import { OUT, runSuite } from './harness.mjs';

const failed = await runSuite('properties', 4341, async ({ page, check }) => {
  const bar = page.locator('.props-bar');
  const tile = page.locator('.layer .tile', { hasText: 'Мой первый проект' });

  // --- a board: icon and colour
  await tile.click();
  check('selecting a board shows its properties', await bar.isVisible() && (await bar.locator('text=Иконка').count()) === 1);
  await bar.locator('text=Иконка').click();
  await page.waitForSelector('.icon-picker .icon-cell');
  check('the icon set is large', (await page.locator('.icon-picker [role="tab"]').first().textContent()).includes('2029'));
  await page.fill('.icon-search', 'видео');
  await page.waitForSelector('.icon-cell[title="clapperboard"]');
  check('icons can be searched in Russian', (await page.locator('.icon-cell').count()) > 5);
  await page.click('.icon-cell[title="clapperboard"]');
  check('the chosen icon shows on the tile', (await tile.locator('.tile-icon svg').innerHTML()).includes('path'));
  await page.screenshot({ path: `${OUT}/90-board-icon.png` });
  await bar.locator('text=Иконка').click();
  await page.click('.icon-picker [role="tab"]:has-text("Эмодзи")');
  await page.fill('.icon-search', 'кот');
  await page.waitForSelector('.icon-cell.emoji');
  await page.locator('.icon-cell.emoji').first().click();
  check('an emoji can be the icon', /\p{Extended_Pictographic}/u.test(await tile.locator('.board-emoji').textContent()));
  await bar.locator('[aria-label="Зелёный"]').click();
  check('the board colour changes', (await tile.locator('.tile-icon').getAttribute('style')).includes('--board-green-bg'));
  await page.keyboard.press('Control+z');
  check('one undo per change', (await tile.locator('.tile-icon').getAttribute('style')).includes('--board-orange-bg') || !(await tile.locator('.tile-icon').getAttribute('style')).includes('green'));

  // --- a board: a custom colour, previewed while picked and undone in one step
  const custom = bar.locator('input[type="color"][aria-label="Свой цвет"]');
  check('every palette ends with a custom colour', (await custom.count()) === 1);
  const styleOf = () => tile.locator('.tile-icon').getAttribute('style');
  const before = await styleOf();
  for (const hex of ['#10a0a0', '#20b0b0', '#ff3366']) await custom.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hex);
  check('the colour is previewed while it is picked', (await styleOf()).includes('rgb(255, 51, 102)'));
  await custom.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  check('a custom colour is shown as it is', (await styleOf()).includes('rgb(255, 51, 102)') && (await styleOf()).includes('color-mix'));
  check('the custom colour is remembered in the palette', (await bar.locator('[aria-label="Свой цвет #ff3366"]').count()) === 1);
  await page.keyboard.press('Control+z');
  check('the whole pick is one undo step', (await styleOf()) === before);
  await page.keyboard.press('Control+Shift+z');
  check('and redo brings it back', (await styleOf()).includes('rgb(255, 51, 102)'));

  // --- a board: a picture of one's own as the icon
  await bar.locator('text=Иконка').click();
  await page.click('.icon-picker [role="tab"]:has-text("Своё")');
  await page.setInputFiles('.icon-own input[type="file"]', path.resolve('e2e/fixtures/location.png'));
  await page.waitForSelector('.layer .tile:has-text("Мой первый проект") .tile-icon img.board-image');
  check('a picture can be the board icon', (await tile.locator('.tile-icon img.board-image').count()) === 1);
  check('the picture fills the tile', await tile.locator('.tile-icon img.board-image').evaluate((img) => getComputedStyle(img).objectFit === 'cover' && img.getBoundingClientRect().width > 60 && img.naturalWidth > 0));
  await page.screenshot({ path: `${OUT}/92-board-picture.png` });
  await bar.locator('text=Иконка').click();
  check('the picker opens on the picture tab', (await page.locator('.icon-picker [role="tab"][aria-selected="true"]').textContent()) === 'Своё');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');

  // --- a line: colour, weight, style, arrows
  await page.mouse.click(1200, 820);
  await page.click('.tool:has-text("Линия")');
  const line = page.locator('.layer [data-line-id] .line-path').last();
  await page.locator('.layer [data-line-id] .line-hit').last().click({ force: true });
  check('selecting a line shows line properties', await bar.locator('[aria-label="Тип линии"]').isVisible());
  await bar.locator('[aria-label="Пунктир"]').click();
  check('a line can be dashed', !!(await line.getAttribute('stroke-dasharray')));
  await bar.locator('[aria-label="Точками"]').click();
  check('or dotted', (await line.getAttribute('stroke-dasharray')).startsWith('0.01'));
  await bar.locator('[aria-label="Толстая"]').click();
  check('its weight changes', (await line.getAttribute('stroke-width')) === '3.5');
  await bar.locator('[aria-label="Красная"]').click();
  check('its colour changes', (await line.getAttribute('stroke')) === 'var(--line-red)');
  await bar.locator('input[type="color"]').fill('#00aa55');
  check('a line takes a custom colour', (await line.getAttribute('stroke')) === '#00aa55');
  await page.keyboard.press('Control+z');
  check('and gives it back on undo', (await line.getAttribute('stroke')) === 'var(--line-red)');
  await bar.locator('[aria-label="Стрелка в начале"]').click();
  check('arrows can be added at the start', (await page.locator('.layer [data-line-id]').last().locator('polygon').count()) === 2);
  await page.screenshot({ path: `${OUT}/91-line-properties.png` });

  // --- notes: colour of several at once, one undo step
  await page.mouse.click(1200, 820);
  const welcome = page.locator('.layer .note', { hasText: 'Добро пожаловать' });
  await welcome.click();
  await page.mouse.dblclick(1100, 300);
  await page.keyboard.type('Вторая');
  await page.keyboard.press('Escape');
  await welcome.click();
  await page.locator('.layer .note', { hasText: 'Вторая' }).click({ modifiers: ['Shift'] });
  await bar.locator('[aria-label="Жёлтый"]').click();
  const bg = async (text) => page.locator('.layer .note', { hasText: text }).evaluate((el) => el.style.background);
  check('several notes change colour together', (await bg('Добро пожаловать')).includes('yellow') && (await bg('Вторая')).includes('yellow'));
  await page.keyboard.press('Control+z');
  check('and back in one undo step', !(await bg('Добро пожаловать')).includes('yellow') && !(await bg('Вторая')).includes('yellow'));
  await welcome.click();
  await bar.locator('input[type="color"]').fill('#1a1d24');
  check('a note takes a dark custom colour with light text', await welcome.evaluate((el) => el.style.background.includes('26, 29, 36') && getComputedStyle(el).color === 'rgb(255, 255, 255)'));
  await page.screenshot({ path: `${OUT}/93-note-custom-colour.png` });
  await page.keyboard.press('Control+z');

  await welcome.dblclick();
  check('the bar hides while a note is edited', (await bar.count()) === 0);
  // Highlight colours: presets and a custom one, kept after editing ends.
  await page.locator('.layer .note .ProseMirror strong', { hasText: 'главная доска' }).dblclick();
  await page.click('[aria-label="Цвет выделения"]');
  await page.click('[aria-label="Зелёное выделение"]');
  check('a highlight can be green', (await page.locator('.layer .note mark[data-color="green"]').count()) === 1);
  await page.click('[aria-label="Цвет выделения"]');
  await page.locator('.popover input[type="color"]').fill('#ff8800');
  check('or any colour', (await page.locator('.layer .note mark[data-color="#ff8800"]').count()) === 1 && (await page.locator('.layer .note mark[data-color="green"]').count()) === 0);
  check('the note stays in editing after picking a colour', (await page.locator('.layer .note.editing').count()) === 1);
  await page.screenshot({ path: `${OUT}/95-highlight-colour.png` });
  await page.keyboard.press('Escape');

  // Labels: a palette with a custom colour instead of cycling through colours.
  await welcome.click({ button: 'right' });
  await page.locator('.menu-item', { hasText: /Метк/ }).first().click();
  await page.fill('#label-query', 'Срочно');
  await page.keyboard.press('Enter');
  await page.click('.label-row .label-dot');
  check('a label dot opens its palette', (await page.locator('.label-colors .pb-swatch').count()) >= 9);
  await page.locator('.label-colors input[type="color"]').fill('#c026d3');
  await page.screenshot({ path: `${OUT}/94-label-colour.png` });
  check('a label takes a custom colour', await page.locator('.label-chip', { hasText: 'Срочно' }).first().evaluate((el) => el.style.background.includes('color-mix')));
  await page.mouse.click(1200, 820);

  // An empty Unsorted panel does not stay open on the next board.
  await page.click('.inbox-btn');
  check('the Unsorted panel opens', (await page.locator('.side-panel[aria-label="Неразобранное"]').count()) === 1);
  await page.locator('.layer .tile', { hasText: 'Мой первый проект' }).dblclick();
  await page.waitForSelector('.crumb.current:has-text("Мой первый проект")');
  check('an empty Unsorted panel closes on another board', (await page.locator('.side-panel[aria-label="Неразобранное"]').count()) === 0);
  await page.locator('.crumb', { hasText: 'Главная' }).click();

  // Text typed a moment before the app goes away is not lost.
  await page.mouse.dblclick(1150, 700);
  await page.keyboard.type('Сохранено сразу');
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }) || document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('text typed just before leaving is saved', (await page.locator('.layer .note', { hasText: 'Сохранено сразу' }).count()) === 1);

  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('the highlight colour is kept', (await page.locator('.layer .note mark[data-color="#ff8800"]').count()) === 1);
  check('the custom colour is kept', (await page.locator('.layer .tile', { hasText: 'Мой первый проект' }).locator('.tile-icon').getAttribute('style')).includes('rgb(255, 51, 102)'));
  check('the icon is kept', (await page.locator('.layer .tile', { hasText: 'Мой первый проект' }).locator('.board-emoji').count()) === 1);
});

process.exit(failed ? 1 : 0);
