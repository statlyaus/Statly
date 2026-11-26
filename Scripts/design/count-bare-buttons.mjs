#!/usr/bin/env node
// Counts hand-styled buttons in product source (ticket 14c): a <button>, <a> or <Link> whose own
// classes paint a filled or outlined control (an unprefixed token background plus padding, rounding
// or a border width) instead of using a shared recipe from src/components/ui/controlStyles.ts
// (buttonStyles, chipStyles, menuItemStyles). Class strings held in a same-file constant count as
// the tag's own. Hover-only fills (icon buttons), plain text links and whole-card links (a link
// not sized like a button: no inline-flex or min-h) are not counted.
//
// Usage:
//   node Scripts/design/count-bare-buttons.mjs                   # every file, worst first
//   node Scripts/design/count-bare-buttons.mjs --write-baseline  # after a slice lowers counts
//
// Scripts/design/bare-button-baseline.json holds each file's count; tests/unit/sharedButtons
// fails when a file goes above it or a new file adds one. Lower it, never raise it.
import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSourceFiles } from './count-raw-colours.mjs';

const RECIPE = /\b(?:buttonStyles|chipStyles|menuItemStyles)\b/;
// Unprefixed only: `hover:bg-muted` on an icon button is not a painted control.
const FILL =
  /(?<![:\w-])bg-(?:primary|secondary|destructive|card|background|muted|brand-bar|success|warning|accent|foreground|field)\b/;
const SHAPE = /(?<![:\w-])(?:px-|py-|rounded|border(?:-\d|-\[|(?![\w-])))/;
// A link counts only when it is sized like a button; whole-card links are blocks.
const BUTTON_SIZED = /(?<![:\w-])(?:inline-flex|min-h-)/;
const CONSTANT = /\bconst\s+(\w+)\s*=\s*(['"`])([\s\S]*?)\2/g;

/** Counts opening tags in one file that hand-paint a control. */
export function countBareButtons(source) {
  const constants = [...source.matchAll(CONSTANT)].map(([, name, , text]) => ({
    name: new RegExp(`\\b${name}\\b`),
    text,
  }));
  let count = 0;
  for (const match of source.matchAll(/<(?:button|a|Link)\b/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    const own = source.slice(match.index, end);
    const tag = [
      own,
      ...constants.filter(({ name }) => name.test(own)).map(({ text }) => text),
    ].join(' ');
    const isLink = match[0] !== '<button';
    if (RECIPE.test(tag) || !FILL.test(tag) || !SHAPE.test(tag)) continue;
    if (isLink && !BUTTON_SIZED.test(tag)) continue;
    count++;
  }
  return count;
}

export const BASELINE_PATH = 'Scripts/design/bare-button-baseline.json';

export function countAll() {
  return Object.fromEntries(
    listSourceFiles('src')
      .filter((path) => path.endsWith('.tsx'))
      .map((path) => [relative(process.cwd(), path), countBareButtons(readFileSync(path, 'utf8'))])
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const counts = countAll();
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
  }
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);
  for (const [path, count] of rows) console.log(`${String(count).padStart(4)}  ${path}`);
  console.log(
    `${rows.reduce((sum, [, count]) => sum + count, 0)} bare buttons and button-like links in ${rows.length} files`
  );
}
