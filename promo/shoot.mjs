import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const langs = ['ua','en','ru','de','pl','fr','es','tr','az','ar'];
const b = await chromium.launch({ args:['--ignore-certificate-errors-spki-list=KnP1OnzHv/y42eRQmbGwoYTHcSJF448m6CU5mdngwKk='] });
for (const l of langs) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  await ctx.addInitScript(l => localStorage.setItem('naddaka-lang', l), l);
  const p = await ctx.newPage();
  await p.goto('https://naddaka.com/', { waitUntil:'networkidle', timeout:60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path:`assets/shots/${l}.png` });
  await p.screenshot({ path:`assets/shots/${l}-full.png`, fullPage:true });
  console.log(l, await p.evaluate(()=>document.documentElement.lang), await p.evaluate(()=>document.querySelector('h1')?.innerText));
  await ctx.close();
}
await b.close();
