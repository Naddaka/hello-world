// End-to-end check of the stage 0 features in Chromium against a production build.
// Usage: npm run build && npm run e2e   (uses the Playwright installed on the machine)
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(globalRoot, 'playwright'));

const OUT = path.resolve('e2e/out');
mkdirSync(OUT, { recursive: true });
const PORT = 4321;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('first launch shows the welcome note and sample board', await page.isVisible('text=Мой первый проект'));

  // --- create and format a note by double-clicking empty canvas
  await page.mouse.dblclick(700, 520);
  await page.waitForSelector('.note.editing .ProseMirror');
  await page.keyboard.type('Северный ветер');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Клип на один трек. ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Одним планом');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('. Хронометраж 3:42');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Формат 2.39:1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[ ] Найти пирс');
  check('format bar is shown while editing', await page.isVisible('.formatbar'));
  // Clicking inside the note being edited keeps editing (to place the cursor).
  await page.locator('.note.editing .ProseMirror').click();
  check('clicking inside a note being edited keeps it in editing', (await page.locator('.note.editing').count()) === 1);
  await page.screenshot({ path: `${OUT}/01-editing-light.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(1100, 700);
  const note = page.locator('.note', { hasText: 'Северный ветер' });
  check('heading shortcut ⌘⇧1 makes a large heading', (await note.locator('h1').count()) === 1);
  check('bold shortcut ⌘B formats text', (await note.locator('strong', { hasText: 'Одним планом' }).count()) === 1);
  check('". " at line start starts a bullet list', (await note.locator('ul li').count()) >= 2);
  check('"[ ] " starts a checkbox item', (await note.locator('ul[data-type="taskList"] li').count()) === 1);

  // tick the checkbox without entering edit mode
  await note.locator('input[type="checkbox"]').click();
  check('checkbox can be ticked without editing', (await note.locator('li[data-checked="true"]').count()) === 1);

  // --- an abandoned empty note disappears
  const before = await page.locator('.note').count();
  await page.mouse.dblclick(1150, 300);
  await page.waitForSelector('.note.editing');
  await page.mouse.click(1150, 760);
  check('an empty new note is removed when you click away', (await page.locator('.note').count()) === before);

  // --- drag a board from the toolbar onto the canvas and name it
  const tool = page.locator('.tool', { hasText: 'Доска' });
  const tb = await tool.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(500, 300, { steps: 8 });
  await page.mouse.move(520, 640, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('.tile-input');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Клип «Северный ветер»');
  await page.keyboard.press('Enter');
  check('board created from the toolbar and named', await page.isVisible('.tile-title:has-text("Клип «Северный ветер»")'));

  // --- open the board, add a note, come back via breadcrumbs
  await page.locator('.tile', { hasText: 'Клип «Северный ветер»' }).dblclick();
  await page.waitForSelector('.crumb.current:has-text("Клип «Северный ветер»")');
  check('double-click opens the board and breadcrumbs follow', true);
  // Type immediately after the double-click: no keystroke may be lost.
  await page.mouse.dblclick(600, 400);
  await page.keyboard.type('Заметка внутри доски');
  await page.keyboard.press('Escape');
  check('typing right after a double-click keeps every character', (await page.locator('.note .rt').first().textContent()) === 'Заметка внутри доски', await page.locator('.note .rt').first().textContent());
  await page.screenshot({ path: `${OUT}/02-inside-board.png` });
  await page.locator('.crumb', { hasText: 'Главная' }).click();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('board tile counts its cards', await page.isVisible('.tile:has-text("Клип «Северный ветер»") .tile-meta:has-text("1 карточка")'));

  // --- drag a note, then undo the move
  const welcome = page.locator('.el', { hasText: 'Добро пожаловать' });
  const t0 = await welcome.evaluate((el) => el.style.transform);
  const wb = await welcome.boundingBox();
  await page.mouse.move(wb.x + 40, wb.y + 20);
  await page.mouse.down();
  await page.mouse.move(wb.x + 140, wb.y + 80, { steps: 10 });
  await page.mouse.up();
  const t1 = await welcome.evaluate((el) => el.style.transform);
  check('dragging moves a note', t0 !== t1, `${t0} → ${t1}`);
  await page.keyboard.press('Control+z');
  check('⌘Z undoes the move', (await welcome.evaluate((el) => el.style.transform)) === t0);
  await page.keyboard.press('Control+Shift+z');
  check('⌘⇧Z redoes the move', (await welcome.evaluate((el) => el.style.transform)) === t1);

  // --- move a note into a board by dropping it on the tile
  const target = await page.locator('.tile-icon').first().boundingBox();
  const moved = page.locator('.el', { hasText: 'Северный ветер' }).filter({ has: page.locator('.note') });
  const mb = await moved.boundingBox();
  await page.mouse.move(mb.x + 30, mb.y + 15);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 40, { steps: 12 });
  await page.mouse.up();
  check('dropping a note on a board moves it inside', (await page.locator('.note', { hasText: 'Клип на один трек' }).count()) === 0);
  await page.keyboard.press('Control+z');
  check('undo brings it back', (await page.locator('.note', { hasText: 'Клип на один трек' }).count()) === 1);

  // --- dark theme
  await page.keyboard.press('Control+Shift+d');
  check('⌘⇧D switches to the dark theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.locator('.note', { hasText: 'Северный ветер' }).click();
  await page.screenshot({ path: `${OUT}/03-home-dark.png` });
  await page.keyboard.press('Control+Shift+d');
  await page.mouse.click(1100, 760);
  await page.screenshot({ path: `${OUT}/04-home-light.png` });

  // --- zoom
  await page.keyboard.press('Control+Equal');
  check('⌘+ zooms in', (await page.textContent('.zoom-value')) === '125%');
  await page.keyboard.press('z');
  const fit = await page.textContent('.zoom-value');
  check('Z fits all content', fit !== '125%', fit);

  // --- everything survives a reload
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');
  check('content persists after reload', await page.isVisible('text=Северный ветер') && (await page.isVisible('text=Клип «Северный ветер»')));

  // --- delete key: boards go to trash, notes with text are protected
  await page.locator('.tile', { hasText: 'Клип «Северный ветер»' }).click();
  await page.keyboard.press('Delete');
  check('Delete removes a selected board', (await page.locator('.tile', { hasText: 'Клип «Северный ветер»' }).count()) === 0);
  await page.locator('.note', { hasText: 'Северный ветер' }).click();
  await page.keyboard.press('Delete');
  check('Delete keeps a note with text and explains why', (await page.locator('.note', { hasText: 'Северный ветер' }).count()) === 1 && (await page.isVisible('.toast')));

  // --- context menu
  await page.locator('.note', { hasText: 'Северный ветер' }).click({ button: 'right' });
  check('right-click opens the context menu', await page.isVisible('.ctxmenu >> text=Дублировать'));
  await page.click('.ctxmenu >> text=Дублировать');
  check('Duplicate copies the note', (await page.locator('.note', { hasText: 'Северный ветер' }).count()) === 2);

  check('no errors in the browser console', errors.length === 0, errors.join(' | '));
  await browser.close();
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
