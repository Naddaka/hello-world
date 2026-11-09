// Properties bar over the selection; board icons.
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

  await welcome.dblclick();
  check('the bar hides while a note is edited', (await bar.count()) === 0);
  await page.keyboard.press('Escape');

  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('the icon is kept', (await page.locator('.layer .tile', { hasText: 'Мой первый проект' }).locator('.board-emoji').count()) === 1);
});

process.exit(failed ? 1 : 0);
