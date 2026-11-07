import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  countRawColours,
  FUNCTION_LITERAL,
  HEX_LITERAL,
  PALETTE_CLASS,
} from '../../Scripts/design/count-raw-colours.mjs';

// Files whose colours all come from the design tokens in src/index.css. Add a file here once its
// raw palette classes and colour literals are gone, so it cannot regress.
const tokenisedFiles = [
  'src/components/stats/PlayerComparison.tsx',
  'src/components/stats/PlayerStatsTable.tsx',
];

describe('design token colours', () => {
  it('counts raw palette classes, hex literals and rgb/hsl literals', () => {
    expect(
      countRawColours(
        [
          `<div className="text-gray-500 hover:bg-blue-600/40 dark:border-white bg-[#0f2a44]" />`,
          `const shadow = 'rgba(0, 0, 0, 0.5)';`,
          `// see #734 and text-red-600 in a comment`,
          `<div className="bg-card text-muted-foreground border-border bg-result-win/15" />`,
        ].join('\n')
      )
    ).toEqual({ palette: 3, hex: 1, functions: 1, total: 5 });
  });

  it.each(tokenisedFiles)('%s uses only design token colours', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');

    expect({
      palette: source.match(PALETTE_CLASS) ?? [],
      hex: source.match(HEX_LITERAL) ?? [],
      functions: source.match(FUNCTION_LITERAL) ?? [],
    }).toEqual({ palette: [], hex: [], functions: [] });
  });
});
