// Stage 3: import from Milanote (the file route, which works in the browser too).
import path from 'node:path';
import { OUT, runSuite } from './harness.mjs';

const FIXTURE = path.resolve('e2e/fixtures/milanote-export.json');

const failed = await runSuite(
  'stage 3',
  4337,
  async ({ page, check }) => {
    // The fixture has one image whose server is gone: it must become a link, not break the import.
    await page.route('https://media.invalid/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.route('https://www.youtube.com/**', (route) => route.fulfill({ status: 204, body: '' }));

    await page.click('.topbar >> text=Импорт');
    check('the import dialog explains how to get an export file', await page.isVisible('.modal >> text=Скопировать скрипт'));
    await page.setInputFiles('.modal details input[type="file"]', FIXTURE);
    await page.waitForSelector('.modal >> text=Импортировать');
    check('the dialog summarises the export before importing', await page.isVisible('.modal >> text=Нашлось 37 элементов на 7 досках'), await page.locator('.modal-body p').first().textContent());
    await page.screenshot({ path: `${OUT}/70-import-confirm.png` });
    await page.click('.modal >> button:has-text("Импортировать")');
    await page.waitForSelector('.modal >> text=Готово', { timeout: 20000 });
    check('the report counts what was brought over', (await page.locator('.mn-report tr').count()) === 6);
    check('a file that could not be downloaded is reported', await page.isVisible('.modal >> text=Не удалось скачать файлов: 1'));
    check('the report says how board icons came over', await page.isVisible('.modal >> text=Иконки досок: точно — 3, подобрано по смыслу — 1.'));
    await page.screenshot({ path: `${OUT}/71-import-report.png` });

    await page.click('.modal >> text=Открыть доску «Milanote»');
    await page.waitForSelector('.crumb.current:has-text("Milanote")');
    check('the Milanote home board opens with its boards', (await page.locator('.layer .tile', { hasText: 'Клип «Северный ветер»' }).count()) === 1 && (await page.locator('.layer .tile', { hasText: 'Быстрые заметки' }).count()) === 1);
    const north = page.locator('.layer .note', { hasText: 'Северный ветер' });
    check('a Draft.js note keeps headings, bold and links', (await north.locator('h1').count()) === 1 && (await north.locator('strong', { hasText: 'Клип' }).count()) === 1 && (await north.locator('a[href="https://example.com/director"]').count()) === 1);
    check('a TipTap note keeps its colour', (await page.locator('.layer .note', { hasText: 'Референсы' }).evaluate((el) => el.style.background)).includes('yellow'));
    check('labels come along', (await page.locator('.layer .el', { hasText: 'Простой текст' }).locator('.label-chip', { hasText: 'Важно' }).count()) === 1);
    const clipTile = page.locator('.layer .tile', { hasText: 'Клип «Северный ветер»' });
    check('a Milanote glyph is drawn from the export, two-tone, in the board colour', (await clipTile.locator('.tile-icon .board-svg svg path[opacity="0.4"]').count()) === 1 && (await clipTile.locator('.board-svg script, .board-svg style').count()) === 0);
    check('a numbered glyph without its SVG becomes a framed number', (await page.locator('.layer .tile', { hasText: 'Архив' }).locator('.board-text.boxed').textContent()) === '12');
    await page.screenshot({ path: `${OUT}/72-milanote-home.png` });

    await page.locator('.layer .tile', { hasText: 'Клип «Северный ветер»' }).dblclick();
    await page.waitForSelector('.crumb.current:has-text("Клип «Северный ветер»")');
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    const column = page.locator('.layer .column', { hasText: 'Сцены' });
    const order = await column.locator('.note').allTextContents();
    check('column cards keep their order', order.join('|') === 'Сцена 1|Сцена 2', order.join('|'));
    check('both kinds of task lists are imported', (await page.locator('.layer .tasklist', { hasText: 'Арендовать свет' }).count()) === 1 && (await page.locator('.layer .tasklist', { hasText: 'Цветокор' }).count()) === 1);
    const imgSrc = await page.locator('.layer .media-card img').first().getAttribute('src');
    check('images and sketches are stored locally', (await page.locator('.layer .media-card img').count()) === 2 && !!imgSrc?.startsWith('blob:'), imgSrc ?? 'no image');
    const totalRow = (await page.locator('.zt tbody tr').last().textContent()) ?? '';
    check('the table and its formula work', totalRow.includes('Итого') && /5\s?000/.test(totalRow), totalRow);
    check('lines keep their label', await page.isVisible('text=смотри'));
    check('comments pinned to cards become markers', (await page.locator('.comment-marker').count()) === 1);
    check('shortcuts, documents and swatches are there', (await page.locator('.layer .tile', { hasText: 'Архив' }).count()) === 1 && (await page.locator('.layer', { hasText: 'Сценарий' }).count()) > 0 && (await page.locator('.layer', { hasText: 'Закатный' }).count()) > 0);
    check('the unreachable image became a link to the original', (await page.locator('.layer', { hasText: 'Не удалось скачать при импорте' }).count()) > 0);
    await page.screenshot({ path: `${OUT}/73-milanote-board.png` });

    // Importing again replaces the previous import instead of duplicating it.
    const storedFiles = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('zadum-media');
            open.onsuccess = () => {
              const req = open.result.transaction('files').objectStore('files').count();
              req.onsuccess = () => resolve(req.result);
            };
          }),
      );
    const filesBefore = await storedFiles();
    await page.locator('.crumb').first().click();
    await page.click('.topbar >> text=Импорт');
    await page.setInputFiles('.modal details input[type="file"]', FIXTURE);
    await page.waitForSelector('.modal >> button:has-text("Импортировать")');
    check('a second import warns that it replaces the first', await page.isVisible('.modal >> text=Предыдущий импорт этого аккаунта'));
    await page.click('.modal >> button:has-text("Импортировать")');
    await page.waitForSelector('.modal >> text=Готово', { timeout: 20000 });
    await page.click('.modal >> button:has-text("Закрыть")');
    check('re-importing does not duplicate the board', (await page.locator('.layer .tile', { hasText: 'Milanote' }).count()) === 1);
    const filesAfter = await storedFiles();
    check('files of the replaced import are removed', filesAfter === filesBefore, `${filesBefore} → ${filesAfter}`);

    // Icons only, from the export file, without importing again.
    await page.locator('.layer .tile', { hasText: 'Milanote' }).dblclick();
    await page.waitForSelector('.crumb.current:has-text("Milanote")');
    const clip = page.locator('.layer .tile', { hasText: 'Клип «Северный ветер»' });
    await clip.click();
    await page.locator('.props-bar').locator('text=Иконка').click();
    await page.click('.icon-picker >> text=Без иконки');
    check('an icon can be taken off', (await clip.locator('.board-svg').count()) === 0);
    await page.click('.topbar >> text=Импорт');
    check('the dialog offers to update board icons only', await page.isVisible('.modal >> text=Уже импортировали?'));
    await page.setInputFiles('.modal input[aria-label="Файл экспорта для иконок"]', FIXTURE);
    await page.waitForSelector('.modal >> text=Иконки обновлены у 1 доски');
    check('only the board without an icon gets one back', await page.isVisible('.modal >> text=Оставил как есть — у доски уже была иконка: 3.'));
    await page.screenshot({ path: `${OUT}/74-icons-refreshed.png` });
    await page.click('.modal >> button:has-text("Готово")');
    check('the glyph is back', (await clip.locator('.board-svg svg').count()) === 1);
    await page.keyboard.press('Control+z');
    check('and the refresh is one undo step', (await clip.locator('.board-svg').count()) === 0);
    await page.keyboard.press('Control+Shift+z');
    await page.locator('.crumb').first().click();

    // Copies: the import duplicated on the home board, the original in the trash.
    const mnTile = page.locator('.layer .tile', { hasText: 'Milanote' });
    await mnTile.click({ button: 'right' });
    await page.click('.ctxmenu >> text=Дублировать');
    await page.keyboard.press('Escape');
    // The copy lies over the original, a little lower right: its top-left corner is free.
    await mnTile.first().click({ button: 'right', position: { x: 6, y: 6 } });
    await page.click('.ctxmenu >> text=Удалить');
    check('the original import is in the trash, its copy on the board', (await mnTile.count()) === 1);
    await mnTile.dblclick();
    await page.waitForSelector('.crumb.current:has-text("Milanote")');
    const copyClip = page.locator('.layer .tile', { hasText: 'Клип «Северный ветер»' });
    await copyClip.click();
    await page.locator('.props-bar').locator('text=Иконка').click();
    await page.click('.icon-picker >> text=Без иконки');
    await page.click('.topbar >> text=Импорт');
    await page.setInputFiles('.modal input[aria-label="Файл экспорта для иконок"]', FIXTURE);
    await page.waitForSelector('.modal >> text=Иконки обновлены у 1 доски');
    check('icons reach copies of imported boards', await page.isVisible('.modal >> text=Из них копий импортированных досок: 1.'));
    await page.click('.modal >> button:has-text("Готово")');
    check('the copy has its glyph again', (await copyClip.locator('.board-svg svg').count()) === 1);
    await page.locator('.crumb').first().click();

    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForSelector('text=Добро пожаловать в Zadum');
    await page.locator('.layer .tile', { hasText: 'Milanote' }).dblclick();
    check('the import survives a reload', await page.isVisible('.layer .note:has-text("Северный ветер")'));
  },
  // The unreachable image: refused by the CSP in the browser build (the app downloads through Rust).
  { ignoreErrors: [/Failed to load resource/, /media\.invalid/] },
);

process.exit(failed ? 1 : 0);
