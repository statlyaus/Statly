import type { Prisma } from '@prisma/client';

import { getRoundMatchesResult } from '@/lib/etlIntegration';
import { prisma } from '@/lib/prisma';
import { getTeamName } from '@/lib/teamLogos';

import { parseCompetitionRulesJson, type CompetitionRules } from './competitionRules';
import { parseLineupSlotsJson } from './lineupSettings';
import type { ActiveLineupSlot, LeagueLineupSlot, LineupSlotSettings } from './scoringTypes';

const LINEUP_SLOTS = new Set<LeagueLineupSlot>([
  'FWD',
  'DEF',
  'MID',
  'RUC',
  'UTIL',
  'INTERCHANGE',
  'BENCH',
]);

export interface RosterLineupPlayer {
  playerId: string;
  position: string | null;
  club?: string | null;
  gameStartsAt?: Date | null;
}

export interface SubmittedLineupPlayer {
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
}

export interface ValidateLineupSubmissionInput {
  lineupSlots: LineupSlotSettings;
  rosterPlayers: readonly RosterLineupPlayer[];
  existingLockedPlayers: readonly SubmittedLineupPlayer[];
  submittedPlayers: readonly SubmittedLineupPlayer[];
  interchangeSlots?: number;
  now?: Date;
}

export interface LineupValidationResult {
  ok: boolean;
  errors: string[];
}

export interface MemberLineupRoundContext {
  source: 'PUBLISHED' | 'SETUP_FALLBACK';
  round: number;
  aflRound: number | null;
  phase: 'REGULAR' | 'FINALS';
  roundStatus: 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL';
  startsAt: Date | null;
  fallbackLockAt: Date | null;
  lockAt: Date | null;
  lockState: 'OPEN' | 'LOCKED' | 'PUBLISHED_PENDING' | 'NO_MATCHUP';
  opponent: { id: string; teamName: string } | null;
}

export type RoundTimingStatus = 'AVAILABLE' | 'PUBLISHED_PENDING';

export type RoundPlayerGameStartsResult =
  | {
      ok: true;
      gameStartsByPlayerId: Map<string, Date>;
      timingStatus: RoundTimingStatus;
    }
  | { ok: false; error: string };

export function resolveRequestedLineupRound({
  requestedRound,
  publishedCurrentRound,
}: {
  requestedRound: string;
  publishedCurrentRound: number | null;
}): number | null {
  if (requestedRound === 'current') {
    const resolvedRound = publishedCurrentRound ?? 1;
    return Number.isSafeInteger(resolvedRound) && resolvedRound > 0 ? resolvedRound : null;
  }

  if (!/^[1-9]\d*$/.test(requestedRound)) return null;
  const parsedRound = Number(requestedRound);
  return Number.isSafeInteger(parsedRound) ? parsedRound : null;
}

export function createSetupLineupRoundContext(round: number): MemberLineupRoundContext {
  return {
    source: 'SETUP_FALLBACK',
    round,
    aflRound: null,
    phase: 'REGULAR',
    roundStatus: 'PENDING',
    startsAt: null,
    fallbackLockAt: null,
    lockAt: null,
    lockState: 'PUBLISHED_PENDING',
    opponent: null,
  };
}

export type SaveMemberLineupResult =
  | { ok: true; data: Awaited<ReturnType<typeof loadMemberLineup>> }
  | {
      ok: false;
      code: 'INVALID_LINEUP' | 'TIMING_UNAVAILABLE' | 'RETRY_REQUIRED';
      errors: string[];
    };

export function canAssignPlayerToSlot(
  _playerPosition: string | null | undefined,
  slot: LeagueLineupSlot
): boolean {
  return LINEUP_SLOTS.has(slot);
}

export function isLineupPlayerLocked(
  gameStartsAt: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(gameStartsAt && gameStartsAt.getTime() <= now.getTime());
}

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));

  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
    second: values.get('second')!,
  };
}

function zonedDateTimeToUtc(parts: ZonedDateTimeParts, timeZone: string): Date {
  const intendedWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let candidateTime = intendedWallTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = getZonedDateTimeParts(new Date(candidateTime), timeZone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    const adjustment = intendedWallTime - observedWallTime;
    if (adjustment === 0) return new Date(candidateTime);
    candidateTime += adjustment;
  }

  throw new RangeError(`Unable to resolve lineup lock time in ${timeZone}.`);
}

function resolveThursdayLock(startsAt: Date | null, timeZone: string): Date | null {
  if (!startsAt) return null;

  const localStart = getZonedDateTimeParts(startsAt, timeZone);
  const anchor = new Date(Date.UTC(localStart.year, localStart.month - 1, localStart.day));
  const daysSinceThursday = (anchor.getUTCDay() + 3) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceThursday);

  return zonedDateTimeToUtc(
    {
      year: anchor.getUTCFullYear(),
      month: anchor.getUTCMonth() + 1,
      day: anchor.getUTCDate(),
      hour: 19,
      minute: 0,
      second: 0,
    },
    timeZone
  );
}

function resolveRoundLockAt(
  rules: CompetitionRules,
  competitionRound: { startsAt: Date | null; fallbackLockAt: Date | null }
) {
  if (competitionRound.fallbackLockAt) return competitionRound.fallbackLockAt;
  if (rules.lockPolicy === 'THURSDAY_7PM_AEST') {
    return resolveThursdayLock(competitionRound.startsAt, rules.leagueTimeZone);
  }
  return null;
}

export async function loadMemberLineupRoundContext({
  leagueId,
  memberId,
  round,
  now = new Date(),
}: {
  leagueId: string;
  memberId: string;
  round: number;
  now?: Date;
}): Promise<MemberLineupRoundContext | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league?.settings || league.settings.competitionRulesVersion < 1) return null;

  const competitionRound = await prisma.leagueCompetitionRound.findUnique({
    where: {
      leagueId_fixtureVersion_round: {
        leagueId,
        fixtureVersion: league.settings.competitionRulesVersion,
        round,
      },
    },
  });
  if (!competitionRound) return null;

  const matchup = await prisma.leagueMatchup.findFirst({
    where: {
      leagueId,
      fixtureVersion: league.settings.competitionRulesVersion,
      round,
      OR: [{ homeMemberId: memberId }, { awayMemberId: memberId }],
    },
    include: {
      homeMember: { select: { id: true, teamName: true } },
      awayMember: { select: { id: true, teamName: true } },
    },
  });
  const opponent =
    matchup?.homeMemberId === memberId
      ? matchup.awayMember
      : matchup?.awayMemberId === memberId
        ? matchup.homeMember
        : null;
  const rules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const lockAt = competitionRound.lockedAt ?? resolveRoundLockAt(rules, competitionRound);
  const lockState =
    competitionRound.status === 'NO_MATCHUP'
      ? 'NO_MATCHUP'
      : competitionRound.status === 'LOCKED' || competitionRound.status === 'FINAL'
        ? 'LOCKED'
        : lockAt && lockAt <= now
          ? 'LOCKED'
          : !competitionRound.startsAt && !competitionRound.fallbackLockAt
            ? 'PUBLISHED_PENDING'
            : 'OPEN';

  return {
    source: 'PUBLISHED',
    round: competitionRound.round,
    aflRound: competitionRound.aflRound,
    phase: competitionRound.phase,
    roundStatus: competitionRound.status,
    startsAt: competitionRound.startsAt,
    fallbackLockAt: competitionRound.fallbackLockAt,
    lockAt,
    lockState,
    opponent,
  };
}

export async function resolveCurrentCompetitionRoundNumber(
  leagueId: string,
  now = new Date()
): Promise<number | null> {
  const settings = await prisma.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: { competitionRulesVersion: true },
  });
  if (!settings || settings.competitionRulesVersion < 1) return null;

  const rounds = await prisma.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    orderBy: { round: 'asc' },
    select: { round: true, status: true, startsAt: true, endsAt: true },
  });
  const playableRounds = rounds.filter(
    (competitionRound) => competitionRound.status !== 'NO_MATCHUP'
  );
  const currentRound =
    playableRounds.find(
      (competitionRound) =>
        competitionRound.startsAt &&
        competitionRound.startsAt <= now &&
        (!competitionRound.endsAt || competitionRound.endsAt >= now)
    ) ??
    playableRounds.find(
      (competitionRound) => !competitionRound.startsAt || competitionRound.startsAt > now
    ) ??
    playableRounds.at(-1);

  return currentRound?.round ?? null;
}

export async function loadRoundPlayerGameStarts({
  aflRound,
  players,
  season = new Date().getFullYear(),
}: {
  aflRound: number | null;
  players: readonly Pick<RosterLineupPlayer, 'playerId' | 'club'>[];
  season?: number;
}): Promise<RoundPlayerGameStartsResult> {
  if (!aflRound || players.length === 0) {
    return {
      ok: true,
      gameStartsByPlayerId: new Map<string, Date>(),
      timingStatus: 'PUBLISHED_PENDING',
    };
  }

  const result = await getRoundMatchesResult(season, aflRound);
  if (!result.ok) {
    return { ok: false, error: 'Official AFL match timing is temporarily unavailable.' };
  }

  const startsByClub = new Map<string, Date>();
  for (const match of result.matches) {
    const startsAt = new Date(match.start_time_utc);
    if (!Number.isFinite(startsAt.getTime())) continue;
    startsByClub.set(getTeamName(match.home_team).toUpperCase(), startsAt);
    startsByClub.set(getTeamName(match.away_team).toUpperCase(), startsAt);
  }

  const gameStartsByPlayerId = new Map<string, Date>();
  for (const player of players) {
    if (!player.club) continue;
    const startsAt = startsByClub.get(getTeamName(player.club).toUpperCase());
    if (startsAt) gameStartsByPlayerId.set(player.playerId, startsAt);
  }

  return {
    ok: true,
    gameStartsByPlayerId,
    timingStatus: gameStartsByPlayerId.size === players.length ? 'AVAILABLE' : 'PUBLISHED_PENDING',
  };
}

export function validateLineupSubmission(
  input: ValidateLineupSubmissionInput
): LineupValidationResult {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const rosterByPlayerId = new Map(input.rosterPlayers.map((player) => [player.playerId, player]));
  const seenPlayerIds = new Set<string>();
  const occupiedSlots = new Set<string>();
  const activeSlotCounts = new Map<ActiveLineupSlot, number>();
  const lockedPlayersById = new Map(
    input.existingLockedPlayers.map((player) => [player.playerId, player])
  );

  for (const player of input.submittedPlayers) {
    if (seenPlayerIds.has(player.playerId)) {
      errors.push(`Player ${player.playerId} is a duplicate lineup selection.`);
    }
    seenPlayerIds.add(player.playerId);

    if (!LINEUP_SLOTS.has(player.slot)) {
      errors.push(`Slot ${player.slot} is not supported.`);
      continue;
    }

    const slotKey = `${player.slot}:${player.slotIndex}`;
    if (occupiedSlots.has(slotKey)) {
      errors.push(`Slot ${slotKey} has more than one player.`);
    }
    occupiedSlots.add(slotKey);

    if (!Number.isInteger(player.slotIndex) || player.slotIndex < 0) {
      errors.push(`Slot index for ${player.playerId} must be a non-negative integer.`);
    }

    const rosterPlayer = rosterByPlayerId.get(player.playerId);
    if (!rosterPlayer) {
      errors.push(`Player ${player.playerId} is not on this member roster.`);
      continue;
    }

    const lockedPlayer = lockedPlayersById.get(player.playerId);
    const isUnchangedLockedAssignment = Boolean(
      lockedPlayer &&
        lockedPlayer.slot === player.slot &&
        lockedPlayer.slotIndex === player.slotIndex
    );
    if (lockedPlayer && !isUnchangedLockedAssignment) {
      errors.push(`Player ${player.playerId} is locked.`);
    }
    if (isLineupPlayerLocked(rosterPlayer.gameStartsAt, now) && !lockedPlayer) {
      errors.push(`Player ${player.playerId} is locked.`);
    }

    if (player.slot === 'INTERCHANGE') {
      if (player.slotIndex >= (input.interchangeSlots ?? 0) && !isUnchangedLockedAssignment) {
        errors.push(
          `Interchange slot ${player.slotIndex + 1} exceeds the configured interchange count.`
        );
      }
    } else if (player.slot !== 'BENCH') {
      const activeSlot = player.slot;
      const exceedsConfiguredSlots = player.slotIndex >= input.lineupSlots[activeSlot];
      if (!(isUnchangedLockedAssignment && exceedsConfiguredSlots)) {
        activeSlotCounts.set(activeSlot, (activeSlotCounts.get(activeSlot) ?? 0) + 1);
      }
      if (exceedsConfiguredSlots && !isUnchangedLockedAssignment) {
        errors.push(`Slot ${player.slot}:${player.slotIndex} exceeds the configured lineup count.`);
      }
    }
  }

  for (const [slot, count] of activeSlotCounts) {
    if (count > input.lineupSlots[slot]) {
      errors.push(`${slot} has ${count} players but only ${input.lineupSlots[slot]} are allowed.`);
    }
  }

  for (const lockedPlayer of input.existingLockedPlayers) {
    const submittedPlayer = input.submittedPlayers.find(
      (player) => player.playerId === lockedPlayer.playerId
    );
    if (
      !submittedPlayer ||
      submittedPlayer.slot !== lockedPlayer.slot ||
      submittedPlayer.slotIndex !== lockedPlayer.slotIndex
    ) {
      errors.push(`Player ${lockedPlayer.playerId} is locked and must remain in place.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function isLeagueLineupSlot(value: unknown): value is LeagueLineupSlot {
  return typeof value === 'string' && LINEUP_SLOTS.has(value as LeagueLineupSlot);
}

export function normalizeLegacyBenchAssignments<
  TPlayer extends { slot: string; slotIndex: number },
>(players: readonly TPlayer[]): Array<TPlayer & { slot: LeagueLineupSlot }> {
  const occupiedInterchangeIndexes = new Set(
    players.flatMap((player) =>
      player.slot === 'INTERCHANGE' &&
      Number.isSafeInteger(player.slotIndex) &&
      player.slotIndex >= 0
        ? [player.slotIndex]
        : []
    )
  );

  return players.map((player) => {
    if (player.slot !== 'BENCH') {
      return { ...player, slot: player.slot as LeagueLineupSlot };
    }

    let slotIndex =
      Number.isSafeInteger(player.slotIndex) &&
      player.slotIndex >= 0 &&
      !occupiedInterchangeIndexes.has(player.slotIndex)
        ? player.slotIndex
        : 0;
    while (occupiedInterchangeIndexes.has(slotIndex)) slotIndex += 1;
    occupiedInterchangeIndexes.add(slotIndex);

    return { ...player, slot: 'INTERCHANGE', slotIndex };
  });
}

function normalizeSubmittedPlayers(players: readonly unknown[]): SubmittedLineupPlayer[] {
  const parsedPlayers = players.flatMap((player) => {
    if (!player || typeof player !== 'object') return [];
    const source = player as Record<string, unknown>;
    const slotIndex =
      typeof source.slotIndex === 'number'
        ? source.slotIndex
        : typeof source.slotIndex === 'string' && source.slotIndex.trim() !== ''
          ? Number(source.slotIndex)
          : Number.NaN;

    if (typeof source.playerId !== 'string' || !isLeagueLineupSlot(source.slot)) {
      return [];
    }

    return {
      playerId: source.playerId,
      slot: source.slot,
      slotIndex,
    };
  });

  return normalizeLegacyBenchAssignments(parsedPlayers).map((player, index) => {
    const submittedSlotIndex = parsedPlayers[index]?.slotIndex;
    const hasValidSlotIndex =
      Number.isSafeInteger(submittedSlotIndex) && (submittedSlotIndex ?? -1) >= 0;

    return {
      ...player,
      slotIndex: hasValidSlotIndex ? player.slotIndex : (submittedSlotIndex ?? Number.NaN),
    };
  });
}

type PersistedLineupPlayer = {
  id: string;
  playerId: string;
  slot: string;
  slotIndex: number;
  lockedAt: Date | null;
};

async function normalizePersistedBenchAssignments(
  tx: Prisma.TransactionClient,
  players: readonly PersistedLineupPlayer[]
) {
  const normalizedPlayers = normalizeLegacyBenchAssignments(players);
  for (let index = 0; index < players.length; index += 1) {
    if (players[index]?.slot !== 'BENCH') continue;
    const normalizedPlayer = normalizedPlayers[index];
    if (!normalizedPlayer) continue;
    await tx.leagueLineupPlayer.update({
      where: { id: normalizedPlayer.id },
      data: { slot: 'INTERCHANGE', slotIndex: normalizedPlayer.slotIndex },
    });
  }
  return normalizedPlayers;
}

export async function synchronizeLineupPlayerLocks({
  players,
  gameStartsByPlayerId,
  now = new Date(),
}: {
  players: readonly Pick<PersistedLineupPlayer, 'id' | 'playerId' | 'lockedAt'>[];
  gameStartsByPlayerId: ReadonlyMap<string, Date>;
  now?: Date;
}) {
  const effectiveLocksByPlayerId = new Map<string, Date>();
  const updates: Promise<unknown>[] = [];

  for (const player of players) {
    if (player.lockedAt) {
      effectiveLocksByPlayerId.set(player.playerId, player.lockedAt);
      continue;
    }
    const gameStartsAt = gameStartsByPlayerId.get(player.playerId);
    if (!isLineupPlayerLocked(gameStartsAt, now) || !gameStartsAt) continue;
    effectiveLocksByPlayerId.set(player.playerId, gameStartsAt);
    updates.push(
      prisma.leagueLineupPlayer.updateMany({
        where: { id: player.id, lockedAt: null },
        data: { lockedAt: gameStartsAt },
      })
    );
  }

  await Promise.all(updates);
  return effectiveLocksByPlayerId;
}

export async function loadMemberLineup({
  leagueId,
  memberId,
  round,
}: {
  leagueId: string;
  memberId: string;
  round: number;
}) {
  return prisma.$transaction(async (tx) => {
    const query = {
      where: { leagueId_memberId_round: { leagueId, memberId, round } },
      include: {
        players: {
          include: { player: true },
          orderBy: [{ slot: 'asc' as const }, { slotIndex: 'asc' as const }],
        },
      },
    };
    const lineup = await tx.leagueLineup.findUnique(query);
    if (!lineup?.players.some((player) => player.slot === 'BENCH')) return lineup;

    await normalizePersistedBenchAssignments(tx, lineup.players);
    return tx.leagueLineup.findUnique(query);
  });
}

export async function saveMemberLineup({
  leagueId,
  memberId,
  round,
  players,
}: {
  leagueId: string;
  memberId: string;
  round: number;
  players: readonly unknown[];
}): Promise<SaveMemberLineupResult> {
  if (!Number.isSafeInteger(round) || round <= 0) {
    return { ok: false, code: 'INVALID_LINEUP', errors: ['Invalid round.'] };
  }

  const submittedPlayers = normalizeSubmittedPlayers(players);
  if (submittedPlayers.length !== players.length) {
    return {
      ok: false,
      code: 'INVALID_LINEUP',
      errors: ['Lineup payload contains invalid player rows.'],
    };
  }

  const [league, initialRosterPlayers] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true },
    }),
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      include: { player: true },
    }),
  ]);

  if (!league?.settings) {
    return { ok: false, code: 'INVALID_LINEUP', errors: ['League not found.'] };
  }
  const initialIsSetupFallback =
    league.settings.competitionStatus === 'SETUP' && league.settings.competitionRulesVersion === 0;
  const initialCompetitionRound = initialIsSetupFallback
    ? null
    : await prisma.leagueCompetitionRound.findUnique({
        where: {
          leagueId_fixtureVersion_round: {
            leagueId,
            fixtureVersion: league.settings.competitionRulesVersion,
            round,
          },
        },
      });
  if (!initialCompetitionRound && !initialIsSetupFallback) {
    return {
      ok: false,
      code: 'INVALID_LINEUP',
      errors: ['Publish the competition before saving lineups.'],
    };
  }

  const initialRules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const initialRoundLockAt = initialCompetitionRound
    ? (initialCompetitionRound.lockedAt ??
      resolveRoundLockAt(initialRules, initialCompetitionRound))
    : null;
  if (
    initialCompetitionRound?.status === 'NO_MATCHUP' ||
    initialCompetitionRound?.status === 'LOCKED' ||
    initialCompetitionRound?.status === 'FINAL' ||
    (initialRoundLockAt && initialRoundLockAt <= new Date())
  ) {
    return { ok: false, code: 'INVALID_LINEUP', errors: ['This round is locked.'] };
  }

  const timingResult: RoundPlayerGameStartsResult =
    initialRules.lockPolicy === 'INDIVIDUAL_GAME_START'
      ? await loadRoundPlayerGameStarts({
          aflRound: initialCompetitionRound?.aflRound ?? null,
          players: initialRosterPlayers.map((row) => ({
            playerId: row.playerId,
            club: row.player.club,
          })),
        })
      : {
          ok: true,
          gameStartsByPlayerId: new Map<string, Date>(),
          timingStatus: 'AVAILABLE',
        };
  if (!timingResult.ok) {
    return {
      ok: false,
      code: 'TIMING_UNAVAILABLE',
      errors: [timingResult.error],
    };
  }

  const initialRosterFingerprint = initialRosterPlayers
    .map((row) => `${row.playerId}:${row.player.club}`)
    .sort()
    .join('|');

  return prisma.$transaction(async (tx): Promise<SaveMemberLineupResult> => {
    const [currentLeague, currentRosterPlayers] = await Promise.all([
      tx.league.findUnique({
        where: { id: leagueId },
        include: { settings: true },
      }),
      tx.leagueRosterPlayer.findMany({
        where: { leagueId, memberId },
        include: { player: true },
      }),
    ]);
    if (!currentLeague?.settings) {
      return { ok: false, code: 'INVALID_LINEUP', errors: ['League not found.'] };
    }

    const currentIsSetupFallback =
      currentLeague.settings.competitionStatus === 'SETUP' &&
      currentLeague.settings.competitionRulesVersion === 0;
    const currentCompetitionRound = currentIsSetupFallback
      ? null
      : await tx.leagueCompetitionRound.findUnique({
          where: {
            leagueId_fixtureVersion_round: {
              leagueId,
              fixtureVersion: currentLeague.settings.competitionRulesVersion,
              round,
            },
          },
        });
    if (!currentCompetitionRound && !currentIsSetupFallback) {
      return {
        ok: false,
        code: 'INVALID_LINEUP',
        errors: ['Publish the competition before saving lineups.'],
      };
    }

    const currentRosterFingerprint = currentRosterPlayers
      .map((row) => `${row.playerId}:${row.player.club}`)
      .sort()
      .join('|');
    if (
      currentLeague.settings.competitionRulesVersion !== league.settings.competitionRulesVersion ||
      currentLeague.settings.competitionRulesJson !== league.settings.competitionRulesJson ||
      currentCompetitionRound?.aflRound !== initialCompetitionRound?.aflRound ||
      currentRosterFingerprint !== initialRosterFingerprint
    ) {
      return {
        ok: false,
        code: 'RETRY_REQUIRED',
        errors: ['Lineup state changed while saving. Please try again.'],
      };
    }

    const currentRules = parseCompetitionRulesJson(
      currentLeague.settings.competitionRulesJson,
      'goals'
    );
    const currentRoundLockAt = currentCompetitionRound
      ? (currentCompetitionRound.lockedAt ??
        resolveRoundLockAt(currentRules, currentCompetitionRound))
      : null;
    const saveNow = new Date();
    if (
      currentCompetitionRound?.status === 'NO_MATCHUP' ||
      currentCompetitionRound?.status === 'LOCKED' ||
      currentCompetitionRound?.status === 'FINAL' ||
      (currentRoundLockAt && currentRoundLockAt <= saveNow)
    ) {
      return { ok: false, code: 'INVALID_LINEUP', errors: ['This round is locked.'] };
    }

    const existingLineup = await tx.leagueLineup.findUnique({
      where: { leagueId_memberId_round: { leagueId, memberId, round } },
      include: { players: true },
    });
    const normalizedExistingPlayers = existingLineup
      ? await normalizePersistedBenchAssignments(tx, existingLineup.players)
      : [];
    const existingPlayersWithLocks = await Promise.all(
      normalizedExistingPlayers.map(async (player) => {
        if (player.lockedAt) return player;
        const gameStartsAt = timingResult.gameStartsByPlayerId.get(player.playerId);
        if (!isLineupPlayerLocked(gameStartsAt, saveNow) || !gameStartsAt) return player;
        await tx.leagueLineupPlayer.updateMany({
          where: { id: player.id, lockedAt: null },
          data: { lockedAt: gameStartsAt },
        });
        return { ...player, lockedAt: gameStartsAt };
      })
    );
    const existingLockedPlayers = existingPlayersWithLocks
      .filter((player) => player.lockedAt)
      .map((player) => ({
        playerId: player.playerId,
        slot: player.slot,
        slotIndex: player.slotIndex,
      }));

    const validationResult = validateLineupSubmission({
      lineupSlots: parseLineupSlotsJson(currentLeague.settings.lineupSlotsJson),
      rosterPlayers: currentRosterPlayers.map((row) => ({
        playerId: row.playerId,
        position: row.player.position,
        club: row.player.club,
        gameStartsAt: timingResult.gameStartsByPlayerId.get(row.playerId) ?? null,
      })),
      existingLockedPlayers,
      submittedPlayers,
      interchangeSlots: currentRules.interchangeSlots,
      now: saveNow,
    });
    if (!validationResult.ok) {
      return {
        ok: false,
        code: 'INVALID_LINEUP',
        errors: validationResult.errors,
      };
    }

    const upserted = await tx.leagueLineup.upsert({
      where: { leagueId_memberId_round: { leagueId, memberId, round } },
      create: { leagueId, memberId, round },
      update: {},
    });

    const lockedPlayerIds = new Set(existingLockedPlayers.map((player) => player.playerId));
    await tx.leagueLineupPlayer.deleteMany({
      where: {
        lineupId: upserted.id,
        playerId: { notIn: [...lockedPlayerIds] },
      },
    });
    const mutableSubmittedPlayers = submittedPlayers.filter(
      (player) => !lockedPlayerIds.has(player.playerId)
    );
    if (mutableSubmittedPlayers.length > 0) {
      await tx.leagueLineupPlayer.createMany({
        data: mutableSubmittedPlayers.map((player) => ({
          lineupId: upserted.id,
          playerId: player.playerId,
          slot: player.slot,
          slotIndex: player.slotIndex,
        })),
      });
    }

    const lineup = await tx.leagueLineup.findUnique({
      where: { id: upserted.id },
      include: {
        players: {
          include: { player: true },
          orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
        },
      },
    });
    return { ok: true, data: lineup };
  });
}
