import 'server-only';

import { getPlayers } from '@/lib/data';
import { prisma } from '@/lib/prisma';
import {
  buildLeaguePlayerStatDatasetForTargets,
  type LeaguePlayerStatTarget,
} from '@/server/players/readModels/leaguePlayerStatReadModel';
import {
  REAL_DATA_NINE_CATEGORY_PRESET,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

import { parseCategoryDirectionsJson } from './categoryDirections';
import { parseCompetitionRulesJson } from './competitionRules';
import {
  calculateLineupContributionValue,
  optimizeLineupAssignment,
  type LineupOptimizationCandidate,
} from './lineupOptimization';
import { parseLineupSlotsJson } from './lineupSettings';
import {
  loadMemberLineup,
  loadMemberLineupRoundContext,
  loadRoundPlayerGameStarts,
  resolveCurrentCompetitionRoundNumber,
  saveMemberLineup,
} from './lineupService';

/**
 * Persisted lineup optimisation for a member's current round.
 *
 * The command owns orchestration only: it reads authoritative state, derives locks from the same
 * sources the save boundary uses, values each player through the shared league stat read model, and
 * then persists the assignment through `saveMemberLineup` so every existing lock, timing, and
 * concurrency invariant still applies. No second writer touches `LeagueLineup`.
 */

export type OptimizeMemberLineupResult =
  | {
      ok: true;
      round: number;
      activeProjectedValue: number;
      promotedPlayerIds: string[];
      demotedPlayerIds: string[];
      unchangedPlayerIds: string[];
    }
  | { ok: false; status: number; error: string };

export function resolveLeagueCategories(rawCategories: unknown): FantasyCategoryKey[] {
  let parsed = rawCategories;
  if (typeof rawCategories === 'string') {
    try {
      parsed = JSON.parse(rawCategories);
    } catch {
      parsed = rawCategories.split(',').map((category) => category.trim());
    }
  }

  return normalizeFantasyCategoryKeys(parsed, REAL_DATA_NINE_CATEGORY_PRESET);
}

export async function optimizeMemberLineup({
  leagueId,
  memberId,
  now = new Date(),
}: {
  leagueId: string;
  memberId: string;
  now?: Date;
}): Promise<OptimizeMemberLineupResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league?.settings) {
    return { ok: false, status: 404, error: 'League not found' };
  }

  const round = (await resolveCurrentCompetitionRoundNumber(leagueId, now)) ?? 1;
  const roundContext = await loadMemberLineupRoundContext({ leagueId, memberId, round, now });
  if (roundContext && roundContext.lockState !== 'OPEN') {
    return { ok: false, status: 409, error: 'This round is locked.' };
  }

  const [rosterPlayers, currentLineup] = await Promise.all([
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      include: { player: true },
      orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
    }),
    loadMemberLineup({ leagueId, memberId, round }),
  ]);
  if (rosterPlayers.length === 0) {
    return { ok: false, status: 400, error: 'This team has no rostered players to optimise.' };
  }

  const categories = resolveLeagueCategories(league.categoriesJson);
  const rules = parseCompetitionRulesJson(
    league.settings.competitionRulesJson,
    categories[0] ?? REAL_DATA_NINE_CATEGORY_PRESET[0]
  );
  const lineupSlots = parseLineupSlotsJson(league.settings.lineupSlotsJson);
  const categoryDirections = parseCategoryDirectionsJson(
    categories,
    league.settings.categoryDirectionsJson
  );

  const timing =
    rules.lockPolicy === 'INDIVIDUAL_GAME_START'
      ? await loadRoundPlayerGameStarts({
          aflRound: roundContext?.aflRound ?? null,
          players: rosterPlayers.map(({ playerId, player }) => ({ playerId, club: player.club })),
        })
      : {
          ok: true as const,
          gameStartsByPlayerId: new Map<string, Date>(),
          timingStatus: 'AVAILABLE' as const,
        };
  if (!timing.ok) {
    return { ok: false, status: 503, error: timing.error };
  }

  const dataset = buildLeaguePlayerStatDatasetForTargets(
    await getPlayers(),
    rosterPlayers.map<LeaguePlayerStatTarget>(({ playerId, player }) => ({
      id: playerId,
      name: player.name,
      club: player.club,
    })),
    { categories, categoryDirections }
  );

  const currentAssignmentByPlayerId = new Map(
    (currentLineup?.players ?? []).map((assignment) => [assignment.playerId, assignment])
  );

  const candidates: LineupOptimizationCandidate[] = rosterPlayers.map(({ playerId }) => {
    const current = currentAssignmentByPlayerId.get(playerId);
    const gameStartsAt = timing.gameStartsByPlayerId.get(playerId) ?? null;
    const gameStarted = Boolean(gameStartsAt && gameStartsAt.getTime() <= now.getTime());
    const isLocked = Boolean(current && (current.lockedAt || gameStarted));

    return {
      playerId,
      value: calculateLineupContributionValue({
        categories,
        categoryDirections,
        valuesByCategory: dataset.playersById[playerId]?.values ?? {},
      }),
      isLocked,
      lockedSlot: isLocked ? current?.slot : undefined,
      lockedSlotIndex: isLocked ? current?.slotIndex : undefined,
      previousSlot: current?.slot,
      previousSlotIndex: current?.slotIndex,
    };
  });

  const optimization = optimizeLineupAssignment({
    candidates,
    lineupSlots,
    interchangeSlots: rules.interchangeSlots,
  });

  const saved = await saveMemberLineup({
    leagueId,
    memberId,
    round,
    players: optimization.assignments,
  });
  if (!saved.ok) {
    return {
      ok: false,
      status: saved.code === 'TIMING_UNAVAILABLE' ? 503 : 400,
      error: saved.errors.join(' '),
    };
  }

  return {
    ok: true,
    round,
    activeProjectedValue: optimization.activeProjectedValue,
    promotedPlayerIds: optimization.promotedPlayerIds,
    demotedPlayerIds: optimization.demotedPlayerIds,
    unchangedPlayerIds: optimization.unchangedPlayerIds,
  };
}
