// Builds the board icon data from npm packages (run after updating them):
//   node scripts/build-icon-data.mjs
// - Lucide icons (ISC licence, https://lucide.dev) with their English tags;
// - emoji with Russian names and tags from Emojibase (MIT licence).
import { readFileSync, writeFileSync } from 'node:fs';

const nodes = JSON.parse(readFileSync('node_modules/lucide-static/icon-nodes.json', 'utf8'));
const tags = JSON.parse(readFileSync('node_modules/lucide-static/tags.json', 'utf8'));
const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
const icons = Object.keys(nodes)
  .sort()
  .map((name) => [name, nodes[name].map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join(''), (tags[name] ?? []).join(' ')]);
writeFileSync('src/icons/lucide.json', JSON.stringify(icons));

const groups = JSON.parse(readFileSync('node_modules/emojibase-data/ru/messages.json', 'utf8')).groups;
const emoji = JSON.parse(readFileSync('node_modules/emojibase-data/ru/compact.json', 'utf8'))
  // No skin-tone parts, no regional letters (group 2 and ungrouped).
  .filter((e) => e.group !== undefined && e.group !== 2)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => [e.unicode, e.label, (e.tags ?? []).join(' '), e.group]);
writeFileSync('src/icons/emoji-ru.json', JSON.stringify({ groups: groups.map((g) => g.message), emoji }));

console.log(`${icons.length} icons, ${emoji.length} emoji`);
