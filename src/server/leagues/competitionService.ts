import 'server-only';

import { logLeagueActivity } from '@/lib/activity';
import { getRoundMatches } from '@/lib/etlIntegration';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { normalizeFantasyCategoryKeys } from '@/types/fantasyCategories';

import { generateCompetitionSchedule } from './fixtureGenerator';
import {
  parseCompetitionRulesJson,
  type CompetitionRules,
  validateCompetitionRules,
} from './competitionRules';
import { parseLineupSlotsJson } from './lineupSettings';
import { normalizeRoundMatchStatus, type RawRoundMatch } from './liveStatsAdapter';

async function hydrateOfficialRoundTimings(
  schedule: ReturnType<typeof generateCompetitionSchedule>,
  season: number
) {
  const aflRounds = [...new Set(schedule.map((competitionRound) => competitionRound.aflRound))];
  const results = await Promise.all(
    aflRounds.map(async (aflRound) => {
      const matches = await getRoundMatches(season, aflRound);
      return [aflRound, normalizeRoundMatchStatus(matches as unknown as RawRoundMatch[])] as const;
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

function parseStoredCategories(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
      : [];
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
