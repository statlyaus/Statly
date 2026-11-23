import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('team action drop lifecycle', () => {
  it('drops roster ownership while leaving a pending waiver hold', () => {
    const source = readRepoFile('src/app/api/leagues/[id]/actions/[userId]/route.ts');
    // The roster delete and the waiver hold live in the drop helper the route and add-and-drop share.
    const dropHelper = readRepoFile('src/server/rosters/rosterDrop.ts');

    expect(source).toContain('prisma.$transaction(async (tx)');
    expect(source).toContain('dropRosterPlayerInTransaction(tx,');
    expect(dropHelper).toContain('tx.leagueRosterPlayer.deleteMany');
    expect(dropHelper).toContain('tx.teamAction.create');
    expect(source).toContain('projectCommittedDrop(');
    expect(source).not.toContain("status: 'REJECTED'");
    expect(source).toContain("actionType !== 'DROP_PLAYER'");
    expect(source).toContain("status: 'PENDING'");
    expect(source).toContain('WaiverAvailabilityProjectionService');
  });
});
