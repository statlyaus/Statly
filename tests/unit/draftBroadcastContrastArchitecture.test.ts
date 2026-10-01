import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The draft room palette is light: --draft-broadcast-text is dark, while the solid action (navy)
// and success (green) fills are dark too. Text on those fills must use the solid-text token.
const draftFiles = [
  ...readdirSync(join(process.cwd(), 'src/components/draft'))
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map((name) => `src/components/draft/${name}`),
  'src/components/LivePickHeader.tsx',
  'src/components/DraftWatchlist.tsx',
  'src/components/PickFeed.tsx',
];

const solidFill = /bg-\[color:var\(--draft-broadcast-(red|green)\)\]/;
const darkText = /text-\[color:var\(--draft-broadcast-text\)\]/;

describe('draft room contrast on solid fills', () => {
  it.each(draftFiles)('%s never puts the dark text token on a solid navy or green fill', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    const classStrings = [...source.matchAll(/(["'`])([^"'`\n]*draft-broadcast[^"'`\n]*)\1/g)].map(
      (match) => match[2]
    );

    expect(classStrings.filter((value) => solidFill.test(value) && darkText.test(value))).toEqual(
      []
    );
  });
});
