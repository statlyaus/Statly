import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const publicRuntimeFiles = [
  'src/lib/draftTrades/read.ts',
  'src/server/aflTradeIntelligence/runtime/publicReadRuntime.ts',
  'src/app/(public)/draft/trades/page.tsx',
  'src/app/(public)/draft/trades/[tradeId]/page.tsx',
  'src/app/(public)/draft/clubs/[clubSlug]/page.tsx',
  'src/app/(public)/draft/outcomes/page.tsx',
] as const;

describe('AFL trade workbook retirement', () => {
  it('keeps workbook code outside every public request-time composition', () => {
    for (const relativePath of publicRuntimeFiles) {
      const source = readFileSync(join(repositoryRoot, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/developmentWorkbook|DevelopmentWorkbook/);
    }
  });
});
