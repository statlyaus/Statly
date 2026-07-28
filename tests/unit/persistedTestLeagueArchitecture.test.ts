import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const canonicalRuntimeFiles = [
  'src/app/api/drafts/route.ts',
  'src/app/api/leagues/[id]/draft/route.ts',
  'src/app/api/leagues/[id]/draft-settings/route.ts',
  'src/app/api/leagues/[id]/settings/route.ts',
  'src/components/league/DraftManager.tsx',
  'src/hooks/useDraftManager.ts',
];

describe('persisted development league architecture', () => {
  it('keeps magic test league identity out of canonical runtime paths', () => {
    for (const file of canonicalRuntimeFiles) {
      expect(read(file), `${file} contains a magic league fixture`).not.toContain('test-league-id');
    }
  });

  it('retains the gated helper that creates real Prisma league records', () => {
    const helper = read('src/app/api/create-test-draft/route.ts');

    expect(helper).toContain('if (!isDevelopmentToolsEnabled())');
    expect(helper).toContain('developmentToolsNotFoundResponse()');
    expect(helper).toContain('tx.league.create');
    expect(helper).toContain('tx.draft.create');
    expect(helper).toContain('leagueId: league.id');
  });
});

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
