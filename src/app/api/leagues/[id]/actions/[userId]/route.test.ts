import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  verifyLeagueMembership: vi.fn(),
  leagueMemberFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueRosterPlayerFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  resolveCanonicalPlayerIds: vi.fn(),
  optimizeMemberLineup: vi.fn(),
  projectLeague: vi.fn(),
  revalidateTag: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: mocks.verifyLeagueMembership,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMember: { findFirst: mocks.leagueMemberFindFirst },
    league: { findUnique: mocks.leagueFindUnique },
    leagueRosterPlayer: { findFirst: mocks.leagueRosterPlayerFindFirst },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
  },
}));

vi.mock('@/lib/cacheTags', () => ({
  tags: {
    league: (leagueId: string) => `league-${leagueId}`,
    waivers: (leagueId: string) => `waivers-${leagueId}`,
  },
}));

vi.mock('next/cache', () => ({
  revalidateTag: mocks.revalidateTag,
}));

vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerIds: mocks.resolveCanonicalPlayerIds,
}));

vi.mock('@/server/leagues/lineupOptimizationService', () => ({
  optimizeMemberLineup: mocks.optimizeMemberLineup,
}));

vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = mocks.projectLeague;
  },
}));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'league-1', userId: 'user-1' }) };

function postAction(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/leagues/league-1/actions/user-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
  mocks.verifyLeagueMembership.mockResolvedValue({ isMember: true, memberDocId: 'member-1' });
  mocks.leagueMemberFindFirst.mockResolvedValue({ id: 'member-1' });
  mocks.resolveCanonicalPlayerIds.mockResolvedValue(new Map());
});

describe('team action creation for lineup optimisation', () => {
  it('runs optimisation as a direct command and creates no queued action row', async () => {
    mocks.optimizeMemberLineup.mockResolvedValue({
      ok: true,
      round: 4,
      activeProjectedValue: 141,
      promotedPlayerIds: ['player-2'],
      demotedPlayerIds: ['player-9'],
      unchangedPlayerIds: ['player-1'],
    });

    const response = await POST(postAction({ actionType: 'OPTIMIZE_LINEUP', details: {} }), params);
    const body = await response.json();

    expect(mocks.optimizeMemberLineup).toHaveBeenCalledWith({
      leagueId: 'league-1',
      memberId: 'member-1',
    });
    expect(response.status).toBe(200);
    expect(body.data.action).toMatchObject({ actionType: 'OPTIMIZE_LINEUP', status: 'PROCESSED' });
    expect(body.data.optimization).toMatchObject({ round: 4, activeProjectedValue: 141 });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('surfaces the command failure instead of reporting a queued success', async () => {
    mocks.optimizeMemberLineup.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'This round is locked.',
    });

    const response = await POST(postAction({ actionType: 'OPTIMIZE_LINEUP', details: {} }), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.message).toBe('This round is locked.');
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});
