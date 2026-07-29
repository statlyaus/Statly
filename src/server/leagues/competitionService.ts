import 'server-only';

import type { Prisma } from '@prisma/client';

import { logLeagueActivity } from '@/lib/activity';
import { getRoundMatches } from '@/lib/etlIntegration';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { normalizeFantasyCategoryKeys } from '@/types/fantasyCategories';

import { generateCompetitionSchedule, generateManualCompetitionSchedule } from './fixtureGenerator';
import {
  parseCompetitionRulesJson,
  type CompetitionRules,
  validateCompetitionRules,
} from './competitionRules';
import { parseLineupSlotsJson } from './lineupSettings';
import { normalizeRoundMatchStatus, type RawRoundMatch } from './liveStatsAdapter';
import type { LeagueScoringMode } from './scoringTypes';
import { calculateStandingsRows } from './standingsService';

async function hydrateOfficialRoundTimings(
  schedule: ReturnType<typeof generateCompetitionSchedule>,
  season: number
) {
  const aflRounds = [...new Set(schedule.map((competitionRound) => competitionRound.aflRound))];
  const results = await Promise.all(
    aflRounds.map(async (aflRound) => {
      try {
        const matches = await getRoundMatches(season, aflRound);
        return [
          aflRound,
          normalizeRoundMatchStatus(matches as unknown as RawRoundMatch[]),
        ] as const;
      } catch (error) {
        logger.warn('Failed to hydrate official competition round timing', {
          season,
          aflRound,
          error: error instanceof Error ? error.message : String(error),
        });
        return [aflRound, normalizeRoundMatchStatus([])] as const;
      }
    })
  );
  const timingsByAflRound = new Map(results);

  return schedule.map((competitionRound) => {
    const timing = timingsByAflRound.get(competitionRound.aflRound);
    return {
      ...competitionRound,
      startsAt: timing?.earliestStartAt ?? null,
      endsAt: timing?.latestEndAt ?? null,
    };
  });
}

export type PublishCompetitionResult =
  | { ok: true; fixtureVersion: number; roundCount: number }
  | { ok: false; errors: string[] };

class CompetitionPublicationConflictError extends Error {}

type CompetitionFixtureInput = {
  matchupId?: string | null;
  homeMemberId?: string | null;
  awayMemberId?: string | null;
  byeMemberId?: string | null;
};

type CompetitionFixtureMutationResult =
  | {
      ok: true;
      fixture: {
        id: string;
        round: number;
        homeMemberId: string | null;
        awayMemberId: string | null;
        byeMemberId: string | null;
      };
    }
  | { ok: false; error: string };

function parseStoredCategories(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function rebuildLeagueStandings(
  tx: Prisma.TransactionClient,
  {
    leagueId,
    fixtureVersion,
    scoringMode,
  }: {
    leagueId: string;
    fixtureVersion: number;
    scoringMode: LeagueScoringMode;
  }
) {
  const [members, finalizedScores] = await Promise.all([
    tx.leagueMember.findMany({ where: { leagueId }, select: { id: true } }),
    tx.leagueMatchupScore.findMany({
      where: {
        leagueId,
        status: 'FINAL',
        matchup: { fixtureVersion, phase: 'REGULAR' },
      },
    }),
  ]);
  const standings = calculateStandingsRows({
    scoringMode,
    memberIds: members.map((member) => member.id),
    finalizedScores,
  });

  await tx.leagueStanding.deleteMany({ where: { leagueId } });
  if (standings.length > 0) {
    await tx.leagueStanding.createMany({
      data: standings.map((standing) => ({ leagueId, ...standing })),
    });
  }

  return standings.length;
}

export async function publishCompetition({
  leagueId,
  actorMemberId,
  rules,
}: {
  leagueId: string;
  actorMemberId: string;
  rules?: CompetitionRules;
}): Promise<PublishCompetitionResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      settings: true,
      members: { orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }] },
    },
  });
  if (!league?.settings) return { ok: false, errors: ['League settings were not found.'] };
  if (!league.activeSeasonId)
    return { ok: false, errors: ['An active league season is required.'] };

  const categories = normalizeFantasyCategoryKeys(parseStoredCategories(league.categoriesJson), [
    'goals',
  ]);
  const effectiveRules =
    rules ??
    parseCompetitionRulesJson(league.settings.competitionRulesJson, categories[0] ?? 'goals');
  const validationIssues = validateCompetitionRules({
    rules: effectiveRules,
    teamCount: league.members.length,
    categories,
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    rosterSize: league.settings.rosterSize,
  });
  if (validationIssues.length) {
    return { ok: false, errors: validationIssues.map((issue) => issue.message) };
  }

  const fixtureVersion = league.settings.competitionRulesVersion + 1;
  const generatedSchedule =
    effectiveRules.fixtureGenerationMode === 'AUTOMATIC'
      ? generateCompetitionSchedule({
          memberIds: league.members.map((member) => member.id),
          fixtureVersion,
          seasonStartAflRound: effectiveRules.seasonStartAflRound,
          regularSeasonRounds: effectiveRules.regularSeasonRounds,
          excludedAflRounds: effectiveRules.excludedAflRounds,
          finalsTeams: effectiveRules.finalsTeams,
        })
      : generateManualCompetitionSchedule({
          fixtureVersion,
          seasonStartAflRound: effectiveRules.seasonStartAflRound,
          regularSeasonRounds: effectiveRules.regularSeasonRounds,
          excludedAflRounds: effectiveRules.excludedAflRounds,
          finalsTeams: effectiveRules.finalsTeams,
        });
  const schedule = await hydrateOfficialRoundTimings(generatedSchedule, new Date().getFullYear());
  const publishedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const versionClaim = await tx.leagueSettings.updateMany({
        where: {
          id: league.settingsId,
          competitionRulesVersion: league.settings.competitionRulesVersion,
        },
        data: { competitionRulesVersion: { increment: 1 } },
      });
      if (versionClaim.count !== 1) {
        throw new CompetitionPublicationConflictError();
      }

      // Republishing resets only derived competition data. Delete results provide
      // bounded audit evidence without retaining arbitrary row snapshots.
      const resetSummary = {
        matchupScores: (await tx.leagueMatchupScore.deleteMany({ where: { leagueId } })).count,
        standings: (await tx.leagueStanding.deleteMany({ where: { leagueId } })).count,
        lineups: (await tx.leagueLineup.deleteMany({ where: { leagueId } })).count,
        matchups: (await tx.leagueMatchup.deleteMany({ where: { leagueId } })).count,
        competitionRounds: (await tx.leagueCompetitionRound.deleteMany({ where: { leagueId } }))
          .count,
      };

      for (const generatedRound of schedule) {
        const competitionRound = await tx.leagueCompetitionRound.create({
          data: {
            leagueId,
            seasonId: league.activeSeasonId,
            fixtureVersion,
            round: generatedRound.round,
            aflRound: generatedRound.aflRound,
            phase: generatedRound.phase,
            status:
              generatedRound.status === 'NO_MATCHUP'
                ? 'NO_MATCHUP'
                : generatedRound.startsAt
                  ? 'SCHEDULED'
                  : 'PENDING',
            startsAt: generatedRound.startsAt,
            endsAt: generatedRound.endsAt,
            publishedAt,
          },
        });

        if (generatedRound.fixtures.length) {
          await tx.leagueMatchup.createMany({
            data: generatedRound.fixtures.map((fixture) => ({
              leagueId,
              round: fixture.round,
              fixtureVersion,
              competitionRoundId: competitionRound.id,
              phase: fixture.phase,
              bracketKey: fixture.bracketKey,
              homeMemberId: fixture.homeMemberId,
              awayMemberId: fixture.awayMemberId,
              byeMemberId: fixture.byeMemberId,
              startsAt: generatedRound.startsAt,
              endsAt: generatedRound.endsAt,
            })),
          });
        }
      }

      await tx.leagueSettings.update({
        where: { id: league.settingsId },
        data: {
          competitionStatus: 'PENDING',
          competitionRulesJson: JSON.stringify(effectiveRules),
          competitionPublishedAt: publishedAt,
        },
      });
      await tx.leagueCompetitionAudit.create({
        data: {
          leagueId,
          actorMemberId,
          eventType: 'RULES_PUBLISHED',
          payloadJson: JSON.stringify({
            fixtureVersion,
            rules: effectiveRules,
            roundCount: schedule.length,
            resetDerivedCompetitionData: true,
            resetSummary,
          }),
        },
      });
    });
  } catch (error) {
    if (error instanceof CompetitionPublicationConflictError) {
      return {
        ok: false,
        errors: [
          'Competition rules changed while publication was in progress. Try publishing again.',
        ],
      };
    }
    throw error;
  }

  void logLeagueActivity(leagueId, 'competition-rules-published', {
    actorMemberId,
    fixtureVersion,
    roundCount: schedule.length,
  }).catch((error: unknown) => {
    logger.warn('Failed to record competition publication activity', {
      leagueId,
      fixtureVersion,
      error,
    });
  });

  return { ok: true, fixtureVersion, roundCount: schedule.length };
}

export async function saveCompetitionFixture({
  leagueId,
  round,
  actorMemberId,
  fixture,
}: {
  leagueId: string;
  round: number;
  actorMemberId: string;
  fixture: CompetitionFixtureInput;
}): Promise<CompetitionFixtureMutationResult> {
  const homeMemberId = fixture.homeMemberId || null;
  const awayMemberId = fixture.awayMemberId || null;
  const byeMemberId = fixture.byeMemberId || null;
  const isMatchup =
    Boolean(homeMemberId) && Boolean(awayMemberId) && !byeMemberId && homeMemberId !== awayMemberId;
  const isBye = Boolean(byeMemberId) && !homeMemberId && !awayMemberId;

  if (!Number.isSafeInteger(round) || round < 1) {
    return { ok: false, error: 'Choose a valid competition round.' };
  }
  if (!isMatchup && !isBye) {
    return {
      ok: false,
      error: 'Choose two different matchup teams or one bye team.',
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const league = await tx.league.findUnique({
      where: { id: leagueId },
      select: {
        settings: { select: { competitionRulesVersion: true, scoringMode: true } },
      },
    });
    const fixtureVersion = league?.settings.competitionRulesVersion ?? 0;
    const scoringMode = league?.settings.scoringMode as LeagueScoringMode | undefined;
    if (!fixtureVersion || !scoringMode) {
      return { ok: false as const, error: 'Publish competition rules before editing fixtures.' };
    }

    const competitionRound = await tx.leagueCompetitionRound.findUnique({
      where: { leagueId_fixtureVersion_round: { leagueId, fixtureVersion, round } },
    });
    if (!competitionRound || competitionRound.status === 'NO_MATCHUP') {
      return { ok: false as const, error: 'The selected round cannot contain fixtures.' };
    }
    if (competitionRound.status === 'FINAL') {
      return { ok: false as const, error: 'Finalized rounds cannot be edited.' };
    }

    const participantIds = [homeMemberId, awayMemberId, byeMemberId].filter(
      (memberId): memberId is string => Boolean(memberId)
    );
    const memberCount = await tx.leagueMember.count({
      where: { leagueId, id: { in: participantIds } },
    });
    if (memberCount !== participantIds.length) {
      return { ok: false as const, error: 'Every fixture team must belong to this league.' };
    }

    const existingFixture = fixture.matchupId
      ? await tx.leagueMatchup.findFirst({
          where: { id: fixture.matchupId, leagueId, fixtureVersion, round },
        })
      : null;
    if (fixture.matchupId && !existingFixture) {
      return { ok: false as const, error: 'The fixture was not found in this round.' };
    }
    if (existingFixture?.bracketKey) {
      return {
        ok: false as const,
        error: 'Finals bracket participants are assigned automatically from results.',
      };
    }
    if (competitionRound.phase === 'FINALS' && !existingFixture) {
      return {
        ok: false as const,
        error: 'Finals fixtures must use the published bracket slots.',
      };
    }

    const collision = await tx.leagueMatchup.findFirst({
      where: {
        leagueId,
        fixtureVersion,
        round,
        ...(existingFixture ? { id: { not: existingFixture.id } } : {}),
        OR: participantIds.flatMap((memberId) => [
          { homeMemberId: memberId },
          { awayMemberId: memberId },
          { byeMemberId: memberId },
        ]),
      },
      select: { id: true },
    });
    if (collision) {
      return { ok: false as const, error: 'A selected team already has a fixture in this round.' };
    }

    const previousFixture = existingFixture
      ? {
          homeMemberId: existingFixture.homeMemberId,
          awayMemberId: existingFixture.awayMemberId,
          byeMemberId: existingFixture.byeMemberId,
        }
      : null;
    const savedFixture = existingFixture
      ? await tx.leagueMatchup.update({
          where: { id: existingFixture.id },
          data: {
            homeMemberId,
            awayMemberId,
            byeMemberId,
            status: 'SCHEDULED',
            finalizedAt: null,
            winnerMemberId: null,
            homeCategoryWins: 0,
            awayCategoryWins: 0,
            drawnCategories: 0,
          },
        })
      : await tx.leagueMatchup.create({
          data: {
            leagueId,
            fixtureVersion,
            competitionRoundId: competitionRound.id,
            round,
            phase: competitionRound.phase,
            homeMemberId,
            awayMemberId,
            byeMemberId,
            startsAt: competitionRound.startsAt,
            endsAt: competitionRound.endsAt,
          },
        });

    const removedScores = existingFixture
      ? await tx.leagueMatchupScore.deleteMany({ where: { matchupId: existingFixture.id } })
      : { count: 0 };
    const rebuiltStandings =
      removedScores.count > 0
        ? await rebuildLeagueStandings(tx, {
            leagueId,
            fixtureVersion,
            scoringMode,
          })
        : 0;

    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId,
        eventType: 'FIXTURE_EDITED',
        payloadJson: JSON.stringify({
          round,
          fixtureId: savedFixture.id,
          previousFixture,
          fixture: { homeMemberId, awayMemberId, byeMemberId },
          removedScores: removedScores.count,
          rebuiltStandings,
        }),
      },
    });

    return {
      ok: true as const,
      fixture: {
        id: savedFixture.id,
        round,
        homeMemberId,
        awayMemberId,
        byeMemberId,
      },
    };
  });

  if (!result.ok) return result;

  void logLeagueActivity(leagueId, 'competition-fixture-edited', {
    actorMemberId,
    round,
    fixtureId: result.fixture.id,
  }).catch((error: unknown) => {
    logger.warn('Failed to record competition fixture edit activity', {
      leagueId,
      round,
      fixtureId: result.fixture.id,
      error,
    });
  });

  return result;
}

export async function deleteCompetitionFixture({
  leagueId,
  round,
  actorMemberId,
  matchupId,
}: {
  leagueId: string;
  round: number;
  actorMemberId: string;
  matchupId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const league = await tx.league.findUnique({
      where: { id: leagueId },
      select: {
        settings: { select: { competitionRulesVersion: true, scoringMode: true } },
      },
    });
    const fixtureVersion = league?.settings.competitionRulesVersion ?? 0;
    const scoringMode = league?.settings.scoringMode as LeagueScoringMode | undefined;
    if (!fixtureVersion || !scoringMode) {
      return { ok: false as const, error: 'Publish competition rules before editing fixtures.' };
    }

    const fixture = await tx.leagueMatchup.findFirst({
      where: { id: matchupId, leagueId, fixtureVersion, round },
      include: { competitionRound: { select: { status: true } } },
    });
    if (!fixture) return { ok: false as const, error: 'The fixture was not found.' };
    if (fixture.competitionRound?.status === 'FINAL') {
      return { ok: false as const, error: 'Finalized rounds cannot be edited.' };
    }
    if (fixture.bracketKey) {
      return {
        ok: false as const,
        error: 'Finals bracket fixtures cannot be deleted. Edit the participants instead.',
      };
    }

    const affectedMemberIds = [
      fixture.homeMemberId,
      fixture.awayMemberId,
      fixture.byeMemberId,
    ].filter((memberId): memberId is string => Boolean(memberId));
    const removedScores = await tx.leagueMatchupScore.deleteMany({ where: { matchupId } });
    const rebuiltStandings =
      removedScores.count > 0
        ? await rebuildLeagueStandings(tx, {
            leagueId,
            fixtureVersion,
            scoringMode,
          })
        : 0;
    await tx.leagueMatchup.delete({ where: { id: matchupId } });
    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId,
        eventType: 'FIXTURE_EDITED',
        payloadJson: JSON.stringify({
          round,
          fixtureId: matchupId,
          fixtureDeleted: true,
          affectedMemberIds,
          removedScores: removedScores.count,
          rebuiltStandings,
        }),
      },
    });
    return { ok: true as const };
  });

  if (!result.ok) return result;
  void logLeagueActivity(leagueId, 'competition-fixture-deleted', {
    actorMemberId,
    round,
    matchupId,
  }).catch((error: unknown) => {
    logger.warn('Failed to record competition fixture deletion activity', {
      leagueId,
      round,
      matchupId,
      error,
    });
  });
  return result;
}

export async function setCompetitionRoundFallbackDeadline({
  leagueId,
  round,
  actorMemberId,
  fallbackLockAt,
  now = new Date(),
}: {
  leagueId: string;
  round: number;
  actorMemberId: string;
  fallbackLockAt: Date;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const competitionRound = await tx.leagueCompetitionRound.findFirst({
      where: { leagueId, round },
      orderBy: { fixtureVersion: 'desc' },
    });
    if (!competitionRound) return { ok: false as const, error: 'Competition round was not found.' };
    if (competitionRound.status !== 'PENDING') {
      return {
        ok: false as const,
        error: 'A fallback deadline can only be set while fixture data is pending.',
      };
    }
    const pendingSince = competitionRound.publishedAt ?? competitionRound.createdAt;
    const fallbackAvailableAt = new Date(pendingSince.getTime() + 24 * 60 * 60 * 1000);
    if (now < fallbackAvailableAt) {
      return {
        ok: false as const,
        error: `A fallback deadline becomes available after fixture data has been pending for 24 hours (${fallbackAvailableAt.toISOString()}).`,
      };
    }
    if (fallbackLockAt <= now) {
      return { ok: false as const, error: 'Choose a future fallback deadline.' };
    }

    const knownLockOrStartAt = [competitionRound.lockedAt, competitionRound.startsAt]
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    if (knownLockOrStartAt && fallbackLockAt > knownLockOrStartAt) {
      return {
        ok: false as const,
        error: 'The fallback deadline cannot be later than the known round lock or AFL start.',
      };
    }

    const update = await tx.leagueCompetitionRound.updateMany({
      where: {
        id: competitionRound.id,
        status: 'PENDING',
        startsAt: competitionRound.startsAt,
        lockedAt: competitionRound.lockedAt,
      },
      data: { fallbackLockAt },
    });
    if (update.count !== 1) {
      return {
        ok: false as const,
        error: 'Round fixture data changed while the fallback deadline was being saved. Try again.',
      };
    }

    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId,
        eventType: 'DEADLINE_OVERRIDDEN',
        payloadJson: JSON.stringify({ round, fallbackLockAt: fallbackLockAt.toISOString() }),
      },
    });
    return { ok: true as const };
  });

  if (!result.ok) return result;

  void logLeagueActivity(leagueId, 'competition-deadline-overridden', {
    actorMemberId,
    round,
    fallbackLockAt: fallbackLockAt.toISOString(),
  }).catch((error: unknown) => {
    logger.warn('Failed to record competition deadline override activity', {
      leagueId,
      round,
      error,
    });
  });

  return result;
}
