// Stage 2b: drawing on the board, sketch cards, drawing on images, presentation mode.
import { centre, drag, dragTool, OUT, runSuite } from './harness.mjs';

async function scribble(page, x, y, w = 160) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (w * i) / 12, y + Math.sin(i / 2) * 30);
  await page.mouse.up();
}

const failed = await runSuite('stage 2b', 4335, async ({ page, check }) => {
  // --- drawing on the board
  await page.locator('.tool', { hasText: 'Рисовать' }).click();
  check('the Draw tool switches the board into drawing mode', await page.isVisible('.draw-capture'));
  await scribble(page, 760, 520);
  await page.keyboard.press('3');
  await page.keyboard.press('x');
  await scribble(page, 760, 600);
  await page.screenshot({ path: `${OUT}/50-drawing.png` });
  await page.keyboard.press('Escape');
  check('finishing saves the strokes as one drawing on the board', (await page.locator('svg.drawing path').count()) === 2);
  check('size and previous-colour keys change the pen', (await page.locator('svg.drawing path').nth(1).getAttribute('stroke-width')) === '8' && (await page.locator('svg.drawing path').nth(1).getAttribute('stroke')) === '#e5484d');

  // the drawing is a normal element: it can be moved
  const before = await page.locator('.el', { has: page.locator('svg.drawing') }).evaluate((el) => el.style.transform);
  const dBox = await page.locator('svg.drawing').boundingBox();
  await drag(page, { x: dBox.x + 8, y: dBox.y + 30 }, { x: dBox.x + 108, y: dBox.y + 130 });
  check('a drawing can be dragged like a card', (await page.locator('.el', { has: page.locator('svg.drawing') }).evaluate((el) => el.style.transform)) !== before);

  // eraser on the saved drawing, then undo
  await page.mouse.click(1250, 800);
  await page.keyboard.press('Shift+D');
  check('Shift+D starts drawing', await page.isVisible('.draw-capture'));
  await page.keyboard.press('e');
  const path = page.locator('svg.drawing path').first();
  const pBox = await path.boundingBox();
  await drag(page, { x: pBox.x + pBox.width / 2 - 20, y: pBox.y - 10 }, { x: pBox.x + pBox.width / 2 + 20, y: pBox.y + pBox.height + 10 });
  await page.keyboard.press('Escape');
  check('the eraser removes strokes it touches', (await page.locator('svg.drawing path').count()) === 1);
  await page.keyboard.press('Control+z');
  check('erasing can be undone', (await page.locator('svg.drawing path').count()) === 2);

  // --- a sketch card (storyboard frame)
  await dragTool(page, 'Скетч', { x: 520, y: 680 });
  await page.waitForSelector('.sketch-overlay');
  await page.click('.aspect-pick >> text=2.39:1');
  const paper = await page.locator('.sketch-paper').boundingBox();
  await scribble(page, paper.x + 40, paper.y + paper.height / 2, paper.width - 80);
  await page.screenshot({ path: `${OUT}/51-sketch-editor.png` });
  await page.click('.draw-bar >> text=Сохранить');
  check('a sketch keeps what was drawn', (await page.locator('.sketch-card path').count()) === 1);
  const ratio = await page.locator('.sketch-surface').evaluate((el) => el.clientWidth / el.clientHeight);
  check('the sketch frame has the chosen aspect ratio', Math.abs(ratio - 2.39) < 0.05, ratio.toFixed(2));

  // --- drawing on an image
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#3f5a8a';
    g.fillRect(0, 0, 400, 300);
    const file = new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'кадр.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.elementFromPoint(1100, 300);
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: 1100, clientY: 300, dataTransfer: dt }));
  });
  await page.waitForSelector('.media-card img');
  await page.locator('.media-card', { has: page.locator('img') }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Рисовать на изображении');
  const imgPaper = await page.locator('.sketch-paper').boundingBox();
  await scribble(page, imgPaper.x + 30, imgPaper.y + 60, imgPaper.width - 60);
  await page.keyboard.press('Escape');
  check('markup drawn on an image stays on the image card', (await page.locator('.media-card .annotations path').count()) === 1);

  // --- presentation mode
  await page.mouse.click(1250, 800);
  await page.click('[aria-label="Режим презентации"]');
  check('presenting hides the editing tools', (await page.locator('.topbar').count()) === 0 && (await page.locator('.toolbar').count()) === 0 && (await page.isVisible('.present-bar')));
  const zoomBefore = await page.textContent('.zoom-value');
  const note = page.locator('.layer .note', { hasText: 'Добро пожаловать' });
  const noteTransform = await page.locator('.layer > .el', { hasText: 'Добро пожаловать' }).evaluate((el) => el.style.transform);
  await drag(page, await centre(note), { x: 900, y: 700 });
  check('cards cannot be moved while editing is prevented', (await page.locator('.layer > .el', { hasText: 'Добро пожаловать' }).evaluate((el) => el.style.transform)) === noteTransform);
  check('clicking a card focuses on it', (await page.textContent('.zoom-value')) !== zoomBefore, `${zoomBefore} → ${await page.textContent('.zoom-value')}`);
  await page.screenshot({ path: `${OUT}/52-presenting.png` });
  await page.keyboard.press('Escape');
  check('Esc ends the presentation', (await page.locator('.topbar').count()) === 1 && (await page.locator('.present-bar').count()) === 0);
});

process.exit(failed ? 1 : 0);
