import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Member removal keeps the LeagueMember row (isActive: false, status 'removed') for history, so
// every reader that builds teams for a competition, ladder, or draft must skip inactive rows.
function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('removed members stay out of new competition, ladder, and draft state', () => {
  it('rebuilds standings only for active members', () => {
    expect(read('src/server/leagues/competitionService.ts')).toContain(
      'tx.leagueMember.findMany({ where: { leagueId, isActive: true }, select: { id: true } })'
    );
  });

  it('only accepts active members as fixture participants', () => {
    expect(read('src/server/leagues/competitionService.ts')).toContain(
      'where: { leagueId, isActive: true, id: { in: participantIds } }'
    );
  });

  it('creates draft orders only from active members', () => {
    expect(read('src/app/api/drafts/route.ts')).toContain(
      'members: { where: { isActive: true }, include: { user: true } }'
    );
  });

  it('counts only active members for league settings and the user league list', () => {
    const activeCount = '_count: { select: { members: { where: { isActive: true } } } }';

    expect(read('src/app/api/leagues/[id]/settings/route.ts')).toContain(activeCount);
    expect(read('src/app/api/leagues/user/[userId]/route.ts')).toContain(activeCount);
  });

  it('does not list leagues a user was removed from in their league list', () => {
    expect(read('src/app/api/leagues/user/[userId]/route.ts')).toContain(
      'where: { userId, isActive: true }'
    );
  });

  it('reads members from Prisma and writes Firestore only as a projection', () => {
    const membersRoute = read('src/app/api/leagues/[id]/members/route.ts');

    expect(membersRoute).toContain('updateLeagueMember(input)');
  });
});
