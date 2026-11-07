// Stage 1b: images, files and audio dropped on the canvas, links and embeds.
import { OUT, runSuite } from './harness.mjs';

/** Dispatches a browser file drop at a point, with files built inside the page. */
async function dropFiles(page, x, y, kinds) {
  await page.evaluate(
    async ({ x, y, kinds }) => {
      const files = [];
      for (const kind of kinds) {
        if (kind === 'png') {
          const c = document.createElement('canvas');
          c.width = 640;
          c.height = 360;
          const g = c.getContext('2d');
          g.fillStyle = '#33476B';
          g.fillRect(0, 0, 640, 360);
          g.fillStyle = '#F4B183';
          g.beginPath();
          g.arc(460, 130, 46, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#1F2B42';
          g.fillRect(0, 250, 640, 110);
          files.push(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'синий-час.png', { type: 'image/png' }));
        } else if (kind === 'wav') {
          const rate = 8000, n = rate;
          const buf = new ArrayBuffer(44 + n * 2);
          const v = new DataView(buf);
          const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
          w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
          v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
          for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 440) * 8000, true);
          files.push(new File([buf], 'ветер.wav', { type: 'audio/wav' }));
        } else {
          files.push(new File(['Смета клипа'], 'смета.txt', { type: 'text/plain' }));
        }
      }
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      const target = document.elementFromPoint(x, y);
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    },
    { x, y, kinds },
  );
}

async function pasteText(page, text) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

const failed = await runSuite('stage 1b', 4332, async ({ page, check }) => {
  await dropFiles(page, 760, 520, ['png']);
  await page.waitForSelector('.media-card img');
  const size = await page.locator('.media-card img').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  check('a dropped image becomes an image card at its proportions', size[0] === 640 && size[1] === 360, size.join('×'));

  await dropFiles(page, 1100, 520, ['wav', 'txt']);
  await page.waitForSelector('.file-card audio');
  check('a dropped audio file gets a player', (await page.locator('.file-card audio').count()) === 1);
  check('any other file becomes a file card with name and size', await page.isVisible('.file-card .file-name:has-text("смета.txt")'));

  // caption from the context menu
  await page.locator('.media-card', { has: page.locator('img') }).click({ button: 'right' });
  await page.click('.ctxmenu >> text=Подпись');
  await page.keyboard.type('Синий час над заливом');
  await page.keyboard.press('Enter');
  check('an image can get a caption', await page.isVisible('figcaption:has-text("Синий час над заливом")'));

  // paste a YouTube link
  await page.mouse.move(500, 700);
  await page.mouse.click(500, 700);
  await pasteText(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.waitForSelector('.link-card');
  check('a pasted link becomes a link card', await page.isVisible('.link-card .link-site:has-text("youtube.com")'));
  await page.click('.link-card .play');
  const iframe = await page.locator('.link-card iframe').getAttribute('src');
  check('a YouTube link plays in the card', iframe?.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), iframe);

  // link from the toolbar
  await page.locator('.tool', { hasText: 'Ссылка' }).click();
  await page.waitForSelector('.url-input');
  await page.keyboard.type('vimeo.com/76979871');
  await page.keyboard.press('Enter');
  check('the Link tool asks for an address and creates the card', await page.isVisible('.link-card .link-title:has-text("vimeo.com")'));
  await page.locator('.tool', { hasText: 'Ссылка' }).click();
  await page.waitForSelector('.url-input');
  await page.keyboard.press('Escape');
  check('an abandoned empty link card disappears', (await page.locator('.link-card').count()) === 2);

  await page.mouse.click(1350, 820);
  await page.keyboard.press('z');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/20-media-light.png` });

  // everything is still there after a reload (files kept in local storage)
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.media-card img');
  const reloaded = await page.locator('.media-card img').evaluate((img) => img.complete && img.naturalWidth);
  check('images are stored locally and survive a reload', reloaded === 640);
  check('search finds files and links by name', await (async () => {
    await page.keyboard.press('Control+f');
    await page.keyboard.type('смета');
    const ok = await page.isVisible('.search-item:has-text("смета.txt")');
    await page.keyboard.press('Escape');
    return ok;
  })());
  await page.keyboard.press('Control+Shift+d');
  await page.screenshot({ path: `${OUT}/21-media-dark.png` });
});

process.exit(failed ? 1 : 0);
