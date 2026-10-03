import { Prisma } from '@prisma/client';

import { getPlayers } from '@/lib/data';
import {
  buildDefaultLineup,
  scorePlayersByStats,
  type AutoFillPlayer,
  type AutoFillSpot,
} from '@/lib/leagues/lineupAutoFill';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { parseCategoryDirectionsJson } from '@/server/leagues/categoryDirections';
import { parseCompetitionRulesJson } from '@/server/leagues/competitionRules';
import {
  loadLineupRoundSummaries,
  loadRoundPlayerFixtures,
  type RoundPlayerFixture,
} from '@/server/leagues/lineupService';
import { parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import type { LineupSlotSettings } from '@/server/leagues/scoringTypes';
import { buildLeaguePlayerStatDatasetForTargets } from '@/server/players/readModels/leaguePlayerStatReadModel';
import {
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

type SourcePlayer = Awaited<ReturnType<typeof getPlayers>>[number];
type DefaultLineupClient = Pick<typeof prisma, 'league' | 'leagueLineup' | 'leagueRosterPlayer'>;

/** On-field groups in team-sheet order, then interchange. */
const FIELD_SLOT_ORDER = ['DEF', 'MID', 'RUC', 'FWD', 'UTIL'] as const;

/** Player-feed statuses that are not injuries (the feed falls back to these when no injury is listed). */
export const NON_INJURY_STATUSES = new Set([
  'home',
  'away',
  'active',
  'available',
  'fit',
  'ok',
  'none',
  'n/a',
  'selected',
  'named',
  'playing',
]);

export function parseLeagueCategories(value: string | null | undefined): FantasyCategoryKey[] {
  if (!value) return [...REAL_DATA_NINE_CATEGORY_PRESET];
  try {
    return normalizeFantasyCategoryKeys(JSON.parse(value), REAL_DATA_NINE_CATEGORY_PRESET);
  } catch {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }
}

export function buildLineupSpots(
  lineupSlots: LineupSlotSettings,
  interchangeSlots: number
): AutoFillSpot[] {
  const field = FIELD_SLOT_ORDER.flatMap((slot) =>
    Array.from({ length: Math.max(0, lineupSlots[slot] ?? 0) }, (_, slotIndex) => ({
      slot,
      slotIndex,
    }))
  );
  const interchange = Array.from({ length: Math.max(0, interchangeSlots) }, (_, slotIndex) => ({
    slot: 'INTERCHANGE' as const,
    slotIndex,
  }));
  return [...field, ...interchange];
}

/** Looks up a listed injury by player id, then by name. */
export function buildInjuryLookup(sourcePlayers: readonly SourcePlayer[]) {
  const byKey = new Map<string, string>();
  for (const source of sourcePlayers) {
    const injury = typeof source.injury === 'string' ? source.injury.trim() : '';
    if (!injury || NON_INJURY_STATUSES.has(injury.toLowerCase())) continue;
    byKey.set(`id:${source.id}`, injury);
    byKey.set(`name:${source.name.trim().toLowerCase()}`, injury);
  }
  return (player: { playerId: string; name: string }): string | null =>
    byKey.get(`id:${player.playerId}`) ??
    byKey.get(`name:${player.name.trim().toLowerCase()}`) ??
    null;
}

/**
 * Candidates for a default lineup. `ignoreGameStarts` treats players whose game has started as
 * available, for a default that stands in for the lineup the team had before the round began.
 */
export function toAutoFillPlayers({
  roster,
  fixturesByPlayerId,
  injuryFor,
  scores,
  now,
  ignoreGameStarts = false,
}: {
  roster: ReadonlyArray<{ playerId: string; name: string; position: string | null }>;
  fixturesByPlayerId: ReadonlyMap<string, RoundPlayerFixture>;
  injuryFor: (player: { playerId: string; name: string }) => string | null;
  scores: ReadonlyMap<string, number>;
  now: Date;
  ignoreGameStarts?: boolean;
}): AutoFillPlayer[] {
  return roster.map((player) => {
    const fixture = fixturesByPlayerId.get(player.playerId);
    const started = Boolean(fixture?.startsAt && fixture.startsAt <= now);
    return {
      playerId: player.playerId,
      position: player.position,
      available: !fixture?.bye && !injuryFor(player) && (ignoreGameStarts || !started),
      score: scores.get(player.playerId) ?? 0,
    };
  });
}

/** Season per-game scores for ranking, or an empty map when the stat feed is unavailable. */
export function scoreRosterPlayers({
  sourcePlayers,
  roster,
  categoriesJson,
  categoryDirectionsJson,
}: {
  sourcePlayers: readonly SourcePlayer[];
  roster: ReadonlyArray<{ playerId: string; name: string; club: string }>;
  categoriesJson: string | null | undefined;
  categoryDirectionsJson: string | null | undefined;
}): Map<string, number> {
  if (sourcePlayers.length === 0 || roster.length === 0) return new Map();
  const categories = parseLeagueCategories(categoriesJson);
  const dataset = buildLeaguePlayerStatDatasetForTargets(
    sourcePlayers,
    roster.map((player) => ({ id: player.playerId, name: player.name, club: player.club })),
    {
      categories,
      categoryDirections: parseCategoryDirectionsJson(categories, categoryDirectionsJson),
    }
  );
  return scorePlayersByStats(dataset.columns, dataset.playersById);
}

/**
 * Gives every listed member a lineup for `round` when they have not saved one.
 *
 * The default is the member's previous lineup (players still in the squad and in position), with
 * gaps filled by position from fit players; a member with no earlier lineup gets a team picked
 * by position. Managers only need to confirm changes, and no matchup goes unscored because a
 * team never set a lineup. Members who already have a lineup for the round are left untouched.
 *
 * Returns the number of lineups created.
 */
export async function ensureDefaultLineups({
  leagueId,
  round,
  memberIds,
  now = new Date(),
  client = prisma,
}: {
  leagueId: string;
  round: number;
  memberIds: readonly string[];
  now?: Date;
  client?: DefaultLineupClient;
}): Promise<number> {
  const uniqueMemberIds = [...new Set(memberIds)];
  if (!Number.isSafeInteger(round) || round <= 0 || uniqueMemberIds.length === 0) return 0;

  const existing = await client.leagueLineup.findMany({
    where: { leagueId, round, memberId: { in: uniqueMemberIds } },
    select: { memberId: true },
  });
  const withLineup = new Set(existing.map((lineup) => lineup.memberId));
  const missing = uniqueMemberIds.filter((memberId) => !withLineup.has(memberId));
  if (missing.length === 0) return 0;

  const league = await client.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league?.settings) return 0;
  const rules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const spots = buildLineupSpots(
    parseLineupSlotsJson(league.settings.lineupSlotsJson),
    rules.interchangeSlots
  );

  const rosterRows = await client.leagueRosterPlayer.findMany({
    where: { leagueId, memberId: { in: missing } },
    include: { player: true },
  });
  const roster = rosterRows.map((row) => ({
    memberId: row.memberId,
    playerId: row.playerId,
    name: row.player.name,
    club: row.player.club,
    position: row.player.position,
  }));

  // Byes, injuries and form. Each is best effort: without it the default still fills by position.
  const aflRound = await loadLineupRoundSummaries(leagueId, now)
    .then((summaries) => summaries.find((summary) => summary.round === round)?.aflRound ?? null)
    .catch(() => null);
  const fixtureResult = await loadRoundPlayerFixtures({ aflRound, players: roster }).catch(() => ({
    ok: false as const,
  }));
  const fixturesByPlayerId = fixtureResult.ok
    ? fixtureResult.fixturesByPlayerId
    : new Map<string, RoundPlayerFixture>();
  let sourcePlayers: SourcePlayer[] = [];
  try {
    sourcePlayers = await getPlayers();
  } catch (error) {
    logger.warn('Default lineups: player feed unavailable', { leagueId, error });
  }
  const injuryFor = buildInjuryLookup(sourcePlayers);
  let scores = new Map<string, number>();
  try {
    scores = scoreRosterPlayers({
      sourcePlayers,
      roster,
      categoriesJson: league.categoriesJson,
      categoryDirectionsJson: league.settings.categoryDirectionsJson,
    });
  } catch (error) {
    logger.warn('Default lineups: player stats unavailable', { leagueId, error });
  }

  let created = 0;
  for (const memberId of missing) {
    const memberRoster = roster.filter((player) => player.memberId === memberId);
    if (memberRoster.length === 0) continue;
    const previous = await client.leagueLineup.findFirst({
      where: { leagueId, memberId, round: { lt: round } },
      orderBy: { round: 'desc' },
      include: { players: true },
    });
    const { assignments } = buildDefaultLineup({
      spots,
      players: toAutoFillPlayers({
        roster: memberRoster,
        fixturesByPlayerId,
        injuryFor,
        scores,
        now,
        ignoreGameStarts: true,
      }),
      previous: (previous?.players ?? [])
        .filter((player) => player.slot !== 'BENCH')
        .map((player) => ({
          playerId: player.playerId,
          slot: player.slot as AutoFillSpot['slot'],
          slotIndex: player.slotIndex,
        })),
    });
    if (assignments.length === 0) continue;

    try {
      await client.leagueLineup.create({
        data: {
          leagueId,
          memberId,
          round,
          players: {
            create: assignments.map((assignment) => ({
              playerId: assignment.playerId,
              slot: assignment.slot,
              slotIndex: assignment.slotIndex,
            })),
          },
        },
      });
      created += 1;
    } catch (error) {
      // A concurrent save or default created the lineup first; theirs wins.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
  }
  return created;
}
