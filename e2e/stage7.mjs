// AI: settings, and the screenplay features (breakdown, shots, editor's notes, variants, translation).
// The model is played by e2e/aiMock.mjs; these checks cover what the app sends and what it does with answers.
import path from 'node:path';
import { dragTool, OUT, runSuite } from './harness.mjs';
import { lastUserText, mockAi, wants } from './aiMock.mjs';

const failed = await runSuite('ai: scripts', 4343, async ({ page, check }) => {
  const answers = {
    items: () => ({
      thinking: 'Читаю сцены и выписываю реквизит.',
      json: {
        items: [
          { category: 'props', name: 'лампа маяка', scenes: [1] },
          { category: 'set', name: 'мокрые доски', scenes: [2] },
          { category: 'sfx', name: 'ветродуй', scenes: [1] },
          { category: 'props', name: 'лампа маяка', scenes: [1] },
        ],
      },
    }),
    shots: () => ({
      json: {
        shots: [
          { size: 'Общий', angle: 'Нейтральный', movement: 'Статика', lens: '24 мм', duration: 6, description: 'Пирс на рассвете, Маша вдалеке' },
          { size: 'Деталь', angle: 'Сверху', movement: 'Тревеллинг', lens: '', duration: 3, description: 'Ноги Маши на мокрых досках' },
          { size: 'Крупный', angle: 'Нейтральный', movement: 'С рук', lens: '85 мм', duration: 4, description: 'Лицо Маши' },
        ],
      },
    }),
    variants: () => ({ json: { variants: [{ text: 'Слышишь это?', note: 'короче' }, { text: 'Тише. Ты слышишь?', note: 'напряжённее' }, { text: 'Там кто-то есть.', note: 'прямее' }] } }),
    lines: (body) => ({
      json: {
        lines: [...lastUserText(body).matchAll(/^(\d+)\|(\w+)\|(.*)$/gm)].map((m) => ({ i: Number(m[1]), text: m[2] === 'scene' ? (m[3].includes('МАЯК') ? 'INT. LIGHTHOUSE — NIGHT' : 'EXT. PIER — DAWN') : `EN ${m[3]}` })),
      },
    }),
    text: (body) => (lastUserText(body).startsWith('Название:') ? { text: 'North Wind' } : { text: '## Что работает\n\nАтмосфера маяка.\n\n## Диалоги\n\n- Реплика «Ты слышишь?» **работает**.\n- Петю стоит сделать резче.', thinking: 'Смотрю на темп.' }),
  };
  let failNext = null;
  const ai = await mockAi(page, {
    keys: { anthropic: false, openai: false },
    answer: (body) => {
      if (failNext) {
        const f = failNext;
        failNext = null;
        return f;
      }
      return answers[wants(body)](body);
    },
  });

  // --- settings
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Настройки ИИ")');
  check('AI settings explain what is sent and where keys live', await page.isVisible('.ai-settings >> text=только то, что вы сами') && (await page.locator('.ai-key-state', { hasText: 'ключа нет' }).count()) === 2);
  check('in a browser the keychain is unavailable, and it says so', (await page.locator('.ai-settings .mn-warn', { hasText: 'только в приложении' }).count()) === 2);
  await page.click('.ai-model:has-text("Sonnet 5.5")');
  await page.click('.ai-settings [role="radio"]:has-text("Тщательно")');
  await page.screenshot({ path: `${OUT}/100-ai-settings.png` });
  await page.click('.ai-settings >> button:has-text("Готово")');
  check('the model choice is kept', await page.evaluate(() => JSON.parse(localStorage.getItem('zadum.ai')).model === 'claude-sonnet-5-5' && JSON.parse(localStorage.getItem('zadum.ai')).effort === 'high'));
  await page.evaluate(() => localStorage.setItem('zadum.ai', JSON.stringify({ ...JSON.parse(localStorage.getItem('zadum.ai')), model: 'claude-opus-5-5', effort: 'medium' })));
  await page.reload();
  await page.waitForSelector('text=Добро пожаловать в Zadum');

  // --- a script to work on
  await dragTool(page, 'Сценарий', { x: 900, y: 600 });
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.setInputFiles('.sp-head input[type="file"]', path.resolve('e2e/fixtures/sample.fountain'));
  await page.waitForSelector('.sl:has-text("Лампа маяка")');

  // --- without a key: nothing is sent, the dialog leads to the settings
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Разбор сценария")');
  await page.waitForSelector('.ai-dialog >> text=нужен ключ API');
  check('without a key nothing is sent', ai.messages.length === 0);
  await page.click('.ai-dialog [aria-label="Закрыть"]');
  ai.keys.anthropic = true;

  // --- breakdown: first use asks for consent, then a checklist
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Разбор сценария")');
  await page.waitForSelector('.ai-dialog >> text=будет отправлено');
  check('the first request says what is sent before sending', ai.messages.length === 0 && (await page.isVisible('.ai-dialog >> text=сценарий «Северный ветер» целиком')));
  await page.click('.ai-dialog >> button:has-text("Отправить")');
  await page.waitForSelector('.ai-check-list');
  const sent = ai.messages[0];
  check('the request carries no key and asks for a fallback model', !sent.headers['x-api-key'] && !sent.headers.authorization && sent.body.fallbacks === 'default' && sent.body.model === 'claude-opus-5-5');
  check('the script is sent once, as cached context', sent.body.messages[0].content[0].cache_control?.type === 'ephemeral' && sent.body.messages[0].content[0].text.includes('### Сцена 1. ИНТ. МАЯК — НОЧЬ'));
  const rows = await page.locator('.ai-check-list li:not(.group):not(.group-wrap)').allTextContents();
  check('proposed items are listed once, with the scenes the app finds', rows.length === 3 && rows.some((r) => r.includes('лампа маяка') && r.includes('сцен: 1')) && rows.some((r) => r.includes('мокрые доски') && r.includes('сцен: 1')), rows.join(' | '));
  check('an item that is not in the text is off by default', !(await page.locator('.ai-check-list li', { hasText: 'ветродуй' }).last().locator('input').isChecked()) && (await page.locator('.ai-check-list li', { hasText: 'лампа маяка' }).last().locator('input').isChecked()));
  check('the answer shows the model and the cost', /Claude Opus 5\.5 · (≈ \$|меньше цента)/.test(await page.locator('.ai-meta').textContent()));
  await page.screenshot({ path: `${OUT}/101-ai-breakdown.png` });
  await page.click('.ai-dialog >> button:has-text("Добавить в разбор (2)")');
  check('accepted items land in the breakdown and are highlighted', (await page.locator('.sp-bd-name').evaluateAll((els) => els.map((e) => e.value ?? e.textContent))).includes('лампа маяка') && (await page.locator('.sp-rt .bd.bd-props').count()) > 0);

  // asking again proposes only what is new
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Разбор сценария")');
  await page.waitForSelector('.ai-check-list');
  check('no consent step the second time, and known items are not offered again', (await page.locator('.ai-check-list li:not(.group):not(.group-wrap)').count()) === 1);
  await page.click('.ai-dialog >> button:has-text("Ничего не добавлять")');

  // --- shots for the scene under the cursor
  await page.locator('.sl', { hasText: 'Маша идёт по мокрым доскам' }).click();
  await page.click('.sp-head .ai-btn');
  check('the menu names the scene under the cursor', await page.isVisible('.menu-item:has-text("Кадры для сцены 2")'));
  await page.click('.menu-item:has-text("Кадры для сцены 2")');
  await page.waitForSelector('.ai-check-list');
  check('shots are proposed with size, movement and length', (await page.locator('.ai-check-list li').count()) === 3 && (await page.locator('.ai-check-list li').first().textContent()).includes('WS') && (await page.isVisible('.ai-dialog >> text=примерно 13 с')));
  await page.locator('.ai-check-list li').nth(2).locator('input').uncheck();
  await page.screenshot({ path: `${OUT}/102-ai-shots.png` });
  await page.click('.ai-dialog >> button:has-text("Создать кадры (2)")');
  await page.click('.sp-head >> text=К доске');
  const board = page.locator('.layer .tile', { hasText: 'Раскадровка · Северный ветер' });
  check('a storyboard board appears next to the script', (await board.count()) === 1);
  await board.dblclick();
  await page.waitForSelector('.crumb.current:has-text("Раскадровка")');
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  const heads = await page.locator('.layer .frame-head').allTextContents();
  check('the frames carry the planned shots', heads.length === 2 && heads[0].includes('2.1') && heads[0].includes('WS') && heads[1].includes('INSERT') && (await page.isVisible('.layer figcaption:has-text("Ноги Маши")')), heads.join(' | '));
  check('the shot list is built from them', ((await page.locator('.zt tbody tr').last().textContent()) ?? '').includes('Итого'));
  await page.screenshot({ path: `${OUT}/103-ai-storyboard.png` });
  await page.locator('.crumb').first().click();
  // The last undo step is the editing session of the script (its breakdown); the one before it is the storyboard.
  await page.keyboard.press('Control+z');
  check('the storyboard is its own undo step', (await page.locator('.layer .tile', { hasText: 'Раскадровка' }).count()) === 1);
  await page.keyboard.press('Control+z');
  check('one undo removes the storyboard with its frames and shot list', (await page.locator('.layer .tile', { hasText: 'Раскадровка' }).count()) === 0 && (await page.evaluate(() => document.querySelectorAll('.layer .tile').length)) >= 1);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  check('and redo brings it back whole', (await page.locator('.layer .tile', { hasText: 'Раскадровка' }).count()) === 1);

  // --- editor's notes: streamed text, saved as a document
  await page.locator('.layer .el', { hasText: 'Северный ветер' }).first().dblclick();
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Заметки редактора: весь сценарий")');
  await page.waitForSelector('.ai-answer h2');
  check('notes come as formatted text', (await page.locator('.ai-answer h2').count()) === 2 && (await page.locator('.ai-answer li strong').count()) === 1);
  const notesRequest = ai.messages.at(-1).body;
  check('notes are asked at high effort, as free text', notesRequest.output_config.effort === 'high' && !notesRequest.output_config.format);
  await page.click('.ai-dialog >> button:has-text("Сохранить документом")');
  await page.click('.sp-head >> text=К доске');
  check('notes become a document on the board', (await page.locator('.layer .el', { hasText: 'Заметки редактора · Северный ветер' }).count()) === 1);

  // --- variants of a line, replaced in place
  await page.locator('.layer .script-tile, .layer .el:has-text("Северный ветер")').first().dblclick();
  await page.waitForSelector('.sp-overlay .sp-rt');
  await page.locator('.sl', { hasText: 'Ты слышишь?' }).click();
  await page.click('.sp-head .ai-btn');
  check('the menu shows which line will be rewritten', await page.isVisible('.menu-item:has-text("Ты слышишь?")'));
  await page.click('.menu-item:has-text("Варианты текста")');
  await page.waitForSelector('.ai-variants li');
  check('three variants are offered next to the original', (await page.locator('.ai-variants li').count()) === 3 && (await page.isVisible('.ai-dialog >> text=Было: «Ты слышишь?»')));
  await page.locator('.ai-variants li').nth(1).locator('button:has-text("Заменить в сценарии")').click();
  await page.waitForSelector('.sl[data-kind="dialogue"]:has-text("Тише. Ты слышишь?")');
  check('the chosen variant replaces the line', (await page.locator('.sl[data-kind="dialogue"]', { hasText: 'Тише. Ты слышишь?' }).count()) === 1);
  check('the cursor is back in the script', await page.evaluate(() => !!document.activeElement?.closest('.sp-rt')));
  await page.keyboard.press('Control+z');
  check('and the editor undoes it', (await page.locator('.sl[data-kind="dialogue"]').first().textContent()) === 'Ты слышишь?', await page.locator('.sl[data-kind="dialogue"]').first().textContent());

  // --- an error from the provider is shown in plain words, and can be retried
  failNext = { status: 429, error: { type: 'rate_limit_error', message: 'rate limited' } };
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Заметки редактора: весь сценарий")');
  await page.waitForSelector('.ai-answer h2, .ai-dialog [role="alert"]', { timeout: 60000 });
  check('a rate limit is retried by itself or explained', (await page.locator('.ai-answer h2').count()) > 0 || (await page.locator('.ai-dialog [role="alert"]').textContent()).includes('Слишком много запросов'));
  await page.click('.ai-dialog [aria-label="Закрыть"]');

  // a refusal
  failNext = { text: '', stop: 'refusal' };
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Заметки редактора: весь сценарий")');
  await page.waitForSelector('.ai-dialog [role="alert"]');
  check('a refusal is explained and nothing changes', (await page.locator('.ai-dialog [role="alert"]').textContent()).includes('отказалась'));
  await page.click('.ai-dialog >> button:has-text("Закрыть")');

  // --- translation into a separate script
  await page.click('.sp-head .ai-btn');
  await page.click('.menu-item:has-text("Перевести на английский")');
  await page.waitForSelector('.ai-script-preview');
  check('the translation is previewed in script form', (await page.locator('.ai-script-preview p[data-kind="scene"]').first().textContent()) === 'INT. LIGHTHOUSE — NIGHT' && (await page.isVisible('.ai-dialog >> text=Переведено строк: 10.')), `${await page.locator('.ai-script-preview p[data-kind="scene"]').first().textContent()} / ${await page.locator('.ai-dialog .modal-body p').first().textContent()}`);
  await page.screenshot({ path: `${OUT}/104-ai-translation.png` });
  await page.click('.ai-dialog >> button:has-text("Сохранить отдельным сценарием")');
  await page.click('.sp-head >> text=К доске');
  const translated = page.locator('.layer .el', { hasText: 'North Wind' });
  check('the translation is a separate script; the original is untouched', (await translated.count()) === 1 && (await page.locator('.layer .el', { hasText: 'Северный ветер' }).count()) >= 1);
  await translated.dblclick();
  await page.waitForSelector('.sp-overlay .sp-rt');
  check('it uses the Hollywood page format', (await page.locator('.sp-select').inputValue()) === 'hollywood' && (await page.locator('.sl[data-kind="scene"]').first().textContent()) === 'INT. LIGHTHOUSE — NIGHT');
  await page.click('.sp-head >> text=К доске');

  check('money spent is counted', await page.evaluate(() => JSON.parse(localStorage.getItem('zadum.ai')).spent > 0));
},
// The rate-limit answer is provoked on purpose.
{ ignoreErrors: [/status of 429/] });

process.exit(failed ? 1 : 0);
