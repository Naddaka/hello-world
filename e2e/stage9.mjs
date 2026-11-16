// AI: a generated picture for a storyboard frame (OpenAI), and review comments turned into tasks.
// The models are played by e2e/aiMock.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dragTool, OUT, runSuite } from './harness.mjs';
import { mockAi } from './aiMock.mjs';

const PICTURE = readFileSync(path.resolve('e2e/fixtures/location.png')).toString('base64');

const failed = await runSuite(
  'ai: frames and review',
  4345,
  async ({ page, check }) => {
    let imageFails = false;
    const ai = await mockAi(page, {
      keys: { anthropic: true, openai: false },
      image: () => (imageFails ? null : PICTURE),
      answer: () => ({
        json: {
          tasks: [
            { text: 'Пересветить небо и поднять громкость диалога', timecodes: ['00:00:02:01', '00:00:03:01', '99:99:99:99'] },
            { text: '', timecodes: [] },
          ],
        },
      }),
    });

    // --- a storyboard frame
    await dragTool(page, 'Скетч', { x: 900, y: 600 });
    await page.waitForSelector('.sketch-overlay');
    await page.click('.draw-bar >> text=Сохранить');
    const frame = page.locator('.layer .sketch-card').first();
    await frame.click({ button: 'right' });
    await page.click('.ctxmenu >> text=Сделать кадром раскадровки');
    await page.fill('.sp-field:has-text("Крупность") input', 'Крупный');
    await page.click('.modal >> text=Сохранить');

    await frame.click({ button: 'right' });
    await page.click('.ctxmenu >> text=ИИ: сгенерировать кадр');
    await page.fill('#frame-image-text', 'Женщина в плаще идёт по мокрому пирсу на рассвете');
    await page.selectOption('#frame-image-style', 'film');
    await page.click('.ai-dialog >> button:has-text("Сгенерировать")');
    await page.waitForSelector('.ai-dialog >> text=нужен отдельный ключ API OpenAI');
    check('without an OpenAI key nothing is sent', ai.images.length === 0);
    await page.click('.ai-dialog [aria-label="Закрыть"]');
    ai.keys.openai = true;

    await frame.click({ button: 'right' });
    await page.click('.ctxmenu >> text=ИИ: сгенерировать кадр');
    await page.fill('#frame-image-text', 'Женщина в плаще идёт по мокрому пирсу на рассвете');
    check('the style is remembered', (await page.locator('#frame-image-style').inputValue()) === 'film');
    await page.click('.ai-dialog >> button:has-text("Сгенерировать")');
    await page.waitForSelector('.ai-frame-preview');
    const sent = ai.images[0];
    check('only the description goes to OpenAI, in the frame’s shape', sent.prompt.startsWith('Женщина в плаще идёт по мокрому пирсу на рассвете\n') && sent.prompt.includes('Shot: close-up.') && sent.prompt.includes('Cinematic film still') && sent.size === '1536x1024' && !!sent.model);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ai-frame-preview')).backgroundImage.startsWith('url('));
    check('the picture is shown before it is used', (await frame.locator('.sketch-surface').evaluate((el) => el.style.backgroundImage)) === '');
    await page.screenshot({ path: `${OUT}/120-ai-frame.png` });
    await page.click('.ai-dialog >> button:has-text("Поставить в кадр")');
    await page.waitForFunction(() => document.querySelector('.layer .sketch-surface').style.backgroundImage.startsWith('url('));
    check('accepted, it becomes the frame’s picture and its caption', (await page.locator('.layer figcaption', { hasText: 'Женщина в плаще' }).count()) === 1);
    await page.keyboard.press('Control+z');
    check('and one undo takes it out', (await frame.locator('.sketch-surface').evaluate((el) => el.style.backgroundImage)) === '');

    imageFails = true;
    await frame.click({ button: 'right' });
    await page.click('.ctxmenu >> text=ИИ: сгенерировать кадр');
    await page.fill('#frame-image-text', 'Пирс');
    await page.click('.ai-dialog >> button:has-text("Сгенерировать")');
    await page.waitForSelector('.ai-dialog [role="alert"]');
    check('a failed generation is reported and can be retried', (await page.locator('.ai-dialog [role="alert"]').textContent()).includes('Не удалось') && (await page.isEnabled('.ai-dialog >> button:has-text("Сгенерировать")')));
    await page.click('.ai-dialog >> button:has-text("Отмена")');

    // --- review comments into tasks
    const chooser = page.waitForEvent('filechooser');
    await page.click('.tool:has-text("Медиа")');
    await (await chooser).setFiles(path.resolve('e2e/fixtures/clip.webm'));
    await page.waitForSelector('.layer .file-card video');
    await page.locator('.layer .file-card .file-name').dblclick();
    await page.waitForSelector('.vr-overlay video');
    await page.waitForFunction(() => document.querySelector('.vr-overlay video').readyState >= 2);
    await page.waitForFunction(() => document.querySelector('.vr-overlay .sp-select option:checked')?.textContent?.includes('по файлу'), null, { timeout: 8000 }).catch(() => {});
    check('tasks need comments first', await page.isDisabled('.vr-overlay >> button:has-text("В задачи")'));
    await page.evaluate(() => (document.querySelector('.vr-overlay video').currentTime = 0));
    await page.waitForFunction(() => document.querySelector('.vr-overlay video').currentTime === 0);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('m');
    await page.keyboard.type('Пересветить небо');
    await page.keyboard.press('Enter');
    await page.locator('.vr-overlay').click({ position: { x: 5, y: 80 } });
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('m');
    await page.keyboard.type('Диалог тихий');
    await page.keyboard.press('Enter');
    await page.locator('.vr-overlay').click({ position: { x: 5, y: 80 } });

    await page.click('.vr-overlay >> button:has-text("В задачи")');
    await page.click('.menu-item:has-text("Список правок с ИИ")');
    await page.waitForSelector('.ai-dialog >> text=будет отправлено');
    check('it says the video itself is not sent', await page.isVisible('.ai-dialog >> text=само видео не отправляется'));
    await page.click('.ai-dialog >> button:has-text("Отправить")');
    await page.waitForSelector('.ai-check-list');
    const body = ai.messages.at(-1).body;
    check('the comments go with their timecodes', body.messages[0].content[0].text.includes('00:00:02:01 — Пересветить небо') && body.messages[0].content[0].text.includes('00:00:03:01 — Диалог тихий'));
    const row = await page.locator('.ai-check-list li').allTextContents();
    check('edits are proposed with the timecodes they came from, made-up ones dropped', row.length === 1 && row[0].includes('Пересветить небо и поднять громкость диалога') && row[0].includes('00:00:02:01, 00:00:03:01') && !row[0].includes('99:99'), row.join(' | '));
    await page.click('.ai-dialog >> button:has-text("Создать список задач (1)")');

    await page.click('.vr-overlay >> button:has-text("В задачи")');
    await page.click('.menu-item:has-text("Список задач как есть")');
    await page.click('.vr-overlay >> text=К доске');
    const lists = page.locator('.layer .tasklist');
    check('both task lists are on the board next to the video', (await lists.count()) === 2);
    check('the plain list has one task per comment', (await page.locator('.layer .tasklist', { hasText: '00:00:02:01 — Пересветить небо' }).count()) === 1 && (await page.locator('.layer .tasklist', { hasText: '00:00:03:01 — Диалог тихий' }).count()) === 1);
    check('the AI list has the merged edit', (await page.locator('.layer .tasklist', { hasText: '00:00:02:01, 00:00:03:01 — Пересветить небо и поднять громкость диалога' }).count()) === 1);
    await page.screenshot({ path: `${OUT}/121-ai-review-tasks.png` });
  },
  { ignoreErrors: [/status of 500/] },
);

process.exit(failed ? 1 : 0);
