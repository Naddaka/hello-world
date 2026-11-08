import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** window.confirm/alert/prompt return immediately in the desktop web view; the app has its own dialog. */
describe('native dialogs', () => {
  it('are not used anywhere in the app', () => {
    const root = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const offenders = files.filter((f) => /\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(confirm|alert|prompt)\s*\(/m.test(readFileSync(f, 'utf8').replace(/confirmDialog\(/g, '')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
