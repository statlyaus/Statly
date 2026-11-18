import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const prisma = vi.hoisted(() => ({
  leagueSettings: { findFirst: vi.fn() },
  leagueCompetitionRound: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { resolveCurrentCompetitionRoundNumber } from './lineupService';
import { resolveCurrentCompetitionRound } from './matchupReadModel';

describe('one current-round definition for lineups and matchups', () => {
  it('picks the same round as the matchup read model when two round windows overlap', async () => {
    const now = new Date('2026-05-10T00:00:00Z');
    const rounds = [
      {
        round: 7,
        status: 'LIVE',
        startsAt: new Date('2026-05-01T00:00:00Z'),
        endsAt: new Date('2026-05-12T00:00:00Z'),
      },
      {
        round: 8,
        status: 'LIVE',
        startsAt: new Date('2026-05-08T00:00:00Z'),
        endsAt: new Date('2026-05-15T00:00:00Z'),
      },
    ];
    prisma.leagueSettings.findFirst.mockResolvedValue({ competitionRulesVersion: 1 });
    prisma.leagueCompetitionRound.findMany.mockResolvedValue(rounds);

    await expect(resolveCurrentCompetitionRoundNumber('league-1', now)).resolves.toBe(
      resolveCurrentCompetitionRound(rounds, now)?.round
    );
    await expect(resolveCurrentCompetitionRoundNumber('league-1', now)).resolves.toBe(8);
  });
});
