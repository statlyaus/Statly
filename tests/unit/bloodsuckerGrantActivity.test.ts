/**
 * #1343 (BR-39, NFR-5): the Bloodsucker is told a bite exists. One league activity message per
 * grant, posted after the scoring transaction commits, idempotent per bite and grant version, and
 * never able to fail scoring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  leagueBite: { findMany: vi.fn() },
  leagueMember: { findMany: vi.fn() },
  leagueMatchup: { findMany: vi.fn() },
  leagueSettings: { findFirst: vi.fn() },
}));
const publishMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({ logger: { warn: warnMock } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/leagues/social/socialSystemEvents', () => ({
  publishLeagueSystemMessage: publishMock,
}));

import { publishBiteGrantActivity } from '@/server/leagues/bloodsuckerGrantActivity';

const run = { leagueId: 'league-1', seasonId: 'season-1', round: 3 };
const bite = {
  id: 'bite-1',
  matchupId: 'matchup-1',
  bloodsuckerMemberId: 'bs',
  victimMemberId: 'victim',
  grantedScoreVersion: 2,
  deadlineAt: new Date('2026-06-03T10:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.leagueBite.findMany.mockResolvedValue([bite]);
  prismaMocks.leagueMember.findMany.mockResolvedValue([
    { id: 'victim', teamName: 'Brunswick Bats' },
  ]);
  prismaMocks.leagueMatchup.findMany.mockResolvedValue([
    {
      id: 'matchup-1',
      status: 'FINAL',
      winnerMemberId: 'bs',
      homeMemberId: 'victim',
      homeCategoryWins: 4,
      awayCategoryWins: 5,
    },
  ]);
  prismaMocks.leagueSettings.findFirst.mockResolvedValue({ timeZone: 'Australia/Melbourne' });
  publishMock.mockResolvedValue({});
});

describe('publishBiteGrantActivity', () => {
  it('reads the open bites of the scored round, scoped to the league and season', async () => {
    await publishBiteGrantActivity(run);

    expect(prismaMocks.leagueBite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', seasonId: 'season-1', round: 3, status: 'OPEN' },
      })
    );
    expect(prismaMocks.leagueMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1', id: { in: ['victim'] } } })
    );
    expect(prismaMocks.leagueMatchup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1', id: { in: ['matchup-1'] } } })
    );
  });

  it('posts one message per grant, keyed by bite and grant version', async () => {
    await publishBiteGrantActivity(run);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      eventType: 'BLOODSUCKER_BITE_GRANTED',
      relatedEntityId: 'bite-1:grant:2',
      content:
        'The Bloodsucker beat Brunswick Bats 5-4 in round 3 and has a bite to make. ' +
        'If it has not chosen by Wed, 3 June, 8:00 pm AEST, the system makes the pick.',
      context: { biteId: 'bite-1', round: 3, deadlineAt: '2026-06-03T10:00:00.000Z' },
    });
  });

  it('posts nothing when the run granted no bite', async () => {
    prismaMocks.leagueBite.findMany.mockResolvedValue([]);

    await publishBiteGrantActivity(run);

    expect(publishMock).not.toHaveBeenCalled();
    expect(prismaMocks.leagueMember.findMany).not.toHaveBeenCalled();
  });

  it('announces nothing while the matchup is not a FINAL Bloodsucker win (E5)', async () => {
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', status: 'LIVE', winnerMemberId: null, homeMemberId: 'victim' },
    ]);

    await publishBiteGrantActivity(run);

    expect(publishMock).not.toHaveBeenCalled();
  });

  it('never throws: a failed read or post is logged and scoring carries on', async () => {
    publishMock.mockRejectedValueOnce(new Error('social is down'));
    await expect(publishBiteGrantActivity(run)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'Bloodsucker bite grant activity message failed',
      expect.objectContaining({ leagueId: 'league-1', biteId: 'bite-1', error: 'social is down' })
    );

    prismaMocks.leagueBite.findMany.mockRejectedValueOnce(new Error('database is down'));
    await expect(publishBiteGrantActivity(run)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'Bloodsucker bite grant activity message failed',
      expect.objectContaining({ leagueId: 'league-1', error: 'database is down' })
    );
  });

  it('still posts the other grants when one fails', async () => {
    prismaMocks.leagueBite.findMany.mockResolvedValue([bite, { ...bite, id: 'bite-2' }]);
    publishMock.mockRejectedValueOnce(new Error('once'));

    await publishBiteGrantActivity(run);

    expect(publishMock).toHaveBeenCalledTimes(2);
  });
});
