import 'server-only';

import type { PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import { isActivePrismaMembership } from '@/server/leagues/membership';

type SeasonStateClient = Pick<PrismaClient, 'league' | 'leagueCompetitionRound'>;

export type LeagueSeasonStateRoundStatus = 'scheduled' | 'no_matchup' | 'in_progress' | 'final';

export interface LeagueSeasonStateRound {
  id: string;
  round: number;
  roundLabel: string;
  aflRound: number | null;
  phase: 'regular' | 'finals';
  status: LeagueSeasonStateRoundStatus;
  current: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface LeagueSeasonState {
  leagueId: string;
  season: {
    id: string;
    label: string;
    year: number | null;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  competitionStatus: 'SETUP' | 'PUBLISHED' | 'PENDING' | 'ACTIVE' | 'COMPLETE';
  fixtureVersion: number;
  schedule: LeagueSeasonStateRound[];
}

export type LeagueSeasonStateResult =
  | { ok: true; data: LeagueSeasonState }
  | { ok: false; status: 403 | 404; error: string };

function toRoundStatus(
  round: { status: string; startsAt: Date | null; endsAt: Date | null },
  current: boolean
): LeagueSeasonStateRoundStatus {
  if (round.status === 'FINAL') return 'final';
  if (round.status === 'NO_MATCHUP') return 'no_matchup';
  if (current) return 'in_progress';
  return 'scheduled';
}

function isRoundInTimeWindow(
  round: { status: string; startsAt: Date | null; endsAt: Date | null },
  now: Date
): boolean {
  if (round.status === 'FINAL' || round.status === 'NO_MATCHUP' || !round.startsAt) return false;

  return (
    round.startsAt.getTime() <= now.getTime() &&
    (!round.endsAt || now.getTime() <= round.endsAt.getTime())
  );
}

export async function getAuthorizedLeagueSeasonState(
  input: { leagueId: string; userId: string; now?: Date },
  client: SeasonStateClient = defaultPrisma
): Promise<LeagueSeasonStateResult> {
  const league = await client.league.findUnique({
    where: { id: input.leagueId },
    select: {
      id: true,
      activeSeason: {
        select: {
          id: true,
          label: true,
          year: true,
          startsAt: true,
          endsAt: true,
        },
      },
      settings: {
        select: {
          competitionStatus: true,
          competitionRulesVersion: true,
        },
      },
      members: {
        where: { userId: input.userId },
        select: { isActive: true, status: true },
        take: 1,
      },
    },
  });

  if (!league) {
    return { ok: false, status: 404, error: 'League not found' };
  }

  const membership = league.members[0];
  if (!membership || !isActivePrismaMembership(membership)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const fixtureVersion = league.settings.competitionRulesVersion;
  const rounds = league.activeSeason
    ? await client.leagueCompetitionRound.findMany({
        where: { leagueId: league.id, seasonId: league.activeSeason.id, fixtureVersion },
        orderBy: { round: 'asc' },
        select: {
          id: true,
          round: true,
          aflRound: true,
          phase: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      })
    : [];
  const now = input.now ?? new Date();
  const activeRoundId =
    rounds.find((round) => isRoundInTimeWindow(round, now))?.id ??
    rounds.find((round) => round.status === 'LOCKED')?.id ??
    null;

  return {
    ok: true,
    data: {
      leagueId: league.id,
      season: league.activeSeason
        ? {
            id: league.activeSeason.id,
            label: league.activeSeason.label,
            year: league.activeSeason.year,
            startsAt: league.activeSeason.startsAt?.toISOString() ?? null,
            endsAt: league.activeSeason.endsAt?.toISOString() ?? null,
          }
        : null,
      competitionStatus: league.settings.competitionStatus,
      fixtureVersion,
      schedule: rounds.map((round) => {
        const current = round.id === activeRoundId;
        return {
          id: round.id,
          round: round.round,
          roundLabel: `Round ${round.round}`,
          aflRound: round.aflRound,
          phase: round.phase === 'FINALS' ? 'finals' : 'regular',
          status: toRoundStatus(round, current),
          current,
          startsAt: round.startsAt?.toISOString() ?? null,
          endsAt: round.endsAt?.toISOString() ?? null,
        };
      }),
    },
  };
}
