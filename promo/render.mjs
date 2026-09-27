// Renders index.html frame-by-frame with headless Chromium.
// usage: node render.mjs frames <outDir> [fps] [workers]   |   node render.mjs stills <outDir> t1 t2 ...
// Set CUT=story for the 15 s Instagram Stories edit (times are then story times).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';
import path from 'path';
const [mode, out, ...rest] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve('index.html') + (process.env.CUT === 'story' ? '?story' : '');
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
async function page() {
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('PAGEERROR', e.message));
  await p.goto(url); await p.evaluate(() => window.ready); return p;
}
if (mode === 'stills') {
  const p = await page();
  for (const t of rest) { await p.evaluate(t => renderOut(t), +t); await p.screenshot({ path: `${out}/t${(+t).toFixed(2)}.jpg`, quality: 85 }); }
} else {
  const fps = +(rest[0] || 30), W = +(rest[1] || 4);
  const p0 = await page(); const dur = await p0.evaluate(() => OUT_DURATION); await p0.close();
  const N = Math.round(dur * fps); let next = 0, done = 0;
  await Promise.all(Array.from({ length: W }, async () => {
    const p = await page();
    while (next < N) { const f = next++; await p.evaluate(t => renderOut(t), f / fps);
      await p.screenshot({ path: `${out}/f${String(f).padStart(5, '0')}.jpg`, quality: 94 });
      if (++done % 60 === 0) console.log(`${done}/${N}`); }
  }));
}
await b.close();
