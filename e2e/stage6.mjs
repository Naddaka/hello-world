// Storyboard frames take dropped pictures; compact comments; label tags on notes; Ctrl+Backspace.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { centre, drag, dragTool, OUT, runSuite } from './harness.mjs';

const PICTURE = readFileSync(path.resolve('e2e/fixtures/location.png')).toString('base64');

/** Drops a picture file at a screen point, as a browser drop from Finder does. */
async function dropPicture(page, x, y, name = 'кадр.png') {
  const dt = await page.evaluateHandle(
    async ({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type: 'image/png' }));
      return data;
    },
    { b64: PICTURE, name },
  );
  const target = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x, y });
  for (const type of ['dragenter', 'dragover', 'drop']) await target.dispatchEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true });
}

const failed = await runSuite('improvements', 4342, async ({ page, check }) => {
  const notes = (t) => page.locator('.layer .note', { hasText: t });

  // --- a storyboard frame takes a dropped picture
  await dragTool(page, 'Скетч', { x: 900, y: 600 });
  await page.waitForSelector('.sketch-overlay');
  await page.click('.draw-bar >> text=Сохранить');
  const frame = page.locator('.layer .sketch-card').first();
  check('an empty frame says pictures can be dropped on it', (await frame.textContent()).includes('перетащите сюда картинку'));
  const c = await centre(frame);
  await dropPicture(page, c.x, c.y);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.layer .sketch-surface')).backgroundImage.startsWith('url('));
  check('a picture dropped on a frame becomes its image', (await page.locator('.layer .media-card img').count()) === 0);
  await page.keyboard.press('Control+z');
  check('which is one undo step', (await frame.locator('.sketch-surface').evaluate((el) => el.style.backgroundImage)) === '');
  // Dropped next to the frame it is an ordinary image card.
  await dropPicture(page, 700, 760);
  await page.waitForSelector('.layer .media-card img');
  check('a picture dropped elsewhere is a card', (await page.locator('.layer .media-card img').count()) === 1);
  // An image card dragged onto the frame moves into it.
  await drag(page, await centre(page.locator('.layer .media-card img').first()), await centre(frame));
  check('an image card dropped on a frame goes into it', (await page.locator('.layer .media-card img').count()) === 0 && (await frame.locator('.sketch-surface').evaluate((el) => el.style.backgroundImage)).startsWith('url('));
  await page.screenshot({ path: `${OUT}/96-frame-picture.png` });
  await page.keyboard.press('Control+z');
  check('and comes back out in one undo step', (await page.locator('.layer .media-card img').count()) === 1 && (await frame.locator('.sketch-surface').evaluate((el) => el.style.backgroundImage)) === '');

  // --- comments: compact until double-clicked
  await page.mouse.click(1300, 820);
  await dragTool(page, 'Коммент', { x: 1150, y: 300 });
  await page.waitForSelector('.comment-form textarea');
  await page.keyboard.type('Пересветить небо');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.mouse.click(1300, 820);
  const comment = page.locator('.layer .comment-card').first();
  check('a written comment is compact', (await comment.locator('.comment-text', { hasText: 'Пересветить небо' }).count()) === 1 && (await comment.locator('.reaction, textarea, .comment-head').count()) === 0);
  check('it still shows who and when', (await comment.locator('.comment-meta b').textContent()) === 'Вы' && /\d/.test(await comment.locator('.comment-meta').textContent()));
  await page.screenshot({ path: `${OUT}/97-compact-comment.png` });
  await comment.dblclick();
  check('a double-click opens replies and reactions', (await comment.locator('textarea').count()) === 1 && (await comment.locator('.reaction').count()) > 0);
  await page.keyboard.press('Escape');
  check('Esc folds it back', (await comment.locator('textarea').count()) === 0);

  // --- label tags on notes
  const welcome = notes('Добро пожаловать');
  await welcome.click();
  await page.locator('.props-bar [aria-label="Метки"]').click();
  await page.fill('#label-query', 'Срочно');
  await page.keyboard.press('Enter');
  await page.mouse.click(1300, 820);
  const tag = welcome.locator('.label-chips.on-card .label-chip', { hasText: 'Срочно' });
  check('the properties bar adds labels to a note', (await tag.count()) === 1);
  check('the label sits inside the note, at the top', await welcome.evaluate((note) => {
    const chips = note.querySelector('.label-chips');
    const text = note.querySelector('.rt, .ProseMirror');
    return !!chips && !!text && chips.getBoundingClientRect().bottom <= text.getBoundingClientRect().top + 1 && note.contains(chips);
  }));
  check('as a solid tag', await tag.evaluate((el) => getComputedStyle(el).color === 'rgb(255, 255, 255)' && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  await page.screenshot({ path: `${OUT}/98-note-labels.png` });

  // --- Ctrl+Backspace deletes a note with text; a plain Backspace does not
  await welcome.click();
  await page.keyboard.press('Backspace');
  check('Backspace alone keeps a note with text', (await notes('Добро пожаловать').count()) === 1);
  check('and says which keys delete it', (await page.locator('.toast').textContent()).includes('Ctrl+Backspace'));
  check('the note is selected, not being edited', (await page.locator('.layer .note.editing').count()) === 0);
  await page.keyboard.press('Control+Backspace');
  check('Ctrl+Backspace deletes it', (await notes('Добро пожаловать').count()) === 0);
  await page.keyboard.press('Control+z');
  check('and undo brings it back', (await notes('Добро пожаловать').count()) === 1);
});

process.exit(failed ? 1 : 0);
