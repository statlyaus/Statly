import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('team action drop lifecycle', () => {
  it('drops roster ownership while leaving a pending waiver hold', () => {
    const source = readRepoFile('src/app/api/leagues/[id]/actions/[userId]/route.ts');

    expect(source).toContain('processDropPlayerAction(action.id)');
    expect(source).toContain('actionType === \'DROP_PLAYER\'');
    expect(source).toContain('leagueRosterPlayer.deleteMany');
    expect(source).toContain("status: 'PENDING'");
    expect(source).toContain('WaiverAvailabilityProjectionService');
  });
});
