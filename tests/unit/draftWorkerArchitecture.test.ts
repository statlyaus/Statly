import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('draft worker Firestore architecture', () => {
  it('handles roster creates and syncs ownership from canonical rosters', () => {
    const source = readFileSync(join(process.cwd(), 'functions/src/draftWorker.ts'), 'utf8');

    expect(source).toMatch(
      /firestore\.document\('leagues\/\{leagueId\}\/rosters\/\{teamId\}'\)[\s\S]*?\.onWrite/
    );
    expect(source).toContain('syncRosterOwnershipForLeague');
    expect(source).toMatch(/collection\('playerOwnerships'\)/);
  });
});
