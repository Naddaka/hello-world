import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** macOS file systems ignore case: two files that differ only in case are one file there, and the build breaks. */
describe('source file names', () => {
  it('never differ only in the case of their letters', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(path.resolve('src'));
    walk(path.resolve('e2e'));
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      // "Markdown.tsx" and "markdown.ts" also clash: imports name files without the extension.
      const key = file.toLowerCase().replace(/\.(tsx?|mjs|js)$/, '');
      if (seen.has(key)) clashes.push(`${seen.get(key)} ↔ ${file}`);
      seen.set(key, file);
    }
    expect(clashes).toEqual([]);
  });
});
