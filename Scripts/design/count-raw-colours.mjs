#!/usr/bin/env node
// Counts hardcoded colours in product source so the token clean-up can be tracked file by file.
// Colours belong in the design tokens defined in src/index.css (bg-card, text-muted-foreground,
// border-border, text-primary, result-win, status-live, ...). This reports what is left:
//   - raw Tailwind palette classes such as text-gray-500, bg-blue-600/40, border-white
//   - hex literals such as #fff or bg-[#0f2a44]
//   - rgb(), rgba(), hsl() and hsla() literals
//
// Usage:
//   node Scripts/design/count-raw-colours.mjs            # every file under src/, worst first
//   node Scripts/design/count-raw-colours.mjs --top 15   # only the 15 worst files
//   node Scripts/design/count-raw-colours.mjs --json     # machine-readable output
//   node Scripts/design/count-raw-colours.mjs src/components/stats/PlayerComparison.tsx
//
// Test files and stylesheets are skipped: src/index.css is where the tokens are defined.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY =
  'bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|decoration|placeholder|caret|accent|shadow';

export const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITY})-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?:\\/\\d+)?(?![\\w-])`,
  'g'
);
// A hex colour starts a string, class or value; "#734" in an issue reference after prose is not one.
export const HEX_LITERAL =
  /(?<=["'`[(\s:,=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
export const FUNCTION_LITERAL = /(?<![a-zA-Z-])(?:rgba?|hsla?)\(/g;

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const SOURCE_FILE = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;

/** Counts raw colours in one file's source, ignoring whole-line comments. */
export function countRawColours(source) {
  const counts = { palette: 0, hex: 0, functions: 0 };
  for (const line of source.split('\n')) {
    if (COMMENT_LINE.test(line)) continue;
    counts.palette += (line.match(PALETTE_CLASS) ?? []).length;
    counts.hex += (line.match(HEX_LITERAL) ?? []).length;
    counts.functions += (line.match(FUNCTION_LITERAL) ?? []).length;
  }
  return { ...counts, total: counts.palette + counts.hex + counts.functions };
}

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : listSourceFiles(path);
    }
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function main(argv) {
  const json = argv.includes('--json');
  const topIndex = argv.indexOf('--top');
  const top = topIndex === -1 ? Infinity : Number(argv[topIndex + 1]);
  const paths = argv.filter(
    (arg, index) => !arg.startsWith('--') && (topIndex === -1 || index !== topIndex + 1)
  );
  const root = process.cwd();
  const files = (paths.length > 0 ? paths : ['src']).flatMap((path) =>
    statSync(path).isDirectory() ? listSourceFiles(path) : [path]
  );

  const rows = files
    .map((path) => ({ file: relative(root, path), ...countRawColours(readFileSync(path, 'utf8')) }))
    .filter((row) => row.total > 0 || paths.length > 0)
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  if (json) {
    console.log(JSON.stringify({ total, files: rows.length, rows: rows.slice(0, top) }, null, 2));
    return;
  }
  for (const row of rows.slice(0, top)) {
    console.log(
      `${String(row.total).padStart(5)}  ${row.file}  (palette ${row.palette}, hex ${row.hex}, rgb/hsl ${row.functions})`
    );
  }
  console.log(`\n${total} raw colours in ${rows.length} files.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
