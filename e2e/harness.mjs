// Shared setup for end-to-end checks: serves the production build and drives
// it in Chromium with the Playwright installed on the machine.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));

export const OUT = path.resolve('e2e/out');

/**
 * The packaged app's Content Security Policy. Pages are served with it so the
 * checks fail where the desktop app would (e.g. a fetch the CSP forbids).
 */
export const CSP = JSON.parse(readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;

/**
 * Runs `scenario` against a fresh app and exits with a non-zero code if any check failed.
 * `ignoreErrors` lists console messages the scenario provokes on purpose.
 */
export async function runSuite(name, port, scenario, { ignoreErrors = [] } = {}) {
  mkdirSync(OUT, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !ignoreErrors.some((re) => re.test(m.text())) && errors.push(m.text()));
    await page.route(`http://localhost:${port}/`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
    });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('text=Добро пожаловать в Zadum');
    await scenario({ page, check });
    check('no errors in the browser console', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (error) {
    check(`${name} scenario ran to the end`, false, String(error).split('\n').slice(0, process.env.E2E_VERBOSE ? 12 : 1).join('\n'));
  } finally {
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${name}: ${results.length - failed}/${results.length} checks passed`);
  return failed;
}

/** Drags from one point to another with intermediate moves, like a person would. */
export async function drag(page, from, to, opts = {}) {
  await page.mouse.move(from.x, from.y);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

/** Drags a toolbar tool to a point on the canvas. */
export async function dragTool(page, label, to) {
  const box = await page.locator('.tool', { hasText: label }).boundingBox();
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to);
}

export const centre = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
