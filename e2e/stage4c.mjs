// Stage 4c: video review with timecoded comments, marker export, frame grabs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OUT, runSuite } from './harness.mjs';

const failed = await runSuite('stage 4c', 4340, async ({ page, check }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.click('.tool:has-text("Медиа")');
  await (await chooser).setFiles(path.resolve('e2e/fixtures/clip.webm'));
  await page.waitForSelector('.layer .file-card video');
  check('a video lands on the board', true);
  // A poster frame is made so the card is not black before playing.
  await page.waitForFunction(() => document.querySelector('.layer .file-card video')?.getAttribute('poster')?.startsWith('blob:'), null, { timeout: 15000 });
  const poster = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          let lit = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
          resolve({ w: img.naturalWidth, h: img.naturalHeight, lit: lit / (px.length / 4) });
        };
        img.src = document.querySelector('.layer .file-card video').getAttribute('poster');
      }),
  );
  check('the video card shows a poster frame, not black', poster.w === 640 && poster.h === 360 && poster.lit > 0.5, JSON.stringify(poster));

  await page.locator('.layer .file-card .file-name').dblclick();
  await page.waitForSelector('.vr-overlay video');
  await page.waitForFunction(() => document.querySelector('.vr-overlay video').readyState >= 2);
  check('double-clicking a video opens the review', await page.isVisible('.vr-tc:has-text("00:00:06:00")'), await page.locator('.vr-tc').last().textContent());

  const tc = () => page.locator('.vr-tc').first().textContent();
  // The frame rate is read from the frames while the video plays (the app also reads it from the file).
  await page.keyboard.press(' ');
  await page.waitForFunction(() => document.querySelector('.vr-head-fps, .sp-select option:checked')?.textContent?.includes('по файлу'), null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.press(' ');
  check('the frame rate is detected', (await page.locator('.vr-overlay .sp-select option:checked').textContent()).includes('25 (по файлу)'), await page.locator('.vr-overlay .sp-select option:checked').textContent());
  await page.keyboard.press('Home');
  await page.evaluate(() => (document.querySelector('.vr-overlay video').currentTime = 0));
  await page.waitForFunction(() => document.querySelector('.vr-overlay video').currentTime === 0);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowRight');
  check('arrow keys step by frames and seconds', (await tc()) === '00:00:02:01', await tc());
  await page.keyboard.press('m');
  await page.keyboard.type('Пересветить небо');
  await page.keyboard.press('Enter');
  await page.locator('.vr-overlay').click({ position: { x: 5, y: 80 } });
  await page.keyboard.press('Shift+ArrowRight');
  await page.click('.vr-dot[aria-label="Красный"]');
  await page.keyboard.press('m');
  await page.keyboard.type('Звук громче');
  await page.keyboard.press('Enter');
  const items = await page.locator('.vr-item .vr-time small').allTextContents();
  check('comments are pinned to timecodes', items.join(' ') === '00:00:02:01 00:00:03:01', items.join(' '));
  check('comments show on the timeline', (await page.locator('.vr-timeline .vr-pin').count()) === 2 && (await page.locator('.vr-timeline .vr-pin.c-red').count()) === 1);

  await page.locator('.vr-overlay').click({ position: { x: 5, y: 80 } });
  await page.keyboard.press('[');
  check('[ jumps to the previous comment', (await tc()) === '00:00:02:01', await tc());

  await page.locator('.vr-item').first().locator('input[type="checkbox"]').check();
  await page.check('.vr-filter input');
  check('fixed comments can be hidden', (await page.locator('.vr-item').count()) === 1);
  await page.uncheck('.vr-filter input');
  await page.screenshot({ path: `${OUT}/84-video-review.png` });

  // Export to DaVinci Resolve and YouTube.
  await page.click('.vr-overlay >> text=Экспорт маркеров');
  let download = page.waitForEvent('download');
  await page.click('.menu-item:has-text("DaVinci Resolve")');
  const edl = readFileSync(await (await download).path(), 'utf8');
  check('markers export as a Resolve EDL', edl.includes('01:00:02:01 01:00:02:02') && edl.includes('|C:ResolveColorRed |M:Звук громче |D:1'), edl.slice(0, 200));
  await page.click('.vr-overlay >> text=Экспорт маркеров');
  download = page.waitForEvent('download');
  // Chapters at 0:02 and 0:03 break YouTube's rules: the app says so and lets you save anyway.
  await page.click('.menu-item:has-text("Главы YouTube")');
  await page.waitForSelector('.confirm-dialog');
  const warning = await page.locator('.confirm-dialog').textContent();
  // Escape answers the dialog only: the review stays open.
  await page.keyboard.press('Escape');
  check('Escape cancels the question, not the review', (await page.locator('.confirm-dialog').count()) === 0 && (await page.locator('.vr-overlay').count()) === 1);
  await page.click('.vr-overlay >> text=Экспорт маркеров');
  await page.click('.menu-item:has-text("Главы YouTube")');
  await page.click('.confirm-dialog >> text=Сохранить всё равно');
  const chapters = readFileSync(await (await download).path(), 'utf8');
  check('YouTube chapter rules are checked', warning.includes('короче 10 секунд'), warning);
  check('and as YouTube chapters', chapters === '0:00 Начало\n0:02 Пересветить небо\n0:03 Звук громче\n', JSON.stringify(chapters));

  // Any frame can become the card's poster.
  const posterBefore = await page.evaluate(() => document.querySelector('.layer .file-card video')?.getAttribute('poster'));
  await page.click('.vr-overlay >> text=Кадр на обложку');
  await page.waitForSelector('.toast:has-text("Обложка — кадр 00:00:02:01")');
  const posterAfter = await page.evaluate(() => document.querySelector('.layer .file-card video')?.getAttribute('poster'));
  check('the frame on screen can be made the poster', !!posterAfter && posterAfter !== posterBefore);

  // Frame grab.
  await page.click('.vr-overlay >> text=Стоп-кадр в карточку');
  await page.waitForSelector('.toast:has-text("Стоп-кадр 00:00:02:01")');
  await page.click('.vr-overlay >> text=← К доске');
  const grab = page.locator('.layer .media-card', { hasText: 'clip.webm · 00:00:02:01' });
  check('a frame grab becomes an image card next to the video', (await grab.count()) === 1);
  const size = await grab.locator('img').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  check('the grab has the video resolution', size[0] === 640 && size[1] === 360, String(size));
  check('the video card shows its comments', await page.isVisible('.file-card .file-marker-count:has-text("2 комм. · открыто 1")'));
  await page.screenshot({ path: `${OUT}/85-video-card.png` });

  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('comments survive a reload', await page.isVisible('.file-card .file-marker-count:has-text("2 комм.")'));
});

process.exit(failed ? 1 : 0);
