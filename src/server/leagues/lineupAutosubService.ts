import 'server-only';

import { logLeagueActivity } from '@/lib/activity';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

import {
  AUTOSUB_ACTIVE_SLOT_ORDER,
  resolveAutosubs,
  type AutosubActiveAssignment,
} from './autosubService';
import type { LeagueLineupSlot } from './scoringTypes';

interface LineupPlayerAssignment {
  id: string;
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
}

const ACTIVE_SLOTS = new Set<LeagueLineupSlot>(AUTOSUB_ACTIVE_SLOT_ORDER);

export async function resolveAndPersistLineupAutosubs({
  leagueId,
  lineupId,
  players,
  nonPlayingReasonByPlayerId,
}: {
  leagueId: string;
  lineupId: string;
  players: readonly LineupPlayerAssignment[];
  nonPlayingReasonByPlayerId: ReadonlyMap<string, 'DID_NOT_PLAY' | 'CLUB_BYE'>;
}): Promise<LineupPlayerAssignment[]> {
  const activeAssignments = players.flatMap((player) =>
    ACTIVE_SLOTS.has(player.slot)
      ? [
          {
            playerId: player.playerId,
            slot: player.slot,
            slotIndex: player.slotIndex,
          } as AutosubActiveAssignment,
        ]
      : []
  );
  const interchangeAssignments = players.flatMap((player) =>
    player.slot === 'INTERCHANGE'
      ? [{ playerId: player.playerId, slot: 'INTERCHANGE' as const, slotIndex: player.slotIndex }]
      : []
  );
  const resolution = resolveAutosubs({
    activeAssignments,
    interchangeAssignments,
    confirmedDidNotPlayPlayerIds: [...nonPlayingReasonByPlayerId.keys()],
  });
  if (!resolution.decisions.length) return [...players];

  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const temporaryIndex =
    Math.max(0, ...players.map((player) => player.slotIndex)) + resolution.decisions.length + 1;

  await prisma.$transaction(async (tx) => {
    for (const [decisionIndex, decision] of resolution.decisions.entries()) {
      const outgoing = playersById.get(decision.outgoingPlayerId);
      const replacement = playersById.get(decision.replacementPlayerId);
      if (!outgoing || !replacement) {
        throw new Error('Autosub assignments changed before they could be persisted.');
      }

      await tx.leagueLineupPlayer.update({
        where: { id: outgoing.id },
        data: { slot: 'INTERCHANGE', slotIndex: temporaryIndex + decisionIndex },
      });
      await tx.leagueLineupPlayer.update({
        where: { id: replacement.id },
        data: { slot: decision.originalSlot, slotIndex: decision.originalSlotIndex },
      });
      await tx.leagueLineupPlayer.update({
        where: { id: outgoing.id },
        data: { slot: 'INTERCHANGE', slotIndex: decision.interchangeIndex },
      });
      await tx.leagueLineupAutosub.create({
        data: {
          lineupId,
          outgoingPlayerId: decision.outgoingPlayerId,
          replacementPlayerId: decision.replacementPlayerId,
          outgoingSlot: decision.originalSlot,
          outgoingSlotIndex: decision.originalSlotIndex,
          interchangeSlotIndex: decision.interchangeIndex,
          reason: nonPlayingReasonByPlayerId.get(decision.outgoingPlayerId) ?? 'DID_NOT_PLAY',
        },
      });
    }

    await tx.leagueCompetitionAudit.create({
      data: {
        leagueId,
        eventType: 'AUTOSUB_RESOLVED',
        payloadJson: JSON.stringify({ lineupId, decisions: resolution.decisions }),
      },
    });
  });

  void logLeagueActivity(leagueId, 'lineup-autosubs-resolved', {
    lineupId,
    decisions: resolution.decisions,
  }).catch((error: unknown) => {
    logger.warn('Failed to record lineup autosub activity', { leagueId, lineupId, error });
  });

  const slotByPlayerId = new Map<string, Pick<LineupPlayerAssignment, 'slot' | 'slotIndex'>>();
  for (const assignment of resolution.activeAssignments) {
    slotByPlayerId.set(assignment.playerId, {
      slot: assignment.slot,
      slotIndex: assignment.slotIndex,
    });
  }
  for (const assignment of resolution.interchangeAssignments) {
    slotByPlayerId.set(assignment.playerId, {
      slot: assignment.slot,
      slotIndex: assignment.slotIndex,
    });
  }

  return players.map((player) => {
    const resolvedSlot = slotByPlayerId.get(player.playerId);
    return resolvedSlot ? { ...player, ...resolvedSlot } : player;
  });
}
