import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The public draft hub's tables use the shared table recipe (style guide, "Tables"; ticket 14a), so
// their rows, rules and number columns cannot drift apart again.
const publicTables = [
  'src/components/draft/AflDraftHistoryExplorer.tsx',
  'src/components/draft/DraftClubTradeHistory.tsx',
  'src/components/draft/DraftClubsDirectory.tsx',
  'src/components/draft/DraftTradeDetail.tsx',
];

describe('public tables', () => {
  it.each(publicTables)('%s builds every table from tableStyles', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    const tables = source.match(/<table\b[^>]*>/gu) ?? [];

    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toContain('tableStyles.table');
    expect(source).not.toMatch(/\[&_t[hd]\]/u);
    // Every header and cell takes its classes from the recipe; nothing centred, no stripes.
    for (const cell of source.match(/<t[hd]\b[^>]*>/gu) ?? [])
      expect(cell).toContain('tableStyles.');
    expect(source).not.toMatch(/\b(?:odd|even):|text-center[^\n]*<\/t[hd]>/u);
  });
});
