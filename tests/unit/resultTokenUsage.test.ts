import { describe, expect, it } from 'vitest';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The loss token is a white fill, so `text-result-loss` on a page is invisible, and an error or a
// success riding on a result token changes colour with the results. Result utilities and
// `var(--result-*)` are spelled only in the `resultTone` and `resultFill` recipes, and the win, loss
// and draw badge tones are used only where a real W, L or D is shown
// (docs/product/style-guide.md, "Colour roles").
const RECIPES = 'src/components/ui/controlStyles.ts';
// The development style guide lists every colour token by name and shows each as a swatch.
const STYLE_GUIDE = 'src/app/dev/styleguide/page.tsx';
const RESULT_BADGES = new Set([RECIPES, 'src/components/MatchLogTable.tsx']);
const RESULT_TOKEN = /(?:--|-)result-(?:win|loss|draw)\b/;
const RESULT_BADGE_TONE = /\btone:[^,}\n]*'(?:win|loss|draw)'/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles('src').map((file) => ({ file, text: readFileSync(file, 'utf8') }));

describe('result token usage', () => {
  it('spells result tokens only in the result recipes', () => {
    const offenders = sources
      .filter(
        ({ file, text }) => file !== RECIPES && file !== STYLE_GUIDE && RESULT_TOKEN.test(text)
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('uses the win, loss and draw badge tones only for real results', () => {
    const offenders = sources
      .filter(({ file, text }) => !RESULT_BADGES.has(file) && RESULT_BADGE_TONE.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
