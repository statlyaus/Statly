#!/usr/bin/env node
// Counts hand-styled buttons in product source (ticket 14c): a <button> whose own classes paint a
// filled or outlined control (a token background plus padding, rounding or a border) instead of
// using a shared recipe from src/components/ui/controlStyles.ts (buttonStyles, chipStyles,
// menuItemStyles). Icon buttons, list rows and segmented bars without those classes are not counted.
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
const FILL =
  /\bbg-(?:primary|secondary|destructive|card|background|muted|brand-bar|success|warning|accent)\b/;
const SHAPE = /\b(?:px-|py-|rounded|border)/;

/** Counts <button> opening tags in one file that hand-paint a control. */
export function countBareButtons(source) {
  let count = 0;
  for (const match of source.matchAll(/<button\b/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    const tag = source.slice(match.index, end);
    if (!RECIPE.test(tag) && FILL.test(tag) && SHAPE.test(tag)) count++;
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
    `${rows.reduce((sum, [, count]) => sum + count, 0)} bare buttons in ${rows.length} files`
  );
}
