// AI on boards: ask the boards (an agent with tools), summary, columns, labels, picture descriptions.
// The model is played by e2e/aiMock.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OUT, runSuite } from './harness.mjs';
import { lastUserText, mockAi, wants } from './aiMock.mjs';

const PICTURE = readFileSync(path.resolve('e2e/fixtures/location.png')).toString('base64');

async function dropPicture(page, x, y) {
  const dt = await page.evaluateHandle(async (b64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'пирс.png', { type: 'image/png' }));
    return data;
  }, PICTURE);
  const target = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x, y });
  for (const type of ['dragenter', 'dragover', 'drop']) await target.dispatchEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true });
}

/** ids of the cards a request lists as "[id] заметка: text", by a word of their text. */
const idsOf = (body) => Object.fromEntries([...JSON.stringify(body.messages).matchAll(/\[([\w-]{6,})\] заметка[^:]*: ([^\\"\[]+)/g)].map((m) => [m[2].trim().split(/[\s:,.]/)[0], m[1]]));

const failed = await runSuite('ai: boards', 4344, async ({ page, check }) => {
  const ai = await mockAi(page, {
    answer: (body) => {
      const kind = wants(body);
      const ids = idsOf(body);
      if (kind === 'groups') return { json: { groups: [{ title: 'Съёмка', ids: [ids['Свет'], ids['Кран'], 'ghost'] }, { title: 'Монтаж', ids: [ids['Музыка'], ids['Титры'], ids['Свет']] }] } };
      if (kind === 'labels') return { json: { labels: [{ name: 'Съёмка', ids: [ids['Свет'], ids['Кран']] }, { name: 'Пост', ids: [ids['Музыка'], ids['Титры']] }] } };
      if (kind === 'description') return { json: { description: 'Деревянный пирс на рассвете, туман над водой', text: 'PIER 7' } };
      if (body.tools?.length) {
        const results = JSON.stringify(body.messages);
        if (!results.includes('tool_result')) return { text: 'Ищу.', toolUses: [{ id: 'tu_1', name: 'search_cards', input: { query: 'свет ночь' } }] };
        const found = /\[([\w-]{6,})\] заметка на доске/.exec(results)?.[1];
        return { text: `Про свет есть заметка: ставим тёплый практический свет [[${found}]]. Больше ничего не нашлось [[nope]].` };
      }
      return { text: lastUserText(body).includes('сводку') ? '## Главное\n\nГотовимся к съёмке ролика.\n\n## Что сделать дальше\n\n- Заказать кран\n- Выбрать музыку' : 'Готово.' };
    },
  });

  // --- notes to work on
  const texts = ['Свет: тёплый практический для ночных сцен', 'Кран нужен на два дня', 'Музыка без слов, фортепиано', 'Титры в конце, белым по чёрному'];
  for (let i = 0; i < texts.length; i++) {
    await page.mouse.dblclick(760 + (i % 2) * 330, 420 + Math.floor(i / 2) * 150);
    await page.keyboard.type(texts[i]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  const note = (t) => page.locator('.layer .note', { hasText: t });
  check('four notes are on the board', (await page.locator('.layer .note').count()) === 5);

  // --- ask the boards
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Спросить доски")');
  await page.fill('.ai-ask', 'Какой свет мы ставим ночью?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ai-dialog >> text=будет отправлено');
  check('asking explains that only what the AI finds is sent', await page.isVisible('.ai-dialog >> text=те карточки, которые ИИ найдёт'));
  await page.click('.ai-dialog >> button:has-text("Отправить")');
  await page.waitForSelector('.ai-answer a');
  check('the model searched the boards with a tool before answering', ai.messages.length === 2 && ai.messages[0].body.tools.length === 4 && JSON.stringify(ai.messages[1].body.messages).includes('Свет: тёплый практический'));
  check('the tool was offered, not forced, and no conversation is kept on the provider side', !ai.messages[0].body.tool_choice && !ai.messages[0].body.thread);
  check('the answer links to the card it used and drops made-up references', (await page.locator('.ai-answer a').count()) === 1 && !(await page.locator('.ai-answer').textContent()).includes('nope'));
  await page.screenshot({ path: `${OUT}/110-ai-ask.png` });
  await page.click('.ai-answer a');
  check('the link opens the card', (await page.locator('.ai-dialog').count()) === 0 && (await page.locator('.layer .note.selected', { hasText: 'Свет: тёплый' }).count()) === 1);

  // a follow-up carries the conversation
  await page.keyboard.press('Escape');
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Спросить доски")');
  await page.fill('.ai-ask', 'Что по свету?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ai-ask-form input');
  const before = ai.messages.length;
  await page.fill('.ai-ask-form input', 'А подробнее?');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelector('.ai-question')?.textContent === 'А подробнее?' && !!document.querySelector('.ai-answer a'), before);
  check('a follow-up question carries the earlier answer', ai.messages[before].body.messages.length === 3 && ai.messages[before].body.messages[1].role === 'assistant');
  await page.click('.ai-dialog >> button:has-text("Закрыть")');

  // --- summary of the board, saved as a document
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Сводка доски")');
  await page.waitForSelector('.ai-answer h2');
  const summary = ai.messages.at(-1).body;
  check('the board goes as cached material with card ids', summary.messages[0].content[0].cache_control?.type === 'ephemeral' && /\[[\w-]{6,}\] заметка: Кран нужен/.test(summary.messages[0].content[0].text));
  await page.click('.ai-dialog >> button:has-text("Документом на доску")');
  check('the summary becomes a document on the board', (await page.locator('.layer .el', { hasText: 'Сводка · Главная' }).count()) === 1);
  await page.keyboard.press('Control+z');

  // --- arrange notes into columns
  await page.keyboard.press('Escape');
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Разложить заметки по колонкам")');
  await page.waitForSelector('.ai-group-title');
  check('columns are proposed with each note once', (await page.locator('.ai-group-title').count()) === 2 && (await page.locator('.ai-group-notes li').count()) === 4);
  await page.locator('.ai-group-title').first().fill('Площадка');
  await page.screenshot({ path: `${OUT}/111-ai-columns.png` });
  await page.click('.ai-dialog >> button:has-text("Разложить")');
  check('notes move into the new columns', (await page.locator('.layer .column', { hasText: 'Площадка' }).locator('.note').count()) === 2 && (await page.locator('.layer .column', { hasText: 'Монтаж' }).locator('.note').count()) === 2);
  await page.keyboard.press('Control+z');
  check('one undo puts everything back', (await page.locator('.layer .column').count()) === 0 && (await page.locator('.layer .note').count()) === 5);

  // --- labels
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Предложить метки")');
  await page.waitForSelector('.ai-check-list');
  check('labels are proposed with the cards they go on', (await page.locator('.ai-check-list > li').count()) === 2 && (await page.locator('.ai-check-list > li').first().textContent()).includes('новая'));
  await page.click('.ai-dialog >> button:has-text("Поставить метки (2)")');
  check('accepted labels appear on the notes', (await note('Кран нужен').locator('.label-chip', { hasText: 'Съёмка' }).count()) === 1 && (await note('Титры').locator('.label-chip', { hasText: 'Пост' }).count()) === 1);
  await page.keyboard.press('Control+z');
  check('and one undo takes them off', (await page.locator('.layer .label-chip').count()) === 0);
  await page.keyboard.press('Control+Shift+z');

  // --- a picture described for search
  await dropPicture(page, 1150, 760);
  await page.waitForSelector('.layer .media-card img');
  await page.keyboard.press('Escape');
  await page.click('.topbar [aria-label="ИИ"]');
  await page.click('.menu-item:has-text("Описать картинку")');
  await page.waitForSelector('.ai-check-list');
  const picture = ai.messages.at(-1).body.messages[0].content.find((b) => b.type === 'image');
  check('the picture is sent as a small JPEG', picture?.source.media_type === 'image/jpeg' && picture.source.data.length > 100 && picture.source.data.length < 200_000);
  check('the description and the text on the picture are shown', (await page.locator('.ai-check-list').textContent()).includes('Деревянный пирс') && (await page.locator('.ai-check-list').textContent()).includes('PIER 7'));
  await page.click('.ai-dialog >> button:has-text("Сохранить описания")');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('туман');
  await page.waitForTimeout(300);
  check('search now finds the picture by what is on it', (await page.locator('.search-panel mark', { hasText: 'туман' }).count()) === 1, await page.locator('.search-results').textContent());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('pier 7');
  await page.waitForTimeout(300);
  check('and by the text read from it', (await page.locator('.search-panel mark', { hasText: 'PIER 7' }).count()) === 1, await page.locator('.search-results').textContent());
  await page.keyboard.press('Escape');
});

process.exit(failed ? 1 : 0);
