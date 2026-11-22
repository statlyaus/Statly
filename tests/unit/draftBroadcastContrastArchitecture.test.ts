import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The draft room uses the core roles: ink text (foreground) is dark, and so are the cobalt action
// (brand-bar) and success fills. Text on those fills must use brand-bar-foreground.
const draftFiles = [
  ...readdirSync(join(process.cwd(), 'src/components/draft'))
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map((name) => `src/components/draft/${name}`),
  'src/components/LivePickHeader.tsx',
  'src/components/DraftWatchlist.tsx',
  'src/components/PickFeed.tsx',
];

const solidFill = /\bbg-(brand-bar|success)(?![-\w])/;
const darkText = /\btext-foreground(?![-\w])/;

describe('draft room contrast on solid fills', () => {
  it.each(draftFiles)('%s never puts ink text on a solid cobalt or green fill', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    const classStrings = [
      ...source.matchAll(/(["'`])([^"'`\n]*bg-(?:brand-bar|success)[^"'`\n]*)\1/g),
    ].map((match) => match[2]);

    expect(classStrings.filter((value) => solidFill.test(value) && darkText.test(value))).toEqual(
      []
    );
  });
});
