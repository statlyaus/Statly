import { buildHeadToHeadCategoryScores, type MatchupPlayerStat } from '@/lib/leagueMatchup';
import { buildCanonicalStatSnapshotFromRawDocument } from '@/lib/stats/playerStatSnapshot';
import {
  generateCompleteSchedule,
  type LeagueSettings as ScheduleSettings,
} from '@/lib/scheduling';
import { logger } from '@/lib/logger';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { Firestore } from 'firebase-admin/firestore';

export type LeagueSeasonRoundStatus = 'scheduled' | 'in_progress' | 'final';

export interface LeagueSeasonRound {
  round: number;
  label: string;
  status: LeagueSeasonRoundStatus;
}

export interface LeagueSeasonMember {
  userId: string;
  memberId: string;
  teamName: string;
}

export interface MaterializedCategoryScore {
  key: FantasyCategoryKey;
  label: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
}

export interface MaterializedMatchup {
  id: string;
  leagueId: string;
  season: number;
  week: number;
  aflRound: number | null;
  roundLabel: string;
  status: LeagueSeasonRoundStatus;
  completed: boolean;
  current: boolean;
  participants: string[];
  homeUserId: string;
  awayUserId: string;
  homeMemberId: string;
  awayMemberId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeSummary?: { wins: number; losses: number; ties: number };
  awaySummary?: { wins: number; losses: number; ties: number };
  categoryScores?: MaterializedCategoryScore[];
  winner?: 'home' | 'away' | 'tie';
}

export interface LadderEntry {
  userId: string;
  memberId: string;
  teamName: string;
  ladderRank: number;
  record: { w: number; l: number; t: number };
  points: number;
  categoriesWon: number;
  categoriesLost: number;
  categoriesTied: number;
}

export interface MemberSeasonSnapshot extends LadderEntry {
  season: number;
  scheduleWeek: number | null;
  currentOpponentUserId?: string;
  currentOpponentTeamName?: string;
}

export interface ScheduleWeekSnapshot {
  week: number;
  aflRound: number | null;
  roundLabel: string;
  status: LeagueSeasonRoundStatus;
  matchupIds: string[];
  current: boolean;
}

export type MaterializedSeasonFreshness = {
  stale: boolean;
  reason: string | null;
};

export interface LeagueSeasonState {
  matchups: MaterializedMatchup[];
  standings: LadderEntry[];
  memberSnapshots: MemberSeasonSnapshot[];
  scheduleWeeks: ScheduleWeekSnapshot[];
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface ExistingMemberSeasonSnapshot {
  userId?: string | null;
  teamName?: string | null;
  ladderRank?: number | null;
  record?: { w?: number | null; l?: number | null; t?: number | null } | null;
  points?: number | null;
  categoriesWon?: number | null;
  categoriesLost?: number | null;
  categoriesTied?: number | null;
  scheduleWeek?: number | null;
  currentOpponentUserId?: string | null;
  currentOpponentTeamName?: string | null;
}

interface LeagueRosterSnapshot {
  rostersByUserId: Map<string, string[]>;
  playerNameById: Map<string, string>;
}

type RosterLoaderPrismaClient = {
  leagueRosterPlayer: {
    findMany(args: {
      where: { leagueId: string };
      orderBy: Array<{ memberId?: 'asc'; sortOrder?: 'asc'; createdAt?: 'asc' }>;
      select: {
        memberId: true;
        playerId: true;
        member: { select: { userId: true } };
        player: { select: { name: true } };
      };
    }): Promise<
      Array<{
        memberId: string;
        playerId: string;
        member: { userId: string };
        player: { name: string | null };
      }>
    >;
  };
  player: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
};

type AggregatedRoundState = {
  round: number;
  label: string;
  statuses: Set<LeagueSeasonRoundStatus>;
};

const CATEGORY_ALIASES: Record<string, FantasyCategoryKey> = {
  inside_50s: 'inside50s',
  rebound_50s: 'rebound50s',
  contested_possessions: 'contestedPossessions',
  uncontested_possessions: 'uncontestedPossessions',
  effective_disposals: 'effectiveDisposals',
  disposal_eff_pct: 'disposalEffPct',
  time_on_ground_pct: 'timeOnGroundPct',
  goal_assists: 'goalAssists',
  frees_for: 'freesFor',
  frees_against: 'freesAgainst',
  one_percenters: 'onePercenters',
  metres_gained: 'metresGained',
  contested_marks: 'contestedMarks',
  score_involvements: 'scoreInvolvements',
};

const VALID_CATEGORY_KEYS = new Set<FantasyCategoryKey>([
  'goals',
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'hitouts',
  'clearances',
  'inside50s',
  'rebound50s',
  'clangers',
  'contestedPossessions',
  'uncontestedPossessions',
  'freesFor',
  'freesAgainst',
  'onePercenters',
  'goalAssists',
  'timeOnGroundPct',
  'disposalEffPct',
  'turnovers',
  'intercepts',
  'metresGained',
  'contestedMarks',
  'effectiveDisposals',
  'scoreInvolvements',
]);

function normalizeCategory(value: unknown): FantasyCategoryKey | null {
  if (typeof value !== 'string') return null;
  const normalized = CATEGORY_ALIASES[value] ?? value;
  return VALID_CATEGORY_KEYS.has(normalized as FantasyCategoryKey)
    ? (normalized as FantasyCategoryKey)
    : null;
}

function buildRoundLabel(round: number): string {
  return round === 0 ? 'Opening Round' : `Round ${round}`;
}

function normalizePlayerName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function getRoundRobinWeeks(numTeams: number): number {
  return numTeams % 2 === 0 ? numTeams - 1 : numTeams;
}

const MIN_LEAGUE_SEASON_WEEKS = 12;

export function deriveLeagueScheduleSettings(numTeams: number): ScheduleSettings {
  const matchupsPerOpponent: 1 | 2 = numTeams <= 8 ? 2 : 1;
  const seasonWeeks = Math.max(
    MIN_LEAGUE_SEASON_WEEKS,
    getRoundRobinWeeks(numTeams) * matchupsPerOpponent
  );

  return {
    numTeams,
    seasonWeeks,
    matchupsPerOpponent,
    playoffs: {
      enabled: false,
      teams: 0,
      legLengthWeeks: 1,
      reseedEachRound: false,
      includeConsolation: false,
    },
  };
}

function expandRoundsToSeasonWeeks(
  rounds: LeagueSeasonRound[],
  seasonWeeks: number
): LeagueSeasonRound[] {
  const normalized = [...rounds].sort((a, b) => a.round - b.round);
  if (normalized.length >= seasonWeeks) {
    return normalized.slice(0, seasonWeeks);
  }

  const expanded = [...normalized];
  const usedRoundNumbers = new Set(expanded.map((round) => round.round));
  let nextRoundNumber =
    expanded.length > 0 ? Math.max(...expanded.map((round) => round.round)) + 1 : 1;

  while (expanded.length < seasonWeeks) {
    while (usedRoundNumbers.has(nextRoundNumber)) {
      nextRoundNumber += 1;
    }
    expanded.push({
      round: nextRoundNumber,
      label: buildRoundLabel(nextRoundNumber),
      status: 'scheduled',
    });
    usedRoundNumbers.add(nextRoundNumber);
    nextRoundNumber += 1;
  }

  return expanded;
}

function getActiveWeekIndex(rounds: LeagueSeasonRound[]): number | null {
  const inProgressIndices = rounds
    .map((round, index) => (round.status === 'in_progress' ? index : -1))
    .filter((index) => index >= 0);
  if (inProgressIndices.length > 0) {
    return Math.max(...inProgressIndices);
  }

  const lastFinalIndex = rounds.reduce(
    (latestIndex, round, index) => (round.status === 'final' ? index : latestIndex),
    -1
  );
  const scheduledIndex = rounds.findIndex(
    (round, index) => index > lastFinalIndex && round.status === 'scheduled'
  );
  if (scheduledIndex >= 0) return scheduledIndex;

  const firstScheduledIndex = rounds.findIndex((round) => round.status === 'scheduled');
  if (firstScheduledIndex >= 0) return firstScheduledIndex;

  return rounds.length > 0 ? rounds.length - 1 : null;
}

function resolveAggregatedRoundStatus(
  statuses: ReadonlySet<LeagueSeasonRoundStatus>
): LeagueSeasonRoundStatus {
  if (statuses.has('in_progress')) {
    return 'in_progress';
  }

  if (statuses.has('final') && statuses.has('scheduled')) {
    return 'in_progress';
  }

  if (statuses.has('final')) {
    return 'final';
  }

  return 'scheduled';
}

export function shouldBootstrapLeagueSeasonState(input: {
  rounds: LeagueSeasonRound[];
  scheduleWeeks: ScheduleWeekSnapshot[];
  memberSnapshots: ExistingMemberSeasonSnapshot[];
}): { stale: boolean; reason: string | null } {
  const rounds = [...input.rounds].sort((a, b) => a.round - b.round);
  const scheduleWeeks = [...input.scheduleWeeks].sort((a, b) => a.week - b.week);

  if (rounds.length === 0) {
    if (scheduleWeeks.length === 0) return { stale: true, reason: 'missing_schedule' };
    if (input.memberSnapshots.length === 0) {
      return { stale: true, reason: 'missing_member_snapshots' };
    }
    return { stale: false, reason: null };
  }

  if (scheduleWeeks.length === 0) return { stale: true, reason: 'missing_schedule' };
  if (input.memberSnapshots.length === 0) {
    return { stale: true, reason: 'missing_member_snapshots' };
  }

  const scheduleByWeek = new Map(scheduleWeeks.map((week) => [week.week, week]));
  for (const [index, round] of rounds.entries()) {
    const expectedWeek = index + 1;
    const existingWeek = scheduleByWeek.get(expectedWeek);
    if (!existingWeek) {
      return { stale: true, reason: `missing_week_${expectedWeek}` };
    }
    if (existingWeek.aflRound !== round.round) {
      return { stale: true, reason: `afl_round_mismatch_week_${expectedWeek}` };
    }
    if (existingWeek.roundLabel !== round.label) {
      return { stale: true, reason: `round_label_mismatch_week_${expectedWeek}` };
    }
    if (existingWeek.status !== round.status) {
      return { stale: true, reason: `round_status_mismatch_week_${expectedWeek}` };
    }
  }

  const activeWeekIndex = getActiveWeekIndex(rounds);
  const expectedCurrentWeek = activeWeekIndex == null ? null : activeWeekIndex + 1;
  const materializedCurrentWeek = scheduleWeeks.find((week) => week.current)?.week ?? null;
  if (expectedCurrentWeek !== materializedCurrentWeek) {
    return { stale: true, reason: 'current_week_mismatch' };
  }

  if (input.memberSnapshots.some((member) => !Number.isFinite(Number(member.ladderRank ?? NaN)))) {
    return { stale: true, reason: 'missing_ladder_rank' };
  }

  if (
    expectedCurrentWeek != null &&
    input.memberSnapshots.length > 1 &&
    input.memberSnapshots.every((member) => !member.currentOpponentUserId)
  ) {
    return { stale: true, reason: 'missing_current_opponents' };
  }

  return { stale: false, reason: null };
}

function recordsMatch(
  left: ExistingMemberSeasonSnapshot['record'],
  right: MemberSeasonSnapshot['record']
): boolean {
  return (
    Number(left?.w ?? 0) === right.w &&
    Number(left?.l ?? 0) === right.l &&
    Number(left?.t ?? 0) === right.t
  );
}

function nullableNumberMatches(
  left: number | null | undefined,
  right: number | null | undefined
): boolean {
  return (left ?? null) === (right ?? null);
}

export function detectLeagueSeasonStateDrift(input: {
  scheduleWeeks: ScheduleWeekSnapshot[];
  memberSnapshots: ExistingMemberSeasonSnapshot[];
  expected: LeagueSeasonState;
}): { stale: boolean; reason: string | null } {
  const materializedWeeks = [...input.scheduleWeeks].sort((a, b) => a.week - b.week);
  const expectedWeeks = [...input.expected.scheduleWeeks].sort((a, b) => a.week - b.week);

  if (materializedWeeks.length !== expectedWeeks.length) {
    return { stale: true, reason: 'materialized_week_count_mismatch' };
  }

  for (const expectedWeek of expectedWeeks) {
    const materializedWeek = materializedWeeks.find((week) => week.week === expectedWeek.week);
    if (!materializedWeek) {
      return { stale: true, reason: `missing_materialized_week_${expectedWeek.week}` };
    }

    if (
      materializedWeek.aflRound !== expectedWeek.aflRound ||
      materializedWeek.roundLabel !== expectedWeek.roundLabel ||
      materializedWeek.status !== expectedWeek.status ||
      materializedWeek.current !== expectedWeek.current
    ) {
      return { stale: true, reason: `materialized_week_drift_${expectedWeek.week}` };
    }
  }

  if (input.memberSnapshots.length !== input.expected.memberSnapshots.length) {
    return { stale: true, reason: 'materialized_member_count_mismatch' };
  }

  const materializedMembers = new Map(
    input.memberSnapshots
      .filter((member): member is ExistingMemberSeasonSnapshot & { userId: string } =>
        Boolean(member.userId)
      )
      .map((member) => [member.userId, member])
  );

  for (const expectedMember of input.expected.memberSnapshots) {
    const materializedMember = materializedMembers.get(expectedMember.userId);
    if (!materializedMember) {
      return { stale: true, reason: `missing_member_snapshot_${expectedMember.userId}` };
    }

    if (
      Number(materializedMember.ladderRank ?? NaN) !== expectedMember.ladderRank ||
      !recordsMatch(materializedMember.record, expectedMember.record) ||
      Number(materializedMember.points ?? NaN) !== expectedMember.points ||
      Number(materializedMember.categoriesWon ?? NaN) !== expectedMember.categoriesWon ||
      Number(materializedMember.categoriesLost ?? NaN) !== expectedMember.categoriesLost ||
      Number(materializedMember.categoriesTied ?? NaN) !== expectedMember.categoriesTied ||
      !nullableNumberMatches(materializedMember.scheduleWeek, expectedMember.scheduleWeek) ||
      (materializedMember.currentOpponentUserId ?? null) !==
        (expectedMember.currentOpponentUserId ?? null) ||
      (materializedMember.currentOpponentTeamName ?? null) !==
        (expectedMember.currentOpponentTeamName ?? null)
    ) {
      return { stale: true, reason: `member_snapshot_drift_${expectedMember.userId}` };
    }
  }

  return { stale: false, reason: null };
}

function getMatchupWinner(matchup: {
  homeSummary?: { wins: number; losses: number; ties: number };
  awaySummary?: { wins: number; losses: number; ties: number };
}): 'home' | 'away' | 'tie' | undefined {
  if (!matchup.homeSummary || !matchup.awaySummary) return undefined;
  if (matchup.homeSummary.wins === matchup.awaySummary.wins) return 'tie';
  return matchup.homeSummary.wins > matchup.awaySummary.wins ? 'home' : 'away';
}

export function buildLeagueSeasonState(input: {
  leagueId: string;
  season: number;
  members: LeagueSeasonMember[];
  categories: FantasyCategoryKey[];
  rounds: LeagueSeasonRound[];
  rostersByUserId: Map<string, string[]>;
  statsByRound: Map<number, Map<string, MatchupPlayerStat>>;
  scheduleSettings?: ScheduleSettings;
}): LeagueSeasonState {
  const members = [...input.members];
  const scheduleSettings = input.scheduleSettings ?? deriveLeagueScheduleSettings(members.length);
  const rounds = expandRoundsToSeasonWeeks(
    [...input.rounds].sort((a, b) => a.round - b.round),
    scheduleSettings.seasonWeeks
  );
  const generated = generateCompleteSchedule(scheduleSettings);

  if (!generated.success) {
    throw new Error(generated.error ?? 'Failed to generate league schedule');
  }

  const activeWeekIndex = getActiveWeekIndex(rounds);
  const ladderMap = new Map(
    members.map((member) => [
      member.userId,
      {
        userId: member.userId,
        memberId: member.memberId,
        teamName: member.teamName,
        ladderRank: 0,
        record: { w: 0, l: 0, t: 0 },
        points: 0,
        categoriesWon: 0,
        categoriesLost: 0,
        categoriesTied: 0,
      },
    ])
  );

  const currentOpponentMap = new Map<
    string,
    { currentOpponentUserId: string; currentOpponentTeamName: string; scheduleWeek: number }
  >();

  const matchups: MaterializedMatchup[] = [];
  const scheduleWeeks: ScheduleWeekSnapshot[] = [];

  generated.regularSeason.forEach((week, weekIndex) => {
    const round = rounds[weekIndex];
    const status = round?.status ?? 'scheduled';
    const roundLabel = round?.label ?? (round ? buildRoundLabel(round.round) : `Week ${week.week}`);
    const aflRound = round?.round ?? null;
    const current = activeWeekIndex === weekIndex;
    const matchupIds: string[] = [];

    week.matches.forEach((match, matchIndex) => {
      const homeMember = members[(match.homeTeam ?? 1) - 1];
      const awayMember = members[(match.awayTeam ?? 1) - 1];
      if (!homeMember || !awayMember) return;

      const matchupId = `${input.leagueId}_${input.season}_w${week.week}_m${matchIndex + 1}`;
      const baseMatchup: MaterializedMatchup = {
        id: matchupId,
        leagueId: input.leagueId,
        season: input.season,
        week: week.week,
        aflRound,
        roundLabel,
        status,
        completed: status === 'final',
        current,
        participants: [homeMember.userId, awayMember.userId],
        homeUserId: homeMember.userId,
        awayUserId: awayMember.userId,
        homeMemberId: homeMember.memberId,
        awayMemberId: awayMember.memberId,
        homeTeamId: homeMember.memberId,
        awayTeamId: awayMember.memberId,
        homeTeamName: homeMember.teamName,
        awayTeamName: awayMember.teamName,
      };

      if (aflRound != null && status !== 'scheduled') {
        const score = buildHeadToHeadCategoryScores({
          categories: input.categories,
          homePlayerIds: input.rostersByUserId.get(homeMember.userId) ?? [],
          awayPlayerIds: input.rostersByUserId.get(awayMember.userId) ?? [],
          statsByPlayerId: input.statsByRound.get(aflRound) ?? new Map(),
        });

        baseMatchup.categoryScores = score.categories;
        baseMatchup.homeSummary = score.home.summary;
        baseMatchup.awaySummary = score.away.summary;
        baseMatchup.winner = getMatchupWinner(baseMatchup);

        if (status === 'final') {
          const homeLadder = ladderMap.get(homeMember.userId);
          const awayLadder = ladderMap.get(awayMember.userId);

          if (homeLadder && awayLadder) {
            homeLadder.categoriesWon += score.home.summary.wins;
            homeLadder.categoriesLost += score.home.summary.losses;
            homeLadder.categoriesTied += score.home.summary.ties;
            awayLadder.categoriesWon += score.away.summary.wins;
            awayLadder.categoriesLost += score.away.summary.losses;
            awayLadder.categoriesTied += score.away.summary.ties;
            homeLadder.points += score.home.summary.wins + score.home.summary.ties * 0.5;
            awayLadder.points += score.away.summary.wins + score.away.summary.ties * 0.5;

            if (score.home.summary.wins > score.away.summary.wins) {
              homeLadder.record.w += 1;
              awayLadder.record.l += 1;
            } else if (score.home.summary.wins < score.away.summary.wins) {
              homeLadder.record.l += 1;
              awayLadder.record.w += 1;
            } else {
              homeLadder.record.t += 1;
              awayLadder.record.t += 1;
            }
          }
        }
      }

      if (current) {
        currentOpponentMap.set(homeMember.userId, {
          currentOpponentUserId: awayMember.userId,
          currentOpponentTeamName: awayMember.teamName,
          scheduleWeek: week.week,
        });
        currentOpponentMap.set(awayMember.userId, {
          currentOpponentUserId: homeMember.userId,
          currentOpponentTeamName: homeMember.teamName,
          scheduleWeek: week.week,
        });
      }

      matchupIds.push(matchupId);
      matchups.push(baseMatchup);
    });

    scheduleWeeks.push({
      week: week.week,
      aflRound,
      roundLabel,
      status,
      matchupIds,
      current,
    });
  });

  const standings = Array.from(ladderMap.values()).sort((left, right) => {
    if (right.record.w !== left.record.w) return right.record.w - left.record.w;
    if (right.record.t !== left.record.t) return right.record.t - left.record.t;
    if (right.points !== left.points) return right.points - left.points;
    if (right.categoriesWon !== left.categoriesWon) return right.categoriesWon - left.categoriesWon;
    return left.teamName.localeCompare(right.teamName);
  });

  standings.forEach((entry, index) => {
    entry.ladderRank = index + 1;
  });

  const memberSnapshots = members.map((member) => {
    const ladder = ladderMap.get(member.userId);
    const currentOpponent = currentOpponentMap.get(member.userId);
    return {
      userId: member.userId,
      memberId: member.memberId,
      teamName: member.teamName,
      season: input.season,
      ladderRank: ladder?.ladderRank ?? standings.length + 1,
      record: ladder?.record ?? { w: 0, l: 0, t: 0 },
      points: ladder?.points ?? 0,
      categoriesWon: ladder?.categoriesWon ?? 0,
      categoriesLost: ladder?.categoriesLost ?? 0,
      categoriesTied: ladder?.categoriesTied ?? 0,
      scheduleWeek: currentOpponent?.scheduleWeek ?? null,
      currentOpponentUserId: currentOpponent?.currentOpponentUserId,
      currentOpponentTeamName: currentOpponent?.currentOpponentTeamName,
    };
  });

  return {
    matchups,
    standings,
    memberSnapshots,
    scheduleWeeks,
  };
}

export function normalizeLeagueSeasonRoundStatus(value: unknown): LeagueSeasonRoundStatus {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    normalized === 'in_progress' ||
    normalized === 'live' ||
    normalized === 'current' ||
    normalized === 'active'
  ) {
    return 'in_progress';
  }

  if (
    normalized === 'final' ||
    normalized === 'complete' ||
    normalized === 'completed' ||
    normalized === 'full_time' ||
    normalized === 'fulltime'
  ) {
    return 'final';
  }

  return 'scheduled';
}

function normalizeRoundStatus(value: unknown): LeagueSeasonRoundStatus {
  return normalizeLeagueSeasonRoundStatus(value);
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function writeSeasonState(
  db: Firestore,
  leagueId: string,
  season: number,
  state: LeagueSeasonState
): Promise<void> {
  const existingMatchups = await db
    .collection('matchups')
    .where('leagueId', '==', leagueId)
    .where('season', '==', season)
    .get();
  const nextMatchupIds = new Set(state.matchups.map((matchup) => matchup.id));
  const staleMatchupRefs = existingMatchups.docs
    .filter((doc) => !nextMatchupIds.has(doc.id))
    .map((doc) => doc.ref);

  for (const refs of chunk(staleMatchupRefs, 400)) {
    const batch = db.batch();
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  for (const docs of chunk(state.matchups, 350)) {
    const batch = db.batch();
    docs.forEach((matchup) => {
      batch.set(db.collection('matchups').doc(matchup.id), {
        ...matchup,
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
  }

  for (const weeks of chunk(state.scheduleWeeks, 350)) {
    const batch = db.batch();
    weeks.forEach((week) => {
      batch.set(
        db
          .collection('leagues')
          .doc(leagueId)
          .collection('schedule')
          .doc(`${season}_week_${week.week}`),
        {
          ...week,
          season,
          leagueId,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  for (const members of chunk(state.memberSnapshots, 350)) {
    const batch = db.batch();
    members.forEach((member) => {
      batch.set(
        db.collection('leagues').doc(leagueId).collection('members').doc(member.userId),
        {
          leagueId,
          userId: member.userId,
          teamName: member.teamName,
          isActive: true,
          season: member.season,
          ladderRank: member.ladderRank,
          record: member.record,
          points: member.points,
          categoriesWon: member.categoriesWon,
          categoriesLost: member.categoriesLost,
          categoriesTied: member.categoriesTied,
          scheduleWeek: member.scheduleWeek,
          currentOpponentUserId: member.currentOpponentUserId ?? null,
          currentOpponentTeamName: member.currentOpponentTeamName ?? null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  const currentWeek = state.scheduleWeeks.find((week) => week.current);
  await db
    .collection('leagues')
    .doc(leagueId)
    .set(
      {
        status: 'active',
        nextEvent: currentWeek
          ? {
              label: currentWeek.roundLabel,
              iso: new Date().toISOString(),
            }
          : null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

async function loadMaterializedSeasonState(
  db: Firestore,
  leagueId: string,
  season: number
): Promise<{
  scheduleWeeks: ScheduleWeekSnapshot[];
  memberSnapshots: ExistingMemberSeasonSnapshot[];
}> {
  const leagueRef = db.collection('leagues').doc(leagueId);
  const [scheduleSnap, membersSnap] = await Promise.all([
    leagueRef.collection('schedule').where('season', '==', season).get(),
    leagueRef
      .collection('members')
      .where('isActive', '==', true)
      .where('season', '==', season)
      .get(),
  ]);

  const scheduleWeeks = scheduleSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      week: Number(data.week ?? 0),
      aflRound: data.aflRound != null ? Number(data.aflRound) : null,
      roundLabel: String(data.roundLabel ?? `Week ${data.week ?? '?'}`),
      status: normalizeRoundStatus(data.status),
      matchupIds: Array.isArray(data.matchupIds) ? data.matchupIds.map(String) : [],
      current: Boolean(data.current),
    } satisfies ScheduleWeekSnapshot;
  });

  const memberSnapshots = membersSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      userId: doc.id,
      teamName: typeof data.teamName === 'string' ? data.teamName : null,
      ladderRank:
        typeof data.ladderRank === 'number' && Number.isFinite(data.ladderRank)
          ? data.ladderRank
          : null,
      record: {
        w: typeof data.record?.w === 'number' && Number.isFinite(data.record.w) ? data.record.w : 0,
        l: typeof data.record?.l === 'number' && Number.isFinite(data.record.l) ? data.record.l : 0,
        t: typeof data.record?.t === 'number' && Number.isFinite(data.record.t) ? data.record.t : 0,
      },
      points: typeof data.points === 'number' && Number.isFinite(data.points) ? data.points : 0,
      categoriesWon:
        typeof data.categoriesWon === 'number' && Number.isFinite(data.categoriesWon)
          ? data.categoriesWon
          : 0,
      categoriesLost:
        typeof data.categoriesLost === 'number' && Number.isFinite(data.categoriesLost)
          ? data.categoriesLost
          : 0,
      categoriesTied:
        typeof data.categoriesTied === 'number' && Number.isFinite(data.categoriesTied)
          ? data.categoriesTied
          : 0,
      scheduleWeek:
        typeof data.scheduleWeek === 'number' && Number.isFinite(data.scheduleWeek)
          ? data.scheduleWeek
          : null,
      currentOpponentUserId:
        typeof data.currentOpponentUserId === 'string' ? data.currentOpponentUserId : null,
      currentOpponentTeamName:
        typeof data.currentOpponentTeamName === 'string' ? data.currentOpponentTeamName : null,
    } satisfies ExistingMemberSeasonSnapshot;
  });

  return { scheduleWeeks, memberSnapshots };
}

export async function loadMaterializedSeasonSnapshots(params: {
  leagueId: string;
  season: number;
  db?: Firestore;
}): Promise<{
  scheduleWeeks: ScheduleWeekSnapshot[];
  memberSnapshots: ExistingMemberSeasonSnapshot[];
}> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  return loadMaterializedSeasonState(params.db ?? adminDb, params.leagueId, params.season);
}

export async function getMaterializedSeasonFreshness(params: {
  leagueId: string;
  season: number;
  db?: Firestore;
}): Promise<MaterializedSeasonFreshness> {
  const [{ adminDb }, rounds] = await Promise.all([
    import('@/lib/firebaseAdmin'),
    loadSeasonRounds(params.season),
  ]);
  const materialized = await loadMaterializedSeasonState(
    params.db ?? adminDb,
    params.leagueId,
    params.season
  );

  return shouldBootstrapLeagueSeasonState({
    rounds,
    scheduleWeeks: materialized.scheduleWeeks,
    memberSnapshots: materialized.memberSnapshots,
  });
}

export async function loadMaterializedMatchupsForRound(params: {
  leagueId: string;
  season: number;
  round: number;
  db?: Firestore;
}): Promise<MaterializedMatchup[]> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  const db = params.db ?? adminDb;
  const snap = await db
    .collection('matchups')
    .where('leagueId', '==', params.leagueId)
    .where('season', '==', params.season)
    .where('aflRound', '==', params.round)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      leagueId: String(data.leagueId ?? params.leagueId),
      season: Number(data.season ?? params.season),
      week: Number(data.week ?? 0),
      aflRound: data.aflRound != null ? Number(data.aflRound) : null,
      roundLabel: String(data.roundLabel ?? `Round ${params.round}`),
      status: normalizeRoundStatus(data.status),
      completed: Boolean(data.completed),
      current: Boolean(data.current),
      participants: Array.isArray(data.participants) ? data.participants.map(String) : [],
      homeUserId: String(data.homeUserId ?? ''),
      awayUserId: String(data.awayUserId ?? ''),
      homeMemberId: String(data.homeMemberId ?? ''),
      awayMemberId: String(data.awayMemberId ?? ''),
      homeTeamId: String(data.homeTeamId ?? ''),
      awayTeamId: String(data.awayTeamId ?? ''),
      homeTeamName: String(data.homeTeamName ?? ''),
      awayTeamName: String(data.awayTeamName ?? ''),
      homeSummary:
        typeof data.homeSummary === 'object' && data.homeSummary !== null
          ? {
              wins: Number((data.homeSummary as { wins?: unknown }).wins ?? 0),
              losses: Number((data.homeSummary as { losses?: unknown }).losses ?? 0),
              ties: Number((data.homeSummary as { ties?: unknown }).ties ?? 0),
            }
          : undefined,
      awaySummary:
        typeof data.awaySummary === 'object' && data.awaySummary !== null
          ? {
              wins: Number((data.awaySummary as { wins?: unknown }).wins ?? 0),
              losses: Number((data.awaySummary as { losses?: unknown }).losses ?? 0),
              ties: Number((data.awaySummary as { ties?: unknown }).ties ?? 0),
            }
          : undefined,
      categoryScores: Array.isArray(data.categoryScores)
        ? data.categoryScores.map((entry) => ({
            key: String((entry as { key?: unknown }).key) as FantasyCategoryKey,
            label: String((entry as { label?: unknown }).label ?? ''),
            home: Number((entry as { home?: unknown }).home ?? 0),
            away: Number((entry as { away?: unknown }).away ?? 0),
            winner:
              (entry as { winner?: unknown }).winner === 'home' ||
              (entry as { winner?: unknown }).winner === 'away'
                ? (entry as { winner: 'home' | 'away' }).winner
                : 'tie',
          }))
        : undefined,
      winner:
        data.winner === 'home' || data.winner === 'away' || data.winner === 'tie'
          ? data.winner
          : undefined,
    } satisfies MaterializedMatchup;
  });
}

async function loadLeagueMembers(leagueId: string): Promise<LeagueSeasonMember[]> {
  const { prisma } = await import('@/lib/prisma');
  const prismaMembers = await prisma.leagueMember.findMany({
    where: { leagueId },
    orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      teamName: true,
    },
  });

  return prismaMembers.map((member) => ({
    userId: member.userId,
    memberId: member.id,
    teamName: member.teamName,
  }));
}

export async function loadLeagueRosters(
  leagueId: string,
  members: LeagueSeasonMember[],
  prismaClient?: RosterLoaderPrismaClient
): Promise<LeagueRosterSnapshot> {
  const { prisma } = await import('@/lib/prisma');
  const client = prismaClient ?? prisma;
  const prismaRows = await client.leagueRosterPlayer.findMany({
    where: { leagueId },
    orderBy: [{ memberId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      memberId: true,
      playerId: true,
      member: {
        select: {
          userId: true,
        },
      },
      player: {
        select: {
          name: true,
        },
      },
    },
  });

  const rosters = new Map<string, string[]>();
  const playerNameById = new Map<string, string>();
  const memberIdByUserId = new Map(members.map((member) => [member.userId, member.memberId]));
  const userIdByMemberId = new Map(members.map((member) => [member.memberId, member.userId]));
  const memberUserIds = new Set(members.map((member) => member.userId));
  prismaRows.forEach((row) => {
    const userId = row.member.userId;
    if (!memberUserIds.has(userId)) return;
    const roster = rosters.get(userId) ?? [];
    roster.push(String(row.playerId));
    rosters.set(userId, roster);
    if (typeof row.player?.name === 'string' && row.player.name.trim().length > 0) {
      playerNameById.set(String(row.playerId), row.player.name);
    }
  });

  const membersMissingNormalizedRoster = members.filter((member) => {
    const roster = rosters.get(member.userId) ?? [];
    return roster.length === 0;
  });

  if (membersMissingNormalizedRoster.length > 0) {
    logger.warn('League rosters missing normalized ownership rows', {
      leagueId,
      missingMembers: membersMissingNormalizedRoster.length,
      memberIds: membersMissingNormalizedRoster
        .map((member) => memberIdByUserId.get(member.userId))
        .filter(Boolean),
    });
  }

  return { rostersByUserId: rosters, playerNameById };
}

export async function loadLeagueCategories(leagueId: string): Promise<FantasyCategoryKey[]> {
  const { prisma } = await import('@/lib/prisma');
  const prismaLeague = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      categoriesJson: true,
    },
  });

  const normalized = parseJsonStringArray(prismaLeague?.categoriesJson)
    .map((entry) => normalizeCategory(entry))
    .filter((entry): entry is FantasyCategoryKey => Boolean(entry));

  const unique = Array.from(new Set(normalized));
  if (unique.length > 0) {
    return unique;
  }

  return ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'hitouts'];
}

export async function loadLeagueScheduleSettings(
  leagueId: string,
  numTeams: number
): Promise<ScheduleSettings> {
  type LeagueScheduleSettingsRecord = {
    seasonWeeks: number;
    matchupsPerOpponent: number;
    playoffsEnabled: boolean;
    playoffTeams: number;
    playoffLegLengthWeeks: number;
    playoffReseedEachRound: boolean;
    playoffIncludeConsolation: boolean;
  };

  const defaults = deriveLeagueScheduleSettings(numTeams);
  const { prisma } = await import('@/lib/prisma');
  const prismaLeague = (await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: {
        select: {
          seasonWeeks: true,
          matchupsPerOpponent: true,
          playoffsEnabled: true,
          playoffTeams: true,
          playoffLegLengthWeeks: true,
          playoffReseedEachRound: true,
          playoffIncludeConsolation: true,
        },
      },
    },
  })) as { settings: LeagueScheduleSettingsRecord | null } | null;

  if (!prismaLeague?.settings) {
    return defaults;
  }

  const matchupsPerOpponent = prismaLeague.settings.matchupsPerOpponent === 2 ? 2 : 1;
  const playoffTeams = Math.min(
    numTeams,
    Math.max(0, Math.trunc(prismaLeague.settings.playoffTeams))
  );

  return {
    numTeams,
    seasonWeeks: Math.max(1, Math.trunc(prismaLeague.settings.seasonWeeks)),
    matchupsPerOpponent,
    playoffs: {
      enabled: prismaLeague.settings.playoffsEnabled,
      teams: prismaLeague.settings.playoffsEnabled ? playoffTeams : 0,
      legLengthWeeks: Math.max(1, Math.trunc(prismaLeague.settings.playoffLegLengthWeeks)),
      reseedEachRound: prismaLeague.settings.playoffReseedEachRound,
      includeConsolation: prismaLeague.settings.playoffIncludeConsolation,
    },
  };
}

export async function getComputedLeagueSeasonState(params: {
  leagueId: string;
  season: number;
}): Promise<LeagueSeasonState> {
  const [members, categories, rounds] = await Promise.all([
    loadLeagueMembers(params.leagueId),
    loadLeagueCategories(params.leagueId),
    loadSeasonRounds(params.season),
  ]);

  if (members.length < 2) {
    const memberSnapshots = members.map((member, index) => ({
      season: params.season,
      userId: member.userId,
      memberId: member.memberId,
      teamName: member.teamName,
      ladderRank: index + 1,
      record: { w: 0, l: 0, t: 0 },
      points: 0,
      categoriesWon: 0,
      categoriesLost: 0,
      categoriesTied: 0,
      scheduleWeek: null,
      currentOpponentUserId: undefined,
      currentOpponentTeamName: undefined,
    }));

    return {
      matchups: [],
      standings: memberSnapshots.map(
        ({
          season: _season,
          scheduleWeek: _scheduleWeek,
          currentOpponentUserId: _currentOpponentUserId,
          currentOpponentTeamName: _currentOpponentTeamName,
          ...entry
        }) => entry
      ),
      memberSnapshots,
      scheduleWeeks: [],
    };
  }

  const { rostersByUserId, playerNameById } = await loadLeagueRosters(params.leagueId, members);
  const scheduleSettings = await loadLeagueScheduleSettings(params.leagueId, members.length);
  const rosterPlayerIds = Array.from(new Set(Array.from(rostersByUserId.values()).flat()));
  const statsByRound = await loadSeasonStatsByRound(params.season, rosterPlayerIds, playerNameById);

  return buildLeagueSeasonState({
    leagueId: params.leagueId,
    season: params.season,
    members,
    categories,
    rounds,
    rostersByUserId,
    statsByRound,
    scheduleSettings,
  });
}

export function getComputedLeagueRound(input: {
  state: LeagueSeasonState;
  requestedRound?: number | null;
}): number | null {
  if (typeof input.requestedRound === 'number' && Number.isFinite(input.requestedRound)) {
    return input.requestedRound;
  }

  const currentWeek = input.state.scheduleWeeks.find((week) => week.current);
  if (currentWeek?.aflRound != null) {
    return currentWeek.aflRound;
  }

  const inProgressWeek = input.state.scheduleWeeks.find((week) => week.status === 'in_progress');
  if (inProgressWeek?.aflRound != null) {
    return inProgressWeek.aflRound;
  }

  const firstScheduledWeek = input.state.scheduleWeeks.find((week) => week.aflRound != null);
  return firstScheduledWeek?.aflRound ?? null;
}

export function selectComputedLeagueRoundMatchups(input: {
  state: LeagueSeasonState;
  round: number;
}): MaterializedMatchup[] {
  return input.state.matchups.filter((matchup) => matchup.aflRound === input.round);
}

async function loadSeasonRounds(season: number): Promise<LeagueSeasonRound[]> {
  // External AFL schedule feed. This remains in Firebase-backed ingestion and is
  // not part of the league domain source of truth.
  const { adminDb } = await import('@/lib/firebaseAdmin');
  const matchesSnap = await adminDb.collection('matches').where('season', '==', season).get();
  return deriveSeasonRoundsFromMatchDocuments(
    matchesSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
  );
}

export function deriveSeasonRoundsFromMatchDocuments(
  matches: Array<Record<string, unknown>>
): LeagueSeasonRound[] {
  const byRound = new Map<number, AggregatedRoundState>();

  matches.forEach((data) => {
    const round = Number(data.round_number ?? data.round ?? Number.NaN);
    if (!Number.isFinite(round)) return;

    const existing = byRound.get(round) ?? {
      round,
      label: typeof data.round_label === 'string' ? data.round_label : buildRoundLabel(round),
      statuses: new Set<LeagueSeasonRoundStatus>(),
    };
    existing.statuses.add(normalizeLeagueSeasonRoundStatus(data.status));
    if (typeof data.round_label === 'string' && data.round_label.trim().length > 0) {
      existing.label = data.round_label;
    }
    byRound.set(round, existing);
  });

  const rounds = Array.from(byRound.values())
    .map((entry) => ({
      round: entry.round,
      label: entry.label,
      status: resolveAggregatedRoundStatus(entry.statuses),
    }))
    .sort((left, right) => left.round - right.round);

  const latestStartedRound = rounds.reduce<number | null>(
    (latest, round) =>
      round.status === 'in_progress' || round.status === 'final'
        ? latest == null
          ? round.round
          : Math.max(latest, round.round)
        : latest,
    null
  );

  if (latestStartedRound == null) {
    return rounds;
  }

  return rounds.map((round) =>
    round.round < latestStartedRound && round.status !== 'final'
      ? { ...round, status: 'final' }
      : round
  );
}

export function determineCurrentLeagueRound(rounds: LeagueSeasonRound[]): number | null {
  const activeWeekIndex = getActiveWeekIndex(rounds);
  if (activeWeekIndex == null) {
    return null;
  }

  return rounds[activeWeekIndex]?.round ?? null;
}

async function loadSeasonStatsByRound(
  season: number,
  playerIds: Iterable<string>,
  playerNameById: Map<string, string>
): Promise<Map<number, Map<string, MatchupPlayerStat>>> {
  // External AFL stats feed. League rosters and ownership are Prisma-backed;
  // only the underlying match/stat feed remains Firebase-backed here.
  const { adminDb } = await import('@/lib/firebaseAdmin');
  const snap = await adminDb.collection('player_match_stats').where('season', '==', season).get();
  return mapSeasonStatsByRound(
    snap.docs.map((doc) => doc.data() as Record<string, unknown>),
    playerIds,
    playerNameById
  );
}

export function mapSeasonStatsByRound(
  records: Array<Record<string, unknown>>,
  playerIds: Iterable<string>,
  playerNameById: Map<string, string>
): Map<number, Map<string, MatchupPlayerStat>> {
  const byRound = new Map<number, Map<string, MatchupPlayerStat>>();
  const targetIds = new Set(Array.from(playerIds, String));
  const targetNames = new Map<string, string>();
  playerNameById.forEach((name, id) => {
    const normalized = normalizePlayerName(name);
    if (normalized) {
      targetNames.set(normalized, id);
    }
  });

  records.forEach((data) => {
    const round = Number(data.round_number ?? Number.NaN);
    const rawPlayerId = String(data.player_id ?? data.player_uid ?? data.playerId ?? '');
    const rawPlayerName = String(data.player_name ?? data.playerName ?? '');
    const playerId =
      (rawPlayerId && targetIds.has(rawPlayerId) ? rawPlayerId : null) ??
      targetNames.get(normalizePlayerName(rawPlayerName)) ??
      null;
    if (!Number.isFinite(round) || !playerId) return;

    const statsByPlayer = byRound.get(round) ?? new Map<string, MatchupPlayerStat>();
    statsByPlayer.set(playerId, {
      playerId,
      playerName: rawPlayerName || playerId,
      team: typeof data.team === 'string' ? data.team : undefined,
      position: typeof data.position === 'string' ? data.position : undefined,
      stats: buildCanonicalStatSnapshotFromRawDocument(data),
    });
    byRound.set(round, statsByPlayer);
  });

  return byRound;
}

export async function bootstrapLeagueSeason(params: {
  leagueId: string;
  season: number;
  db?: Firestore;
}): Promise<{
  leagueId: string;
  season: number;
  matchupCount: number;
  weekCount: number;
  currentWeek: number | null;
  standingsCount: number;
}> {
  const [{ adminDb }, { logger }] = await Promise.all([
    import('@/lib/firebaseAdmin'),
    import('@/lib/logger'),
  ]);
  const db = params.db ?? adminDb;
  const [members, categories, rounds] = await Promise.all([
    loadLeagueMembers(params.leagueId),
    loadLeagueCategories(params.leagueId),
    loadSeasonRounds(params.season),
  ]);

  if (members.length < 2) {
    throw new Error(`League ${params.leagueId} does not have enough members to build a season`);
  }

  if (categories.length === 0) {
    throw new Error(`League ${params.leagueId} does not have scoring categories configured`);
  }

  const { rostersByUserId, playerNameById } = await loadLeagueRosters(params.leagueId, members);
  const scheduleSettings = await loadLeagueScheduleSettings(params.leagueId, members.length);
  const rosterPlayerIds = Array.from(new Set(Array.from(rostersByUserId.values()).flat()));
  const statsByRound = await loadSeasonStatsByRound(params.season, rosterPlayerIds, playerNameById);
  const state = buildLeagueSeasonState({
    leagueId: params.leagueId,
    season: params.season,
    members,
    categories,
    rounds,
    rostersByUserId,
    statsByRound,
    scheduleSettings,
  });

  await writeSeasonState(db, params.leagueId, params.season, state);

  const currentWeek = state.scheduleWeeks.find((week) => week.current)?.week ?? null;
  logger.info('League season bootstrapped', {
    leagueId: params.leagueId,
    season: params.season,
    matchupCount: state.matchups.length,
    weekCount: state.scheduleWeeks.length,
    currentWeek,
  });

  return {
    leagueId: params.leagueId,
    season: params.season,
    matchupCount: state.matchups.length,
    weekCount: state.scheduleWeeks.length,
    currentWeek,
    standingsCount: state.standings.length,
  };
}

export async function ensureLeagueSeasonMaterialized(params: {
  leagueId: string;
  season: number;
  db?: Firestore;
}): Promise<{ bootstrapped: boolean; reason: string | null }> {
  const [{ adminDb }, { logger }] = await Promise.all([
    import('@/lib/firebaseAdmin'),
    import('@/lib/logger'),
  ]);
  const db = params.db ?? adminDb;
  const [rounds, materialized] = await Promise.all([
    loadSeasonRounds(params.season),
    loadMaterializedSeasonState(db, params.leagueId, params.season),
  ]);

  const freshness = shouldBootstrapLeagueSeasonState({
    rounds,
    scheduleWeeks: materialized.scheduleWeeks,
    memberSnapshots: materialized.memberSnapshots,
  });

  if (!freshness.stale) {
    const [members, categories] = await Promise.all([
      loadLeagueMembers(params.leagueId),
      loadLeagueCategories(params.leagueId),
    ]);

    if (members.length < 2 || categories.length === 0) {
      return { bootstrapped: false, reason: null };
    }

    const { rostersByUserId, playerNameById } = await loadLeagueRosters(params.leagueId, members);
    const scheduleSettings = await loadLeagueScheduleSettings(params.leagueId, members.length);
    const rosterPlayerIds = Array.from(new Set(Array.from(rostersByUserId.values()).flat()));
    const statsByRound = await loadSeasonStatsByRound(
      params.season,
      rosterPlayerIds,
      playerNameById
    );
    const expectedState = buildLeagueSeasonState({
      leagueId: params.leagueId,
      season: params.season,
      members,
      categories,
      rounds,
      rostersByUserId,
      statsByRound,
      scheduleSettings,
    });

    const drift = detectLeagueSeasonStateDrift({
      scheduleWeeks: materialized.scheduleWeeks,
      memberSnapshots: materialized.memberSnapshots,
      expected: expectedState,
    });

    if (!drift.stale) {
      return { bootstrapped: false, reason: null };
    }

    await writeSeasonState(db, params.leagueId, params.season, expectedState);
    logger.info('League season re-materialized from results drift', {
      leagueId: params.leagueId,
      season: params.season,
      reason: drift.reason,
    });
    return { bootstrapped: true, reason: drift.reason };
  }

  const members = await loadLeagueMembers(params.leagueId);
  if (members.length < 4) {
    logger.info('League season materialization skipped for underfilled league', {
      leagueId: params.leagueId,
      season: params.season,
      memberCount: members.length,
    });
    return { bootstrapped: false, reason: 'league_not_ready' };
  }

  await bootstrapLeagueSeason(params);
  logger.info('League season auto-materialized', {
    leagueId: params.leagueId,
    season: params.season,
    reason: freshness.reason,
  });
  return { bootstrapped: true, reason: freshness.reason };
}
