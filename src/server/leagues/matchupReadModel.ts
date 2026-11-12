import 'server-only';

import { ensureDefaultLineups } from '@/server/leagues/defaultLineups';
import { getRoundMatchesResult, getRoundPlayerStatsResult } from '@/server/etl/etlRoundData';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { resolveFootywirePlayerIds } from '@/server/players/footywireIdentity';
import { getTeamName } from '@/lib/teamLogos';
import {
  FANTASY_CATEGORIES,
  categoryAggregation,
  categoryStatInputs,
  isFantasyCategoryKey,
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

import { activeSeasonIdOf } from './activeSeason';
import { normalizeCategoryDirections } from './categoryDirections';
import { normalizeCompetitionRules } from './competitionRules';
import { synchronizeFinalsFixtures } from './finalsService';
import {
  loadFinalMatchupSnapshots,
  recordFinalRoundRescores,
  type MatchupResultSnapshot,
} from './finalRoundRescoreAudit';
import type { FinalsTeamCount } from './finalsProgression';
import { resolveAndPersistLineupAutosubs } from './lineupAutosubService';
import {
  normalizeLiveStatRows,
  normalizeRoundMatchStatus,
  type NormalizedLiveStatRow,
  type NormalizedRoundMatchStatus,
  type RawLiveStatRow,
  type RawRoundMatch,
} from './liveStatsAdapter';
import {
  aggregateLineupCategoryTotals,
  scoreHeadToHeadCategories,
  sumCategoryTotals,
  type CategoryTotals,
} from './matchupScoringEngine';
import {
  loadNoLosersRoundContext,
  noLosersPlayerScoreRows,
  noLosersPlayerView,
  noLosersWaitingOn,
  scoreNoLosersLineup,
  type NoLosersLineupScore,
  type NoLosersPlayerView,
  type NoLosersRoundContext,
} from './noLosersScoring';
import { calculateStandingsRows } from './standingsService';
import { inferUnselectedDidNotPlay, loadTeamSheetStatlyPlayerIds } from './unselectedPlayers';
import { buildLeagueStandings, type LeagueStandingReadRow } from './standingsReadModel';
import { normalizeLineupSlots } from './lineupSettings';
import type {
  CategoryScoreResult,
  LeagueLineupSlot,
  LeagueScoringMode,
  RatioParts,
} from './scoringTypes';

type MatchupTeamSide = 'home' | 'away' | 'draw';

export interface LeagueMatchupTeamSummary {
  id: string;
  teamName: string;
  teamLogoUrl: string | null;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
  matchupWin: boolean;
  matchupLoss: boolean;
  matchupDraw: boolean;
  players: LeagueMatchupPlayerContribution[];
}

export interface LeagueMatchupCategoryRow {
  category: FantasyCategoryKey;
  label: string;
  shortLabel: string;
  /** Null when the side has no value, such as DE% for a team with no disposals. */
  homeValue: number | null;
  awayValue: number | null;
  direction: 'HIGH_WINS' | 'LOW_WINS';
  winner: MatchupTeamSide;
}

export interface LeagueMatchupPlayerContribution {
  playerId: string;
  name: string;
  position: string;
  slot: string;
  slotIndex: number;
  total: number;
  /** False when the provider has no stat line for the player yet; values are then not real zeros. */
  hasStats: boolean;
  /** No Losers leagues only: the player's club result and multiplier, or why it is not known yet. */
  noLosers?: NoLosersPlayerView;
  categories: Array<{
    category: FantasyCategoryKey;
    shortLabel: string;
    value: number;
  }>;
}

export interface LeagueMatchupCard {
  id: string;
  round: number;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  /** True when the totals come from live stats and the matchup is not final yet. */
  provisional: boolean;
  startsAt: string | null;
  endsAt: string | null;
  finalizedAt: string | null;
  winnerMemberId: string | null;
  homeMember: LeagueMatchupTeamSummary | null;
  awayMember: LeagueMatchupTeamSummary | null;
  byeMember: {
    id: string;
    teamName: string;
    teamLogoUrl: string | null;
  } | null;
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  categoryRows: LeagueMatchupCategoryRow[];
  /** No Losers leagues only: why the round cannot be final yet ("Waiting on the result of ..."). */
  waitingOnResults?: string[];
}

export interface LeagueMatchupReadModel {
  leagueId: string;
  round: number;
  competitionStatus: 'SETUP' | 'PUBLISHED' | 'PENDING' | 'ACTIVE' | 'COMPLETE';
  scoringMode: LeagueScoringMode;
  fixtureGenerationMode: 'AUTOMATIC' | 'MANUAL';
  categories: FantasyCategoryKey[];
  lineupSlots: ReturnType<typeof normalizeLineupSlots>;
  categoryDirections: ReturnType<typeof normalizeCategoryDirections>;
  availableRounds: number[];
  roundContext: {
    round: number;
    aflRound: number | null;
    phase: 'REGULAR' | 'FINALS';
    status: 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL';
    startsAt: string | null;
    endsAt: string | null;
    fallbackLockAt: string | null;
  } | null;
  matchups: LeagueMatchupCard[];
  standings: LeagueStandingReadRow[];
  permissions: {
    canManage: boolean;
  };
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** A stored null (a team with no disposals has no DE%) stays unavailable; anything else reads as before. */
function readStoredCategoryValue(value: unknown): number | null {
  if (value === null) return null;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A stored ratio category's round inputs; anything malformed reads as absent. */
function readStoredRatioParts(value: unknown): RatioParts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { numerator, denominator } = value as Record<string, unknown>;
  return typeof numerator === 'number' &&
    Number.isFinite(numerator) &&
    typeof denominator === 'number' &&
    Number.isFinite(denominator)
    ? { numerator, denominator }
    : undefined;
}

export function parseStoredCategoryRows(categoriesJson: unknown): Array<{
  category: FantasyCategoryKey;
  homeValue: number | null;
  awayValue: number | null;
  homeRatio?: RatioParts;
  awayRatio?: RatioParts;
  direction: 'HIGH_WINS' | 'LOW_WINS';
  winner: MatchupTeamSide;
}> {
  if (!Array.isArray(categoriesJson)) return [];

  return categoriesJson.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const source = row as Record<string, unknown>;
    const category = source.category;
    if (!isFantasyCategoryKey(category)) return [];
    const winner = source.winner;
    const direction = source.direction;
    const homeRatio = readStoredRatioParts(source.homeRatio);
    const awayRatio = readStoredRatioParts(source.awayRatio);

    return [
      {
        category,
        homeValue: readStoredCategoryValue(source.homeValue),
        awayValue: readStoredCategoryValue(source.awayValue),
        ...(homeRatio ? { homeRatio } : {}),
        ...(awayRatio ? { awayRatio } : {}),
        direction: direction === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
        winner: winner === 'home' || winner === 'away' || winner === 'draw' ? winner : 'draw',
      },
    ];
  });
}

/**
 * Each member's season value for one category across finalized score rows. A sum category adds
 * the round values. A ratio category (DE%) is the season numerator over the season denominator
 * (owner decision 2026-11-11), never a sum or mean of round percentages, and is null when the
 * member had no season denominator. A round stored without its ratio parts (scored before they
 * were kept) adds nothing to the ratio.
 */
export function aggregateFinalizedCategoryTotals(
  scores: ReadonlyArray<{ memberId: string; categoriesJson: unknown }>,
  category: FantasyCategoryKey
): Map<string, number | null> {
  const aggregation = categoryAggregation(category);
  const totalsByMemberId = new Map<string, number>();
  const partsByMemberId = new Map<string, RatioParts>();

  for (const score of scores) {
    // Finalized score rows are normalized so the owning member is the home side.
    const selectedCategory = parseStoredCategoryRows(score.categoriesJson).find(
      (row) => row.category === category
    );
    totalsByMemberId.set(
      score.memberId,
      (totalsByMemberId.get(score.memberId) ?? 0) + (selectedCategory?.homeValue ?? 0)
    );
    const parts = partsByMemberId.get(score.memberId) ?? { numerator: 0, denominator: 0 };
    partsByMemberId.set(score.memberId, {
      numerator: parts.numerator + (selectedCategory?.homeRatio?.numerator ?? 0),
      denominator: parts.denominator + (selectedCategory?.homeRatio?.denominator ?? 0),
    });
  }

  if (aggregation.kind === 'sum') return totalsByMemberId;
  return new Map(
    [...partsByMemberId].map(([memberId, { numerator, denominator }]) => [
      memberId,
      denominator > 0 ? (numerator / denominator) * aggregation.scale : null,
    ])
  );
}

/** A matchup's category rows from the away member's side: values, ratio parts and winner swapped. */
export function mirrorCategoryRows<Row extends CategoryScoreResult>(rows: readonly Row[]): Row[] {
  return rows.map((row) => {
    const { homeRatio, awayRatio, ...rest } = row;
    return {
      ...rest,
      homeValue: row.awayValue,
      awayValue: row.homeValue,
      ...(homeRatio && awayRatio ? { homeRatio: awayRatio, awayRatio: homeRatio } : {}),
      winner: row.winner === 'home' ? 'away' : row.winner === 'away' ? 'home' : 'draw',
    } as Row;
  });
}

function buildCategoryRows({
  categories,
  categoryDirections,
  categoriesJson,
}: {
  categories: FantasyCategoryKey[];
  categoryDirections: ReturnType<typeof normalizeCategoryDirections>;
  categoriesJson: unknown;
}): LeagueMatchupCategoryRow[] {
  const storedRowsByCategory = new Map(
    parseStoredCategoryRows(categoriesJson).map((row) => [row.category, row])
  );

  return categories.map((category) => {
    const storedRow = storedRowsByCategory.get(category);
    const meta = FANTASY_CATEGORIES[category];

    return {
      category,
      label: meta?.label ?? category,
      shortLabel: meta?.shortLabel ?? meta?.abbrev ?? category,
      homeValue: storedRow ? storedRow.homeValue : 0,
      awayValue: storedRow ? storedRow.awayValue : 0,
      direction: storedRow?.direction ?? categoryDirections[category] ?? 'HIGH_WINS',
      winner: storedRow?.winner ?? 'draw',
    };
  });
}

function buildTeamSummary({
  member,
  score,
  players,
}: {
  member: { id: string; teamName: string; teamLogoUrl: string | null } | null;
  score:
    | {
        categoryWins: number;
        categoryLosses: number;
        categoryDraws: number;
        pointsFor: number;
        pointsAgainst: number;
        matchupWin: boolean;
        matchupLoss: boolean;
        matchupDraw: boolean;
      }
    | undefined;
  players: LeagueMatchupPlayerContribution[];
}): LeagueMatchupTeamSummary | null {
  if (!member) return null;

  return {
    id: member.id,
    teamName: member.teamName,
    teamLogoUrl: member.teamLogoUrl,
    categoryWins: score?.categoryWins ?? 0,
    categoryLosses: score?.categoryLosses ?? 0,
    categoryDraws: score?.categoryDraws ?? 0,
    pointsFor: score?.pointsFor ?? 0,
    pointsAgainst: score?.pointsAgainst ?? 0,
    matchupWin: score?.matchupWin ?? false,
    matchupLoss: score?.matchupLoss ?? false,
    matchupDraw: score?.matchupDraw ?? false,
    players,
  };
}

const TEAM_SHEET_SLOT_ORDER: Record<string, number> = {
  DEF: 0,
  MID: 1,
  RUC: 2,
  FWD: 3,
  UTIL: 4,
  INTERCHANGE: 5,
};

function buildPlayerContributions({
  lineup,
  categories,
  totalsByPlayerId,
  noLosersViews,
}: {
  lineup:
    | {
        players: Array<{
          playerId: string;
          slot: string;
          slotIndex: number;
          player: { name: string; position: string };
        }>;
      }
    | undefined;
  categories: FantasyCategoryKey[];
  totalsByPlayerId: Map<string, CategoryTotals>;
  noLosersViews?: Map<string, NoLosersPlayerView>;
}): LeagueMatchupPlayerContribution[] {
  return (
    lineup?.players
      .filter((lineupPlayer) => lineupPlayer.slot !== 'BENCH')
      .map((lineupPlayer) => {
        const totals = totalsByPlayerId.get(lineupPlayer.playerId) ?? {};
        const noLosers = noLosersViews?.get(lineupPlayer.playerId);
        const categoryValues = categories.map((category) => ({
          category,
          shortLabel:
            FANTASY_CATEGORIES[category]?.shortLabel ??
            FANTASY_CATEGORIES[category]?.abbrev ??
            category,
          value: totals[category] ?? 0,
        }));

        return {
          playerId: lineupPlayer.playerId,
          name: lineupPlayer.player.name,
          position: lineupPlayer.player.position,
          slot: lineupPlayer.slot,
          slotIndex: lineupPlayer.slotIndex,
          total: sumCategoryTotals(totals, categories),
          hasStats: totalsByPlayerId.has(lineupPlayer.playerId),
          ...(noLosers ? { noLosers } : {}),
          categories: categoryValues,
        };
      })
      .sort(
        (a, b) =>
          (TEAM_SHEET_SLOT_ORDER[a.slot] ?? 99) - (TEAM_SHEET_SLOT_ORDER[b.slot] ?? 99) ||
          a.slotIndex - b.slotIndex
      ) ?? []
  );
}

type MatchupCardLineup = {
  players: Array<{
    playerId: string;
    slot: string;
    slotIndex: number;
    player: { name: string; position: string };
  }>;
};

function aggregateCardLineupTotals(
  lineup: MatchupCardLineup | undefined,
  categories: FantasyCategoryKey[],
  totalsByPlayerId: Map<string, CategoryTotals>
): CategoryTotals {
  return aggregateLineupCategoryTotals({
    categories,
    players:
      lineup?.players.map((player) => ({
        playerId: player.playerId,
        slot: player.slot as LeagueLineupSlot,
        totals: totalsByPlayerId.get(player.playerId) ?? {},
      })) ?? [],
  });
}

/**
 * Until a matchup is final, its card is scored from the same live stats as its player rows, so the
 * headline cannot claim every category is drawn while the rows show real numbers. The result is
 * provisional: autosubs and finalization can still change it. When live stats cannot be loaded the
 * stored state is shown as before.
 */
export function buildMatchupCard({
  matchup,
  categories,
  categoryDirections,
  scoringMode,
  lineupsByMemberId,
  totalsByPlayerId: rawTotalsByPlayerId,
  liveRound,
  noLosers,
}: {
  matchup: Awaited<ReturnType<typeof prisma.leagueMatchup.findMany>>[number] & {
    homeMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    awayMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    byeMember: { id: string; teamName: string; teamLogoUrl: string | null } | null;
    scores: Array<{
      memberId: string;
      categoriesJson: unknown;
      categoryWins: number;
      categoryLosses: number;
      categoryDraws: number;
      pointsFor: number;
      pointsAgainst: number;
      matchupWin: boolean;
      matchupLoss: boolean;
      matchupDraw: boolean;
    }>;
  };
  categories: FantasyCategoryKey[];
  categoryDirections: ReturnType<typeof normalizeCategoryDirections>;
  scoringMode: LeagueScoringMode;
  lineupsByMemberId: Map<string, MatchupCardLineup>;
  totalsByPlayerId: Map<string, CategoryTotals>;
  /** Whether the round's live stats loaded, and whether any AFL game in it has started. */
  liveRound: { available: boolean; started: boolean };
  /** No Losers leagues only: the round's stored results (BR-20: nothing is guessed). */
  noLosers?: NoLosersRoundContext;
}): LeagueMatchupCard {
  const { totalsByPlayerId, noLosersViews, waitingOnResults } = applyNoLosersToCard({
    context: noLosers,
    lineups: cardLineups([matchup.homeMemberId, matchup.awayMemberId], lineupsByMemberId),
    totalsByPlayerId: rawTotalsByPlayerId,
  });
  const provisionalResult =
    matchup.status !== 'FINAL' &&
    matchup.homeMemberId &&
    matchup.awayMemberId &&
    liveRound.available
      ? scoreHeadToHeadCategories({
          categories,
          categoryDirections,
          homeTotals: aggregateCardLineupTotals(
            lineupsByMemberId.get(matchup.homeMemberId),
            categories,
            totalsByPlayerId
          ),
          awayTotals: aggregateCardLineupTotals(
            lineupsByMemberId.get(matchup.awayMemberId),
            categories,
            totalsByPlayerId
          ),
          scoringMode,
        })
      : null;
  const homeScore = matchup.scores.find((score) => score.memberId === matchup.homeMemberId);
  const awayScore = matchup.scores.find((score) => score.memberId === matchup.awayMemberId);
  const sidePlayers = (memberId: string | null) =>
    buildSidePlayers({
      memberId,
      lineupsByMemberId,
      categories,
      totalsByPlayerId,
      noLosersViews,
    });
  const homePlayers = sidePlayers(matchup.homeMemberId);
  const awayPlayers = sidePlayers(matchup.awayMemberId);

  return {
    id: matchup.id,
    round: matchup.round,
    status: provisionalResult ? (liveRound.started ? 'LIVE' : 'SCHEDULED') : matchup.status,
    provisional: provisionalResult !== null && liveRound.started,
    startsAt: toIsoString(matchup.startsAt),
    endsAt: toIsoString(matchup.endsAt),
    finalizedAt: toIsoString(matchup.finalizedAt),
    winnerMemberId: matchup.winnerMemberId,
    homeMember: buildTeamSummary({
      member: matchup.homeMember,
      score: homeScore,
      players: homePlayers,
    }),
    awayMember: buildTeamSummary({
      member: matchup.awayMember,
      score: awayScore,
      players: awayPlayers,
    }),
    byeMember: matchup.byeMember
      ? {
          id: matchup.byeMember.id,
          teamName: matchup.byeMember.teamName,
          teamLogoUrl: matchup.byeMember.teamLogoUrl,
        }
      : null,
    homeCategoryWins: provisionalResult?.homeCategoryWins ?? matchup.homeCategoryWins,
    awayCategoryWins: provisionalResult?.awayCategoryWins ?? matchup.awayCategoryWins,
    drawnCategories: provisionalResult?.drawnCategories ?? matchup.drawnCategories,
    categoryRows: buildCategoryRows({
      categories,
      categoryDirections,
      categoriesJson: provisionalResult?.categories ?? homeScore?.categoriesJson,
    }),
    ...noLosersWaitingFields(waitingOnResults, matchup.status),
  };
}

function cardLineups(
  memberIds: ReadonlyArray<string | null>,
  lineupsByMemberId: Map<string, MatchupCardLineup>
): MatchupCardLineup[] {
  return memberIds.flatMap((memberId) => {
    const lineup = memberId ? lineupsByMemberId.get(memberId) : undefined;
    return lineup ? [lineup] : [];
  });
}

function buildSidePlayers({
  memberId,
  lineupsByMemberId,
  ...input
}: {
  memberId: string | null;
  lineupsByMemberId: Map<string, MatchupCardLineup>;
  categories: FantasyCategoryKey[];
  totalsByPlayerId: Map<string, CategoryTotals>;
  noLosersViews?: Map<string, NoLosersPlayerView>;
}): LeagueMatchupPlayerContribution[] {
  return memberId
    ? buildPlayerContributions({ lineup: lineupsByMemberId.get(memberId), ...input })
    : [];
}

/** A No Losers card that is not final says which results it is waiting on. */
function noLosersWaitingFields(
  waitingOnResults: string[] | undefined,
  status: string
): { waitingOnResults?: string[] } {
  return waitingOnResults && status !== 'FINAL' ? { waitingOnResults } : {};
}

/**
 * BR-20: a No Losers card's player rows and provisional totals. A player whose game has a stored
 * result shows counted totals and his multiplier; one whose result is not stored yet shows raw
 * stats marked pending. Players without a stat row stay absent, as in every league (#1270).
 */
function applyNoLosersToCard({
  context,
  lineups,
  totalsByPlayerId,
}: {
  /** Absent outside No Losers leagues: the card's raw totals pass through unchanged. */
  context: NoLosersRoundContext | undefined;
  lineups: readonly MatchupCardLineup[];
  totalsByPlayerId: Map<string, CategoryTotals>;
}): {
  totalsByPlayerId: Map<string, CategoryTotals>;
  noLosersViews?: Map<string, NoLosersPlayerView>;
  waitingOnResults?: string[];
} {
  if (!context) return { totalsByPlayerId };
  const counted = new Map(totalsByPlayerId);
  const views = new Map<string, NoLosersPlayerView>();
  const scored = lineups.flatMap((lineup) => {
    const score = scoreNoLosersLineup(
      lineup.players.map((player) => ({
        playerId: player.playerId,
        slot: player.slot as LeagueLineupSlot,
        totals: totalsByPlayerId.get(player.playerId) ?? {},
      })),
      context
    );
    for (const player of score.players) {
      if (totalsByPlayerId.has(player.playerId)) counted.set(player.playerId, player.totals);
    }
    for (const player of score.rule.players) {
      const view = noLosersPlayerView(player);
      if (view) views.set(player.playerId, view);
    }
    return score.rule.players;
  });
  return {
    totalsByPlayerId: counted,
    noLosersViews: views,
    waitingOnResults: noLosersWaitingOn(context, scored),
  };
}

export function toMatchupStatusFromRoundStatus(
  status: Pick<NormalizedRoundMatchStatus, 'anyLive' | 'allFinal'>
) {
  if (status.allFinal) return 'FINAL' as const;
  if (status.anyLive) return 'LIVE' as const;
  return 'SCHEDULED' as const;
}

/**
 * A round is final only when every matchup with two teams has been scored. A matchup left unscored
 * (an empty lineup) keeps the round open, so it cannot drop out of the standings for good.
 */
export function resolveRecalculatedMatchupStatus({
  finalize,
  unresolvedMatchups,
  roundStatus,
}: {
  finalize: boolean;
  unresolvedMatchups: number;
  roundStatus: Pick<NormalizedRoundMatchStatus, 'anyLive' | 'allFinal'>;
}) {
  if (unresolvedMatchups === 0 && (finalize || roundStatus.allFinal)) return 'FINAL' as const;
  return toMatchupStatusFromRoundStatus({ anyLive: roundStatus.anyLive, allFinal: false });
}

export function resolveAflRoundForScoring({
  fixtureVersion,
  fantasyRound,
  competitionRoundAflRound,
}: {
  fixtureVersion: number;
  fantasyRound: number;
  competitionRoundAflRound: number | null;
}): number | null {
  return fixtureVersion === 0 ? fantasyRound : competitionRoundAflRound;
}

function normalizeLeagueCategories(value: unknown): FantasyCategoryKey[] {
  return normalizeFantasyCategoryKeys(value, REAL_DATA_NINE_CATEGORY_PRESET);
}

export function resolveRoundPlayerAvailability({
  stats,
  matches,
  expectedPlayers,
  statlyPlayerIds = new Set(),
}: {
  stats: readonly NormalizedLiveStatRow[];
  matches: readonly RawRoundMatch[];
  expectedPlayers: readonly { playerId: string; club: string | null }[];
  /** Stat row player ids known to be Statly players; proves a club's team sheet is mapped. */
  statlyPlayerIds?: ReadonlySet<string>;
}) {
  const totalsByPlayerId = new Map<string, CategoryTotals>();
  const nonPlayingReasonByPlayerId = new Map<string, 'DID_NOT_PLAY' | 'CLUB_BYE'>();

  for (const stat of stats) {
    totalsByPlayerId.set(stat.playerId, stat.totals);
    if (stat.confirmedDidNotPlay) {
      nonPlayingReasonByPlayerId.set(stat.playerId, 'DID_NOT_PLAY');
    }
  }

  const confirmedByeClubs = new Set(
    matches.flatMap((match) =>
      Array.isArray(match.confirmed_bye_teams)
        ? match.confirmed_bye_teams.flatMap((club) =>
            typeof club === 'string' && club.trim() ? [getTeamName(club)] : []
          )
        : []
    )
  );
  for (const player of expectedPlayers) {
    if (
      !totalsByPlayerId.has(player.playerId) &&
      player.club &&
      confirmedByeClubs.has(getTeamName(player.club))
    ) {
      totalsByPlayerId.set(player.playerId, {});
      nonPlayingReasonByPlayerId.set(player.playerId, 'CLUB_BYE');
    }
  }
  for (const playerId of inferUnselectedDidNotPlay({
    stats,
    matches,
    players: expectedPlayers.filter((player) => !totalsByPlayerId.has(player.playerId)),
    statlyPlayerIds,
  })) {
    totalsByPlayerId.set(playerId, {});
    nonPlayingReasonByPlayerId.set(playerId, 'DID_NOT_PLAY');
  }

  return { totalsByPlayerId, nonPlayingReasonByPlayerId };
}

/**
 * The ETL keys stats by its Footywire player id. Only a reviewed `footywire` identity link turns
 * that id into a Statly player id; unlinked rows keep the ETL id, so they reach no Statly player and
 * are reported for review (docs/runbooks/player-identity.md), never matched by name here.
 */
async function linkEtlStatsToPlayers(
  rows: readonly NormalizedLiveStatRow[],
  season: number,
  round: number
): Promise<NormalizedLiveStatRow[]> {
  const playerIdByEtlId = await resolveFootywirePlayerIds(
    rows.map((row) => row.playerId),
    prisma
  );
  const unlinked = rows.filter((row) => !playerIdByEtlId.has(row.playerId));
  if (unlinked.length > 0) {
    logger.warn('ETL player stats without a reviewed Footywire identity link', {
      season,
      round,
      unlinkedCount: unlinked.length,
    });
  }
  return rows.map((row) => ({
    ...row,
    playerId: playerIdByEtlId.get(row.playerId) ?? row.playerId,
  }));
}

export async function loadLivePlayerTotalsForRound(
  season: number,
  round: number,
  expectedPlayers: readonly { playerId: string; club: string | null }[] = [],
  /** The league's scoring categories: a row lacking a stat one is computed from counts as missing. */
  categories: readonly FantasyCategoryKey[] = []
) {
  const [statsResult, matchesResult] = await Promise.all([
    getRoundPlayerStatsResult(season, round),
    getRoundMatchesResult(season, round),
  ]);
  const rawMatches = (matchesResult.ok ? matchesResult.matches : []) as unknown as RawRoundMatch[];
  const normalizedStats = await linkEtlStatsToPlayers(
    normalizeLiveStatRows(
      (statsResult.ok ? statsResult.stats : []) as unknown as RawLiveStatRow[],
      rawMatches
    ).filter((row) => row.round === round),
    season,
    round
  );
  const { totalsByPlayerId, nonPlayingReasonByPlayerId } = resolveRoundPlayerAvailability({
    stats: normalizedStats,
    matches: rawMatches,
    expectedPlayers,
    statlyPlayerIds: await loadTeamSheetStatlyPlayerIds({
      stats: normalizedStats,
      matches: rawMatches,
      players: expectedPlayers,
    }),
  });

  // An unreported stat is unavailable, never 0: a player who played but whose row lacks a stat one
  // of the league's categories is computed from (for DE%, effective disposals and disposals) holds
  // the round unscored, like a player with no row at all.
  const incompletePlayerIds = new Set(
    normalizedStats
      .filter(
        (row) =>
          !row.confirmedDidNotPlay &&
          categories
            .flatMap(categoryStatInputs)
            .some((key) => row.unreportedCategories.includes(key))
      )
      .map((row) => row.playerId)
  );
  const missingPlayerIds = [...new Set(expectedPlayers.map((player) => player.playerId))].filter(
    (playerId) => !totalsByPlayerId.has(playerId) || incompletePlayerIds.has(playerId)
  );
  const available = statsResult.ok && matchesResult.ok && missingPlayerIds.length === 0;

  return {
    available,
    missingPlayerIds,
    totalsByPlayerId,
    nonPlayingReasonByPlayerId,
    roundStatus: normalizeRoundMatchStatus(rawMatches),
    statRows: normalizedStats,
    rawMatches,
  };
}

async function loadLeagueCompetitionSettings(leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league?.settings) return null;

  const categories = normalizeLeagueCategories(league.categoriesJson);
  const fixtureGenerationMode: 'AUTOMATIC' | 'MANUAL' =
    league.settings.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';
  return {
    league,
    categories,
    scoringMode: league.settings.scoringMode as LeagueScoringMode,
    leagueFormat: league.settings.leagueFormat,
    fixtureGenerationMode,
    lineupSlots: normalizeLineupSlots(league.settings.lineupSlotsJson),
    categoryDirections: normalizeCategoryDirections(
      categories,
      league.settings.categoryDirectionsJson
    ),
    competitionStatus: league.settings.competitionStatus,
    competitionRules: normalizeCompetitionRules(
      league.settings.competitionRulesJson,
      categories[0] ?? 'goals'
    ),
  };
}

export function resolveCurrentCompetitionRound<
  TRound extends {
    round: number;
    status: string;
    startsAt: Date | null;
    endsAt: Date | null;
  },
>(rounds: readonly TRound[], now = new Date()): TRound | null {
  const playableRounds = rounds.filter(
    (competitionRound) => competitionRound.status !== 'NO_MATCHUP'
  );
  if (!playableRounds.length) return rounds[0] ?? null;

  const startedRounds = playableRounds.filter(
    (competitionRound) =>
      competitionRound.startsAt &&
      competitionRound.startsAt <= now &&
      (!competitionRound.endsAt || competitionRound.endsAt >= now)
  );
  const latestStartedRound = startedRounds.reduce<TRound | null>(
    (latest, competitionRound) =>
      !latest || competitionRound.round > latest.round ? competitionRound : latest,
    null
  );

  return (
    latestStartedRound ??
    playableRounds.find(
      (competitionRound) => !competitionRound.startsAt || competitionRound.startsAt > now
    ) ??
    playableRounds.at(-1) ??
    null
  );
}

export async function loadLeagueMatchupReadModel({
  leagueId,
  userId,
  round,
  canManage,
}: {
  leagueId: string;
  userId: string;
  round?: number;
  canManage: boolean;
}): Promise<LeagueMatchupReadModel | null> {
  const settings = await loadLeagueCompetitionSettings(leagueId);
  if (!settings) return null;

  const viewerMember = await prisma.leagueMember.findFirst({
    where: { leagueId, userId },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (!viewerMember) return null;

  const viewerMatchupWhere = {
    leagueId,
    fixtureVersion: settings.league.settings.competitionRulesVersion,
    OR: [
      { homeMemberId: viewerMember.id },
      { awayMemberId: viewerMember.id },
      { byeMemberId: viewerMember.id },
    ],
  };
  const competitionRounds =
    settings.competitionStatus === 'SETUP'
      ? []
      : await prisma.leagueCompetitionRound.findMany({
          where: {
            leagueId,
            fixtureVersion: settings.league.settings.competitionRulesVersion,
          },
          orderBy: { round: 'asc' },
          include: { season: { select: { year: true } } },
        });
  const availableRounds = competitionRounds.map((competitionRound) => competitionRound.round);
  const resolvedRound = resolveCurrentCompetitionRound(competitionRounds);
  const activeRound =
    round && availableRounds.includes(round) ? round : (resolvedRound?.round ?? 1);
  const activeCompetitionRound =
    competitionRounds.find((competitionRound) => competitionRound.round === activeRound) ?? null;
  const [matchups, persistedStandings, finalizedScores, members] = await Promise.all([
    prisma.leagueMatchup.findMany({
      where: { ...viewerMatchupWhere, round: activeRound },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        homeMember: true,
        awayMember: true,
        byeMember: true,
        scores: true,
      },
    }),
    prisma.leagueStanding.findMany({
      where: { leagueId, seasonId: activeSeasonIdOf(settings.league) },
      orderBy: [{ wins: 'desc' }, { categoryWins: 'desc' }],
    }),
    prisma.leagueMatchupScore.findMany({
      where: {
        leagueId,
        seasonId: activeSeasonIdOf(settings.league),
        status: 'FINAL',
        matchup: {
          fixtureVersion: settings.league.settings.competitionRulesVersion,
          phase: 'REGULAR',
        },
      },
      select: { memberId: true, categoriesJson: true },
    }),
    prisma.leagueMember.findMany({
      // Removed managers keep their rows but no longer have a team on the ladder.
      where: { leagueId, isActive: true },
      select: { id: true, teamName: true, teamLogoUrl: true, draftSlot: true },
    }),
  ]);
  const liveTotals = activeCompetitionRound?.aflRound
    ? await loadLivePlayerTotalsForRound(
        activeCompetitionRound.season?.year ?? new Date().getFullYear(),
        activeCompetitionRound.aflRound
      )
    : {
        available: false,
        totalsByPlayerId: new Map<string, CategoryTotals>(),
        statRows: [],
        rawMatches: [],
        roundStatus: {
          earliestStartAt: null,
          latestEndAt: null,
          anyLive: false,
          allFinal: false,
          hasUnavailableStatus: true,
          matches: [],
        },
      };
  const visibleMemberIds = [
    ...new Set(
      matchups.flatMap((matchup) =>
        [matchup.homeMemberId, matchup.awayMemberId].filter((memberId): memberId is string =>
          Boolean(memberId)
        )
      )
    ),
  ];
  const lineups =
    visibleMemberIds.length > 0
      ? await prisma.leagueLineup.findMany({
          where: {
            leagueId,
            seasonId: activeSeasonIdOf(settings.league),
            round: activeRound,
            memberId: { in: visibleMemberIds },
          },
          include: {
            players: {
              include: { player: true },
              orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
            },
          },
        })
      : [];
  const lineupsByMemberId = new Map(lineups.map((lineup) => [lineup.memberId, lineup]));
  const noLosers =
    settings.leagueFormat === 'NO_LOSERS' && liveTotals.available && activeCompetitionRound
      ? await loadNoLosersRoundContext({
          season: activeCompetitionRound.season?.year ?? new Date().getFullYear(),
          statRows: liveTotals.statRows,
          matches: liveTotals.rawMatches,
        })
      : undefined;
  const tieBreakCategoryTotalByMemberId = aggregateFinalizedCategoryTotals(
    finalizedScores,
    settings.competitionRules.standingsTieBreakCategory
  );

  return {
    leagueId,
    round: activeRound,
    competitionStatus: settings.competitionStatus,
    scoringMode: settings.scoringMode,
    fixtureGenerationMode: settings.fixtureGenerationMode,
    categories: settings.categories,
    lineupSlots: settings.lineupSlots,
    categoryDirections: settings.categoryDirections,
    availableRounds,
    roundContext: activeCompetitionRound
      ? {
          round: activeCompetitionRound.round,
          aflRound: activeCompetitionRound.aflRound,
          phase: activeCompetitionRound.phase,
          status: activeCompetitionRound.status,
          startsAt: toIsoString(activeCompetitionRound.startsAt),
          endsAt: toIsoString(activeCompetitionRound.endsAt),
          fallbackLockAt: toIsoString(activeCompetitionRound.fallbackLockAt),
        }
      : null,
    matchups: matchups.map((matchup) =>
      buildMatchupCard({
        matchup,
        categories: settings.categories,
        categoryDirections: settings.categoryDirections,
        scoringMode: settings.scoringMode,
        lineupsByMemberId,
        totalsByPlayerId: liveTotals.totalsByPlayerId,
        liveRound: {
          available: liveTotals.available,
          started: liveTotals.roundStatus.matches.some(
            (match) => match.status === 'live' || match.status === 'final'
          ),
        },
        noLosers,
      })
    ),
    standings: buildLeagueStandings({
      members,
      standings: persistedStandings,
      tieBreakCategoryTotalByMemberId,
      tieBreakDirection:
        settings.categoryDirections[settings.competitionRules.standingsTieBreakCategory],
    }),
    permissions: { canManage },
  };
}

/** Bounds the scoring write (a league's matchups and members), not the stats fetch before it. */
const ROUND_SCORING_TRANSACTION_TIMEOUT_MS = 30_000;

export async function recalculateLeagueRoundMatchups({
  leagueId,
  round,
  finalize,
  actorMemberId,
}: {
  leagueId: string;
  round: number;
  finalize?: boolean;
  /** The commissioner who asked for it; none means the scheduled job. Recorded on FINAL rescores. */
  actorMemberId?: string;
}) {
  const settings = await loadLeagueCompetitionSettings(leagueId);
  if (!settings) return null;

  const fixtureVersion = settings.league.settings.competitionRulesVersion;
  const seasonId = activeSeasonIdOf(settings.league);
  const [competitionRound, matchups, initialLineups, members] = await Promise.all([
    fixtureVersion > 0
      ? prisma.leagueCompetitionRound.findUnique({
          where: { leagueId_fixtureVersion_round: { leagueId, fixtureVersion, round } },
          select: { aflRound: true, season: { select: { year: true } } },
        })
      : Promise.resolve(null),
    prisma.leagueMatchup.findMany({ where: { leagueId, round, fixtureVersion } }),
    prisma.leagueLineup.findMany({
      where: { leagueId, seasonId, round },
      include: { players: { include: { player: true } } },
    }),
    prisma.leagueMember.findMany({
      // Removed managers keep their rows but no longer have a team on the ladder.
      where: { leagueId, isActive: true },
      select: { id: true, teamName: true, teamLogoUrl: true, draftSlot: true },
    }),
  ]);
  const aflRound = resolveAflRoundForScoring({
    fixtureVersion,
    fantasyRound: round,
    competitionRoundAflRound: competitionRound?.aflRound ?? null,
  });
  if (aflRound === null) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      roundStatus: {
        earliestStartAt: null,
        latestEndAt: null,
        anyLive: false,
        allFinal: false,
        hasUnavailableStatus: true,
        matches: [],
      },
    };
  }
  // A finalized round with an unscored matchup is left as it is. Recalculating it would demote the
  // FINAL scores of its other matchups, and filling the missing lineup would score that matchup silently.
  const hasPlayers = (memberId: string) =>
    (initialLineups.find((lineup) => lineup.memberId === memberId)?.players.length ?? 0) > 0;
  const unscoredMatchupIds = matchups
    .filter(
      (matchup) =>
        matchup.homeMemberId &&
        matchup.awayMemberId &&
        matchup.status !== 'FINAL' &&
        !(hasPlayers(matchup.homeMemberId) && hasPlayers(matchup.awayMemberId))
    )
    .map((matchup) => matchup.id);
  if (unscoredMatchupIds.length > 0 && matchups.some((matchup) => matchup.status === 'FINAL')) {
    return {
      round,
      status: 'FINAL' as const,
      recalculated: 0,
      scores: [],
      blocked: 'UNSCORED_MATCHUP_IN_FINAL_ROUND' as const,
      unscoredMatchupIds,
      roundStatus: {
        earliestStartAt: null,
        latestEndAt: null,
        anyLive: false,
        allFinal: false,
        hasUnavailableStatus: true,
        matches: [],
      },
    };
  }
  // Managers only confirm changes: anyone without a saved lineup for this round gets their
  // default (last round's team, gaps filled by position, or a team picked by position).
  const participantMemberIds = matchups.flatMap((matchup) =>
    matchup.homeMemberId && matchup.awayMemberId ? [matchup.homeMemberId, matchup.awayMemberId] : []
  );
  const carriedCount = await ensureDefaultLineups({
    leagueId,
    round,
    memberIds: participantMemberIds,
  });
  const lineups =
    carriedCount > 0
      ? await prisma.leagueLineup.findMany({
          where: { leagueId, seasonId, round },
          include: { players: { include: { player: true } } },
        })
      : initialLineups;
  const lineupsByMemberId = new Map(lineups.map((lineup) => [lineup.memberId, lineup]));
  // Each matchup is scored on its own: one team that has never set a lineup no longer
  // holds up every other matchup in the round.
  const scorableMatchups = matchups.filter(
    (matchup) =>
      matchup.homeMemberId &&
      matchup.awayMemberId &&
      (lineupsByMemberId.get(matchup.homeMemberId)?.players.length ?? 0) > 0 &&
      (lineupsByMemberId.get(matchup.awayMemberId)?.players.length ?? 0) > 0
  );
  const scorableMemberIds = new Set(
    scorableMatchups.flatMap((matchup) => [matchup.homeMemberId, matchup.awayMemberId])
  );
  const scorableLineups = lineups.filter((lineup) => scorableMemberIds.has(lineup.memberId));
  if (scorableMatchups.length === 0) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      roundStatus: {
        earliestStartAt: null,
        latestEndAt: null,
        anyLive: false,
        allFinal: false,
        hasUnavailableStatus: true,
        matches: [],
      },
    };
  }
  const season = competitionRound?.season?.year ?? new Date().getFullYear();
  const {
    available,
    missingPlayerIds,
    totalsByPlayerId,
    nonPlayingReasonByPlayerId,
    roundStatus,
    statRows,
    rawMatches,
  } = await loadLivePlayerTotalsForRound(
    season,
    aflRound,
    scorableLineups.flatMap((lineup) =>
      lineup.players.map((assignment) => ({
        playerId: assignment.playerId,
        club: assignment.player.club,
      }))
    ),
    settings.categories
  );
  if (!available) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      // Lineup players with no stat totals; the scheduled job reports them when the round stalls.
      missingPlayerIds,
      roundStatus: { ...roundStatus, hasUnavailableStatus: true },
    };
  }
  // A commissioner cannot finalize a round before every AFL match in it is final.
  if (finalize && !roundStatus.allFinal) {
    return {
      round,
      status: 'SCHEDULED' as const,
      recalculated: 0,
      scores: [],
      blocked: 'AFL_MATCHES_NOT_FINAL' as const,
      roundStatus,
    };
  }
  const unresolvedMatchupIds = matchups
    .filter(
      (matchup) =>
        matchup.homeMemberId && matchup.awayMemberId && !scorableMatchups.includes(matchup)
    )
    .map((matchup) => matchup.id);
  const recalculatedStatus = resolveRecalculatedMatchupStatus({
    finalize: Boolean(finalize),
    unresolvedMatchups: unresolvedMatchupIds.length,
    roundStatus,
  });
  const resolvedLineups =
    roundStatus.allFinal && nonPlayingReasonByPlayerId.size > 0
      ? await Promise.all(
          scorableLineups.map(async (lineup) => ({
            ...lineup,
            players: await resolveAndPersistLineupAutosubs({
              leagueId,
              lineupId: lineup.id,
              players: lineup.players,
              nonPlayingReasonByPlayerId,
            }),
          }))
        )
      : scorableLineups;
  const resolvedLineupsByMemberId = new Map(
    resolvedLineups.map((lineup) => [lineup.memberId, lineup])
  );
  // No Losers (#1294): each side is scored on counted totals (autosubs above are unchanged, BR-18).
  const noLosers =
    settings.leagueFormat === 'NO_LOSERS'
      ? await loadNoLosersRoundContext({ season, statRows, matches: rawMatches })
      : null;
  const lineupScoringPlayers = (memberId: string) =>
    resolvedLineupsByMemberId.get(memberId)?.players.map((player) => ({
      playerId: player.playerId,
      slot: player.slot,
      totals: totalsByPlayerId.get(player.playerId) ?? {},
    })) ?? [];
  const noLosersScores = new Map<string, NoLosersLineupScore>(
    noLosers
      ? [...scorableMemberIds].flatMap((memberId) =>
          memberId
            ? [[memberId, scoreNoLosersLineup(lineupScoringPlayers(memberId), noLosers)] as const]
            : []
        )
      : []
  );
  // BR-08: a No Losers round cannot be FINAL while a game's result is missing or a counted player
  // cannot be joined to his; it stays LIVE and names the game.
  const waitingOnResults = noLosers
    ? noLosersWaitingOn(
        noLosers,
        [...noLosersScores.values()].flatMap((score) => score.rule.players)
      )
    : [];
  if (finalize && waitingOnResults.length > 0) {
    return {
      round,
      status: 'LIVE' as const,
      recalculated: 0,
      scores: [],
      blocked: 'AFL_RESULTS_MISSING' as const,
      waitingOnResults,
      roundStatus,
    };
  }
  const status =
    recalculatedStatus === 'FINAL' && waitingOnResults.length > 0 ? 'LIVE' : recalculatedStatus;
  const scoringPlayers = (memberId: string) =>
    noLosersScores.get(memberId)?.players ?? lineupScoringPlayers(memberId);
  const finalizedAt = status === 'FINAL' ? new Date() : null;
  const calculatedScores = scorableMatchups.flatMap((matchup) => {
    if (!matchup.homeMemberId || !matchup.awayMemberId) return [];

    const homeTotals = aggregateLineupCategoryTotals({
      categories: settings.categories,
      players: scoringPlayers(matchup.homeMemberId),
    });
    const awayTotals = aggregateLineupCategoryTotals({
      categories: settings.categories,
      players: scoringPlayers(matchup.awayMemberId),
    });
    const result = scoreHeadToHeadCategories({
      categories: settings.categories,
      categoryDirections: settings.categoryDirections,
      homeTotals,
      awayTotals,
      scoringMode: settings.scoringMode,
    });
    const homePointsFor = sumCategoryTotals(homeTotals, settings.categories);
    const awayPointsFor = sumCategoryTotals(awayTotals, settings.categories);
    return [
      {
        matchupId: matchup.id,
        homeMemberId: matchup.homeMemberId,
        awayMemberId: matchup.awayMemberId,
        result,
        homePointsFor,
        awayPointsFor,
      },
    ];
  });

  // Scores, the round status and the standings are written in one transaction, so a crash or timeout
  // cannot leave some matchups final while the round and the ladder are stale. The no-op write on the
  // league row (as in joinLeague) makes a second run for the same league wait for this one, so two
  // runs cannot interleave their standings.
  const finalized = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`UPDATE "League" SET "ownerId" = "ownerId" WHERE "id" = ${leagueId}`;
      const finalBefore = await loadFinalMatchupSnapshots(
        tx,
        leagueId,
        calculatedScores.map((scored) => scored.matchupId)
      );
      const resultAfter = new Map<string, MatchupResultSnapshot>();

      for (const scored of calculatedScores) {
        const winnerMemberId = scored.result.matchupDraw
          ? null
          : scored.result.homeMatchupWin
            ? scored.homeMemberId
            : scored.awayMemberId;
        await tx.leagueMatchup.update({
          where: { id: scored.matchupId },
          data: {
            status,
            finalizedAt,
            winnerMemberId,
            homeCategoryWins: scored.result.homeCategoryWins,
            awayCategoryWins: scored.result.awayCategoryWins,
            drawnCategories: scored.result.drawnCategories,
          },
        });
        resultAfter.set(scored.matchupId, {
          status,
          winnerMemberId,
          homeCategoryWins: scored.result.homeCategoryWins,
          awayCategoryWins: scored.result.awayCategoryWins,
          drawnCategories: scored.result.drawnCategories,
          scores: [
            {
              memberId: scored.homeMemberId,
              categoriesJson: scored.result.categories,
              pointsFor: scored.homePointsFor,
            },
            {
              memberId: scored.awayMemberId,
              categoriesJson: mirrorCategoryRows(scored.result.categories),
              pointsFor: scored.awayPointsFor,
            },
          ],
        });
        await tx.leagueMatchupScore.upsert({
          where: {
            matchupId_memberId: { matchupId: scored.matchupId, memberId: scored.homeMemberId },
          },
          create: {
            leagueId,
            seasonId,
            matchupId: scored.matchupId,
            memberId: scored.homeMemberId,
            round,
            categoriesJson: scored.result.categories,
            categoryWins: scored.result.homeCategoryWins,
            categoryLosses: scored.result.awayCategoryWins,
            categoryDraws: scored.result.drawnCategories,
            pointsFor: scored.homePointsFor,
            pointsAgainst: scored.awayPointsFor,
            matchupWin: scored.result.homeMatchupWin,
            matchupLoss: scored.result.awayMatchupWin,
            matchupDraw: scored.result.matchupDraw,
            status,
            finalizedAt,
          },
          update: {
            categoriesJson: scored.result.categories,
            categoryWins: scored.result.homeCategoryWins,
            categoryLosses: scored.result.awayCategoryWins,
            categoryDraws: scored.result.drawnCategories,
            pointsFor: scored.homePointsFor,
            pointsAgainst: scored.awayPointsFor,
            matchupWin: scored.result.homeMatchupWin,
            matchupLoss: scored.result.awayMatchupWin,
            matchupDraw: scored.result.matchupDraw,
            status,
            finalizedAt,
          },
        });
        await tx.leagueMatchupScore.upsert({
          where: {
            matchupId_memberId: { matchupId: scored.matchupId, memberId: scored.awayMemberId },
          },
          create: {
            leagueId,
            seasonId,
            matchupId: scored.matchupId,
            memberId: scored.awayMemberId,
            round,
            categoriesJson: mirrorCategoryRows(scored.result.categories),
            categoryWins: scored.result.awayCategoryWins,
            categoryLosses: scored.result.homeCategoryWins,
            categoryDraws: scored.result.drawnCategories,
            pointsFor: scored.awayPointsFor,
            pointsAgainst: scored.homePointsFor,
            matchupWin: scored.result.awayMatchupWin,
            matchupLoss: scored.result.homeMatchupWin,
            matchupDraw: scored.result.matchupDraw,
            status,
            finalizedAt,
          },
          update: {
            categoriesJson: mirrorCategoryRows(scored.result.categories),
            categoryWins: scored.result.awayCategoryWins,
            categoryLosses: scored.result.homeCategoryWins,
            categoryDraws: scored.result.drawnCategories,
            pointsFor: scored.awayPointsFor,
            pointsAgainst: scored.homePointsFor,
            matchupWin: scored.result.awayMatchupWin,
            matchupLoss: scored.result.homeMatchupWin,
            matchupDraw: scored.result.matchupDraw,
            status,
            finalizedAt,
          },
        });
      }
      if (noLosers) {
        // BR-21: the per-player breakdown is replaced with the team totals it re-derives.
        await tx.leagueMatchupPlayerScore.deleteMany({
          where: { matchupId: { in: calculatedScores.map((scored) => scored.matchupId) } },
        });
        await tx.leagueMatchupPlayerScore.createMany({
          data: calculatedScores.flatMap((scored) =>
            [scored.homeMemberId, scored.awayMemberId].flatMap((memberId) => {
              const score = noLosersScores.get(memberId);
              return score
                ? noLosersPlayerScoreRows(score, noLosers, {
                    leagueId,
                    seasonId,
                    matchupId: scored.matchupId,
                    memberId,
                    round,
                  })
                : [];
            })
          ),
        });
      }
      await recordFinalRoundRescores(tx, {
        leagueId,
        seasonId,
        round,
        actorMemberId: actorMemberId ?? null,
        before: finalBefore,
        after: resultAfter,
      });

      if (status !== 'FINAL') return null;

      if (fixtureVersion > 0) {
        await tx.leagueCompetitionRound.update({
          where: { leagueId_fixtureVersion_round: { leagueId, fixtureVersion, round } },
          data: { status: 'FINAL', lockedAt: new Date() },
        });
      }

      const finalizedScores = await tx.leagueMatchupScore.findMany({
        where: {
          leagueId,
          seasonId,
          status: 'FINAL',
          matchup: { fixtureVersion, phase: 'REGULAR' },
        },
      });
      const standings = calculateStandingsRows({
        scoringMode: settings.scoringMode,
        memberIds: members.map((member) => member.id),
        finalizedScores,
      });

      for (const standing of standings) {
        await tx.leagueStanding.upsert({
          where: {
            leagueId_seasonId_memberId: { leagueId, seasonId, memberId: standing.memberId },
          },
          create: { leagueId, seasonId, ...standing },
          update: standing,
        });
      }

      return { finalizedScores, standings };
    },
    { timeout: ROUND_SCORING_TRANSACTION_TIMEOUT_MS }
  );

  // Finals fixtures follow from the committed standings; a later recalculation re-syncs them.
  if (finalized) {
    const { finalizedScores, standings } = finalized;
    const finalsTeams = settings.competitionRules.finalsTeams;
    const isSupportedFinalsTeamCount = (value: number): value is FinalsTeamCount =>
      value === 4 || value === 6 || value === 8;
    if (fixtureVersion > 0 && isSupportedFinalsTeamCount(finalsTeams)) {
      const incompleteRegularRounds = await prisma.leagueCompetitionRound.count({
        where: {
          leagueId,
          fixtureVersion,
          phase: 'REGULAR',
          status: { notIn: ['FINAL', 'NO_MATCHUP'] },
        },
      });

      if (incompleteRegularRounds === 0) {
        const tieBreakCategoryTotalByMemberId = aggregateFinalizedCategoryTotals(
          finalizedScores,
          settings.competitionRules.standingsTieBreakCategory
        );
        const orderedRegularSeasonMemberIds = buildLeagueStandings({
          members,
          standings: standings.map((standing) => ({
            id: `calculated-${standing.memberId}`,
            ...standing,
          })),
          tieBreakCategoryTotalByMemberId,
          tieBreakDirection:
            settings.categoryDirections[settings.competitionRules.standingsTieBreakCategory],
        })
          .slice(0, finalsTeams)
          .map((standing) => standing.memberId);

        if (orderedRegularSeasonMemberIds.length === finalsTeams) {
          await synchronizeFinalsFixtures({
            leagueId,
            fixtureVersion,
            finalsTeams,
            orderedRegularSeasonMemberIds,
          });
        }
      }
    }
  }

  return {
    round,
    status,
    recalculated: calculatedScores.length,
    scores: calculatedScores.map(({ matchupId, result }) => ({ matchupId, result })),
    // Matchups with two teams left unscored (a team with no lineup); they keep the round from FINAL.
    unresolvedMatchupIds,
    ...(noLosers ? { waitingOnResults } : {}),
    roundStatus,
  };
}
