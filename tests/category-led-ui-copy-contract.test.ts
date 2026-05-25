import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const fantasyUiFiles = [
  'src/app/(public)/page.tsx',
  'src/components/ModularDashboard.tsx',
  'src/components/dashboard/TopPicksModule.client.tsx',
  'src/components/dashboard/NineCategoryDisplay.tsx',
];

const forbiddenVisiblePhrases = [
  'Top Picks This Round',
  'Total Points',
  'Avg Points',
  'Total Value',
  'market value',
  'player price',
  'player salary',
];

const forbiddenProductTerms = [
  /\bbuy(?:ing)?\b/i,
  /\bprice(?:s|d)?\b/i,
  /\bsalar(?:y|ies)\b/i,
  /\bbudget\b/i,
  /\bmarket value\b/i,
  /\btotal score\b/i,
  /\btotal points\b/i,
];

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('category-led fantasy UI copy contract', () => {
  it('does not expose player buying, pricing, salary, or total-score framing in refreshed fantasy surfaces', () => {
    const combinedSource = fantasyUiFiles.map(readRepoFile).join('\n');

    for (const phrase of forbiddenVisiblePhrases) {
      expect(combinedSource, `Unexpected visible phrase: ${phrase}`).not.toContain(phrase);
    }

    for (const term of forbiddenProductTerms) {
      expect(combinedSource, `Unexpected product framing: ${term}`).not.toMatch(term);
    }
  });

  it('anchors refreshed fantasy surfaces around drafted rosters, trades, waivers, and selected categories', () => {
    const combinedSource = fantasyUiFiles.map(readRepoFile).join('\n');

    expect(combinedSource).toContain('Draft');
    expect(combinedSource).toContain('trade');
    expect(combinedSource).toContain('waiver');
    expect(combinedSource).toContain('category');
  });
});
