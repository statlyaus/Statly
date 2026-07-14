import 'server-only';

import { logLeagueActivity } from '@/lib/activity';
import { getRoundMatches } from '@/lib/etlIntegration';
import { prisma } from '@/lib/prisma';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

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
      return [
        aflRound,
        normalizeRoundMatchStatus(matches as unknown as RawRoundMatch[]),
      ] as const;
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

function parseCategories(value: string | null): FantasyCategoryKey[] {
  if (!value) return ['goals'];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((category): category is FantasyCategoryKey => typeof category === 'string')
      : ['goals'];
  } catch {
    return ['goals'];
  }
}

export type PublishCompetitionResult =
  | { ok: true; fixtureVersion: number; roundCount: number }
  | { ok: false; errors: string[] };

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

  const categories = parseCategories(league.categoriesJson);
  const effectiveRules =
    rules ?? parseCompetitionRulesJson(league.settings.competitionRulesJson, categories[0] ?? 'goals');
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
  const generatedSchedule = generateCompetitionSchedule({
    memberIds: league.members.map((member) => member.id),
    fixtureVersion,
    seasonStartAflRound: effectiveRules.seasonStartAflRound,
    regularSeasonRounds: effectiveRules.regularSeasonRounds,
    excludedAflRounds: effectiveRules.excludedAflRounds,
    finalsTeams: effectiveRules.finalsTeams,
  });
  const schedule = await hydrateOfficialRoundTimings(generatedSchedule, new Date().getFullYear());
  const publishedAt = new Date();

  await prisma.$transaction(async (tx) => {
    // Republishing is an explicit reset. Preserve the old shape in the audit record,
    // then remove only derived competition data, never league members or rosters.
    await tx.leagueMatchupScore.deleteMany({ where: { leagueId } });
    await tx.leagueStanding.deleteMany({ where: { leagueId } });
    await tx.leagueLineup.deleteMany({ where: { leagueId } });
    await tx.leagueMatchup.deleteMany({ where: { leagueId } });
    await tx.leagueCompetitionRound.deleteMany({ where: { leagueId } });

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
        competitionRulesVersion: fixtureVersion,
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
        }),
      },
    });
  });

  void logLeagueActivity(leagueId, 'competition-rules-published', {
    actorMemberId,
    fixtureVersion,
    roundCount: schedule.length,
  }).catch(() => undefined);

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
  const competitionRound = await prisma.leagueCompetitionRound.findFirst({
    where: { leagueId, round },
    orderBy: { fixtureVersion: 'desc' },
  });
  if (!competitionRound) return { ok: false, error: 'Competition round was not found.' };
  if (competitionRound.startsAt && competitionRound.startsAt <= now) {
    return { ok: false, error: 'A fallback deadline cannot be set after the first scheduled AFL game.' };
  }
  if (fallbackLockAt <= now) {
    return { ok: false, error: 'Choose a future fallback deadline.' };
  }

  await prisma.$transaction([
    prisma.leagueCompetitionRound.update({
      where: { id: competitionRound.id },
      data: { fallbackLockAt },
    }),
    prisma.leagueCompetitionAudit.create({
      data: {
        leagueId,
        actorMemberId,
        eventType: 'DEADLINE_OVERRIDDEN',
        payloadJson: JSON.stringify({ round, fallbackLockAt: fallbackLockAt.toISOString() }),
      },
    }),
  ]);

  void logLeagueActivity(leagueId, 'competition-deadline-overridden', {
    actorMemberId,
    round,
    fallbackLockAt: fallbackLockAt.toISOString(),
  }).catch(() => undefined);

  return { ok: true };
}
