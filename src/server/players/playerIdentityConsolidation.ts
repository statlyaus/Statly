import type { Prisma, PrismaClient } from '@prisma/client';

import {
  planPlayerIdentityConsolidation,
  type PlayerAliasMapping,
  type PlayerIdentityConsolidationPlan,
} from './playerIdentityConsolidationPlanner';

export class PlayerIdentityConsolidationBlockedError extends Error {
  constructor(readonly plan: PlayerIdentityConsolidationPlan) {
    super(`Player identity consolidation is blocked by ${plan.blockers.length} conflict(s)`);
    this.name = 'PlayerIdentityConsolidationBlockedError';
  }
}

type AliasMap = ReadonlyMap<string, string>;

function replacePlayerIds(value: unknown, aliases: AliasMap): unknown {
  if (typeof value === 'string') {
    return aliases.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replacePlayerIds(entry, aliases));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replacePlayerIds(entry, aliases)])
    );
  }

  return value;
}

function rewriteJson(value: string | null, aliases: AliasMap): string | null {
  if (!value) return value;
  if (![...aliases.keys()].some((aliasId) => value.includes(aliasId))) return value;

  try {
    return JSON.stringify(replacePlayerIds(JSON.parse(value), aliases));
  } catch {
    throw new Error('Player alias appears in a value that is not valid JSON');
  }
}

function rewriteJsonIdArray(value: string | null, aliases: AliasMap): string | null {
  const rewritten = rewriteJson(value, aliases);
  if (!rewritten) return rewritten;
  const parsed = JSON.parse(rewritten) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON player ID array during identity consolidation');
  }
  return JSON.stringify([...new Set(parsed.map((entry) => String(entry)))]);
}

async function mergeWatchlists(
  tx: Prisma.TransactionClient,
  aliasId: string,
  canonicalPlayerId: string
) {
  const rows = await tx.draftWatchlist.findMany({ where: { playerId: aliasId } });
  for (const row of rows) {
    const existing = await tx.draftWatchlist.findUnique({
      where: {
        draftId_memberId_playerId: {
          draftId: row.draftId,
          memberId: row.memberId,
          playerId: canonicalPlayerId,
        },
      },
    });
    if (existing) {
      await tx.draftWatchlist.update({
        where: { id: existing.id },
        data: {
          priority: Math.min(existing.priority, row.priority),
          notes: existing.notes ?? row.notes,
        },
      });
      await tx.draftWatchlist.delete({ where: { id: row.id } });
    } else {
      await tx.draftWatchlist.update({
        where: { id: row.id },
        data: { playerId: canonicalPlayerId },
      });
    }
  }
}

async function mergePreDraftQueues(
  tx: Prisma.TransactionClient,
  aliasId: string,
  canonicalPlayerId: string
) {
  const rows = await tx.preDraftQueue.findMany({ where: { playerId: aliasId } });
  for (const row of rows) {
    const existing = await tx.preDraftQueue.findUnique({
      where: {
        draftId_memberId_playerId: {
          draftId: row.draftId,
          memberId: row.memberId,
          playerId: canonicalPlayerId,
        },
      },
    });
    if (existing) {
      await tx.preDraftQueue.update({
        where: { id: existing.id },
        data: { rank: Math.min(existing.rank, row.rank), notes: existing.notes ?? row.notes },
      });
      await tx.preDraftQueue.delete({ where: { id: row.id } });
    } else {
      await tx.preDraftQueue.update({
        where: { id: row.id },
        data: { playerId: canonicalPlayerId },
      });
    }
  }
}

async function mergeLegacyQueues(
  tx: Prisma.TransactionClient,
  aliasId: string,
  canonicalPlayerId: string
) {
  const rows = await tx.queueItem.findMany({ where: { playerId: aliasId } });
  for (const row of rows) {
    const existing = await tx.queueItem.findUnique({
      where: { memberId_playerId: { memberId: row.memberId, playerId: canonicalPlayerId } },
    });
    if (existing) {
      await tx.queueItem.delete({ where: { id: row.id } });
    } else {
      await tx.queueItem.update({ where: { id: row.id }, data: { playerId: canonicalPlayerId } });
    }
  }
}

async function mergeRosterOwnership(
  tx: Prisma.TransactionClient,
  aliasId: string,
  canonicalPlayerId: string
) {
  const rows = await tx.leagueRosterPlayer.findMany({ where: { playerId: aliasId } });
  for (const row of rows) {
    const existing = await tx.leagueRosterPlayer.findUnique({
      where: { leagueId_playerId: { leagueId: row.leagueId, playerId: canonicalPlayerId } },
    });
    if (!existing) {
      await tx.leagueRosterPlayer.update({
        where: { id: row.id },
        data: { playerId: canonicalPlayerId },
      });
      continue;
    }

    if (existing.memberId !== row.memberId) {
      throw new Error(`Ownership changed after preflight for league ${row.leagueId}`);
    }

    if (row.acquiredAt < existing.acquiredAt) {
      await tx.leagueRosterPlayer.update({
        where: { id: existing.id },
        data: {
          draftId: row.draftId,
          pickId: row.pickId,
          slot: existing.slot ?? row.slot,
          acquiredBy: row.acquiredBy,
          acquiredAt: row.acquiredAt,
        },
      });
    }
    await tx.leagueRosterPlayer.delete({ where: { id: row.id } });
  }
}

async function rewriteLegacyRosterDocuments(tx: Prisma.TransactionClient, aliases: AliasMap) {
  const rows = await tx.leagueRoster.findMany();
  for (const row of rows) {
    const playerIds = rewriteJsonIdArray(row.playerIds, aliases)!;
    const captainId = row.captainId ? (aliases.get(row.captainId) ?? row.captainId) : null;
    const viceCaptainId = row.viceCaptainId
      ? (aliases.get(row.viceCaptainId) ?? row.viceCaptainId)
      : null;
    const benchOrder = rewriteJsonIdArray(row.benchOrder, aliases);
    if (
      playerIds !== row.playerIds ||
      captainId !== row.captainId ||
      viceCaptainId !== row.viceCaptainId ||
      benchOrder !== row.benchOrder
    ) {
      await tx.leagueRoster.update({
        where: { id: row.id },
        data: { playerIds, captainId, viceCaptainId, benchOrder },
      });
    }
  }
}

async function rewriteGenericJsonDocuments(tx: Prisma.TransactionClient, aliases: AliasMap) {
  const lobbyActivities = await tx.lobbyActivity.findMany({ where: { details: { not: null } } });
  for (const row of lobbyActivities) {
    const details = rewriteJson(row.details, aliases);
    if (details !== row.details)
      await tx.lobbyActivity.update({ where: { id: row.id }, data: { details } });
  }

  const draftEvents = await tx.draftEvent.findMany({ where: { payload: { not: null } } });
  for (const row of draftEvents) {
    const payload = rewriteJson(row.payload, aliases);
    if (payload !== row.payload)
      await tx.draftEvent.update({ where: { id: row.id }, data: { payload } });
  }

  const competitionAudits = await tx.leagueCompetitionAudit.findMany();
  for (const row of competitionAudits) {
    const payloadJson = rewriteJson(row.payloadJson, aliases)!;
    if (payloadJson !== row.payloadJson) {
      await tx.leagueCompetitionAudit.update({ where: { id: row.id }, data: { payloadJson } });
    }
  }

  const teamActions = await tx.teamAction.findMany();
  for (const row of teamActions) {
    const details = rewriteJson(row.details, aliases)!;
    if (details !== row.details)
      await tx.teamAction.update({ where: { id: row.id }, data: { details } });
  }

  const tradeEvents = await tx.leagueTradeEvent.findMany({ where: { payloadJson: { not: null } } });
  for (const row of tradeEvents) {
    const payloadJson = rewriteJson(row.payloadJson, aliases);
    if (payloadJson !== row.payloadJson) {
      await tx.leagueTradeEvent.update({ where: { id: row.id }, data: { payloadJson } });
    }
  }

  const tradeCommands = await tx.leagueTradeCommand.findMany({
    where: { responseJson: { not: null } },
  });
  for (const row of tradeCommands) {
    const responseJson = rewriteJson(row.responseJson, aliases);
    if (responseJson !== row.responseJson) {
      await tx.leagueTradeCommand.update({ where: { id: row.id }, data: { responseJson } });
    }
  }

  const outboxEvents = await tx.leagueTradeOutboxEvent.findMany();
  for (const row of outboxEvents) {
    const payloadJson = rewriteJson(row.payloadJson, aliases)!;
    if (payloadJson !== row.payloadJson) {
      await tx.leagueTradeOutboxEvent.update({
        where: { sequence: row.sequence },
        data: { payloadJson },
      });
    }
  }
}

async function assertNoRelationalReferences(tx: Prisma.TransactionClient, aliasId: string) {
  const counts = await Promise.all([
    tx.pick.count({ where: { playerId: aliasId } }),
    tx.draftWatchlist.count({ where: { playerId: aliasId } }),
    tx.preDraftQueue.count({ where: { playerId: aliasId } }),
    tx.queueItem.count({ where: { playerId: aliasId } }),
    tx.leagueRosterPlayer.count({ where: { playerId: aliasId } }),
    tx.leagueLineupPlayer.count({ where: { playerId: aliasId } }),
    tx.leagueTradePlayer.count({ where: { playerId: aliasId } }),
    tx.leagueLineupAutosub.count({
      where: { OR: [{ outgoingPlayerId: aliasId }, { replacementPlayerId: aliasId }] },
    }),
  ]);
  if (counts.some((count) => count > 0)) {
    throw new Error(`Relational references remain for player alias ${aliasId}`);
  }
}

async function applyMapping(
  tx: Prisma.TransactionClient,
  mapping: PlayerAliasMapping
): Promise<void> {
  const { aliasId, canonicalPlayerId } = mapping;
  await tx.pick.updateMany({ where: { playerId: aliasId }, data: { playerId: canonicalPlayerId } });
  await mergeWatchlists(tx, aliasId, canonicalPlayerId);
  await mergePreDraftQueues(tx, aliasId, canonicalPlayerId);
  await mergeLegacyQueues(tx, aliasId, canonicalPlayerId);
  await mergeRosterOwnership(tx, aliasId, canonicalPlayerId);
  await tx.leagueLineupPlayer.updateMany({
    where: { playerId: aliasId },
    data: { playerId: canonicalPlayerId },
  });
  await tx.leagueTradePlayer.updateMany({
    where: { playerId: aliasId },
    data: { playerId: canonicalPlayerId },
  });
  await tx.leagueLineupAutosub.updateMany({
    where: { outgoingPlayerId: aliasId },
    data: { outgoingPlayerId: canonicalPlayerId },
  });
  await tx.leagueLineupAutosub.updateMany({
    where: { replacementPlayerId: aliasId },
    data: { replacementPlayerId: canonicalPlayerId },
  });
  await tx.playerExternalIdentity.updateMany({
    where: { playerId: aliasId },
    data: { playerId: canonicalPlayerId },
  });
}

export async function consolidatePlayerIdentities(
  client: PrismaClient,
  mappings: readonly PlayerAliasMapping[]
): Promise<PlayerIdentityConsolidationPlan> {
  return client.$transaction(async (tx) => {
    const plan = await planPlayerIdentityConsolidation(tx, mappings);
    if (plan.status === 'blocked') {
      throw new PlayerIdentityConsolidationBlockedError(plan);
    }

    const aliasMap = new Map(
      plan.mappings.map((mapping) => [mapping.aliasId, mapping.canonicalPlayerId])
    );
    for (const mapping of plan.mappings) {
      await applyMapping(tx, mapping);
    }

    await rewriteLegacyRosterDocuments(tx, aliasMap);
    await rewriteGenericJsonDocuments(tx, aliasMap);

    for (const mapping of plan.mappings) {
      await assertNoRelationalReferences(tx, mapping.aliasId);
      await tx.player.delete({ where: { id: mapping.aliasId } });
    }

    return plan;
  });
}
