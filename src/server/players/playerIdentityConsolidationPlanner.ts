import type { Prisma } from '@prisma/client';

import { containsPlayerIdentityReference } from './playerIdentityJsonReferences';

export type PlayerAliasMapping = {
  aliasId: string;
  canonicalPlayerId: string;
};

export type PlayerIdentityBlockerCode =
  | 'INVALID_MAPPING'
  | 'MISSING_PLAYER'
  | 'CANONICAL_IS_ALIAS'
  | 'DRAFT_PICK_COLLISION'
  | 'LEAGUE_OWNERSHIP_CONFLICT'
  | 'LEGACY_OWNERSHIP_CONFLICT'
  | 'INVALID_LEGACY_ROSTER'
  | 'PENDING_ACTION_REFERENCE'
  | 'LINEUP_COLLISION'
  | 'TRADE_COLLISION'
  | 'CAPTAIN_COLLISION'
  | 'AUTOSUB_REFERENCE'
  | 'AUTOSUB_COLLISION';

export type PlayerIdentityBlocker = {
  code: PlayerIdentityBlockerCode;
  canonicalPlayerId: string;
  scopeId?: string;
  aliasIds: string[];
  message: string;
};

export type PlayerIdentityConsolidationPlan = {
  status: 'ready' | 'blocked';
  mappings: PlayerAliasMapping[];
  blockers: PlayerIdentityBlocker[];
  references: {
    picks: number;
    watchlists: number;
    preDraftQueues: number;
    queueItems: number;
    rosterPlayers: number;
    legacyRosters: number;
    lineupPlayers: number;
    autosubs: number;
    tradePlayers: number;
    jsonDocuments: number;
  };
  safeSameMemberRosterMerges: number;
};

type PlannerClient = Pick<
  Prisma.TransactionClient,
  | 'player'
  | 'playerExternalIdentity'
  | 'pick'
  | 'draftWatchlist'
  | 'preDraftQueue'
  | 'queueItem'
  | 'leagueRosterPlayer'
  | 'leagueRoster'
  | 'leagueLineupPlayer'
  | 'leagueLineupAutosub'
  | 'leagueTradePlayer'
  | 'lobbyActivity'
  | 'draftEvent'
  | 'leagueCompetitionAudit'
  | 'teamAction'
  | 'leagueTradeEvent'
  | 'leagueTradeCommand'
  | 'leagueTradeOutboxEvent'
>;

function normalizeMappings(input: readonly PlayerAliasMapping[]): PlayerAliasMapping[] {
  const byAlias = new Map<string, string>();

  for (const mapping of input) {
    const aliasId = mapping.aliasId.trim();
    const canonicalPlayerId = mapping.canonicalPlayerId.trim();
    const existingTarget = byAlias.get(aliasId);

    if (!aliasId || !canonicalPlayerId || aliasId === canonicalPlayerId) {
      throw new Error(
        `Invalid player alias mapping: ${mapping.aliasId} -> ${mapping.canonicalPlayerId}`
      );
    }

    if (existingTarget && existingTarget !== canonicalPlayerId) {
      throw new Error(`Player alias ${aliasId} maps to multiple canonical players`);
    }

    byAlias.set(aliasId, canonicalPlayerId);
  }

  return [...byAlias.entries()]
    .map(([aliasId, canonicalPlayerId]) => ({ aliasId, canonicalPlayerId }))
    .sort((left, right) => left.aliasId.localeCompare(right.aliasId));
}

function projectedPlayerId(playerId: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(playerId) ?? playerId;
}

function groupBy<T>(rows: readonly T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function containsAnyAlias(value: string | null, aliasIds: ReadonlySet<string>): boolean {
  return containsPlayerIdentityReference(value, aliasIds);
}

const PLANNER_BATCH_SIZE = 250;

async function collectBatchedRows<T extends { id: string }>(
  loadPage: (cursor: string | undefined) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;

  do {
    const page = await loadPage(cursor);
    rows.push(...page);
    cursor = page.length === PLANNER_BATCH_SIZE ? page[page.length - 1]?.id : undefined;
  } while (cursor);

  return rows;
}

export async function planPlayerIdentityConsolidation(
  client: PlannerClient,
  inputMappings: readonly PlayerAliasMapping[]
): Promise<PlayerIdentityConsolidationPlan> {
  let mappings: PlayerAliasMapping[];
  const blockers: PlayerIdentityBlocker[] = [];

  try {
    mappings = normalizeMappings(inputMappings);
  } catch (error) {
    return {
      status: 'blocked',
      mappings: [],
      blockers: [
        {
          code: 'INVALID_MAPPING',
          canonicalPlayerId: '',
          aliasIds: [],
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      references: {
        picks: 0,
        watchlists: 0,
        preDraftQueues: 0,
        queueItems: 0,
        rosterPlayers: 0,
        legacyRosters: 0,
        lineupPlayers: 0,
        autosubs: 0,
        tradePlayers: 0,
        jsonDocuments: 0,
      },
      safeSameMemberRosterMerges: 0,
    };
  }

  const requestedMappings = mappings;
  const requestedAliasIds = new Set(requestedMappings.map((mapping) => mapping.aliasId));
  const requestedCanonicalIds = new Set(
    requestedMappings.map((mapping) => mapping.canonicalPlayerId)
  );

  for (const canonicalPlayerId of requestedCanonicalIds) {
    if (requestedAliasIds.has(canonicalPlayerId)) {
      blockers.push({
        code: 'CANONICAL_IS_ALIAS',
        canonicalPlayerId,
        aliasIds: [canonicalPlayerId],
        message: `Canonical player ${canonicalPlayerId} is also listed as an alias; flatten the manifest first.`,
      });
    }
  }

  const allPlayerIds = [...new Set([...requestedAliasIds, ...requestedCanonicalIds])];
  const existingPlayers = await client.player.findMany({
    where: { id: { in: allPlayerIds } },
    select: { id: true },
  });
  const existingPlayerIds = new Set(existingPlayers.map((player) => player.id));
  const retiredAliasIdentities = await client.playerExternalIdentity.findMany({
    where: { provider: 'statly-legacy', externalId: { in: [...requestedAliasIds] } },
    select: { externalId: true, playerId: true },
  });
  const retiredAliasTargets = new Map(
    retiredAliasIdentities.map((identity) => [identity.externalId, identity.playerId])
  );

  mappings = requestedMappings.filter((mapping) => {
    const aliasExists = existingPlayerIds.has(mapping.aliasId);
    const canonicalExists = existingPlayerIds.has(mapping.canonicalPlayerId);
    const alreadyApplied =
      !aliasExists &&
      canonicalExists &&
      retiredAliasTargets.get(mapping.aliasId) === mapping.canonicalPlayerId;

    if (!canonicalExists || (!aliasExists && !alreadyApplied)) {
      const missingIds = [mapping.aliasId, mapping.canonicalPlayerId].filter(
        (playerId) => !existingPlayerIds.has(playerId)
      );
      blockers.push({
        code: 'MISSING_PLAYER',
        canonicalPlayerId: mapping.canonicalPlayerId,
        aliasIds: [mapping.aliasId],
        message: `Mapping references missing Player rows: ${missingIds.join(', ')}`,
      });
    }
    return aliasExists && canonicalExists;
  });

  const aliasMap = new Map(mappings.map((mapping) => [mapping.aliasId, mapping.canonicalPlayerId]));
  const aliasIds = new Set(aliasMap.keys());
  const canonicalIds = new Set(aliasMap.values());

  const referencedPlayerIds = [...new Set([...aliasIds, ...canonicalIds])];
  const aliasIdList = [...aliasIds];
  const cursorPage = (cursor: string | undefined): { cursor?: { id: string }; skip?: number } =>
    cursor ? { cursor: { id: cursor }, skip: 1 } : {};
  const [
    picks,
    watchlists,
    preDraftQueues,
    queueItems,
    rosterPlayers,
    legacyRosters,
    lineupPlayers,
    autosubs,
    tradePlayers,
    lobbyActivities,
    draftEvents,
    competitionAudits,
    teamActions,
    tradeEvents,
    tradeCommands,
    tradeOutboxEvents,
  ] = await Promise.all([
    client.pick.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    client.draftWatchlist.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    client.preDraftQueue.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    client.queueItem.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    client.leagueRosterPlayer.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    collectBatchedRows((cursor) =>
      client.leagueRoster.findMany({
        where: {
          OR: [
            ...referencedPlayerIds.map((playerId) => ({ playerIds: { contains: playerId } })),
            { captainId: { in: referencedPlayerIds } },
            { viceCaptainId: { in: referencedPlayerIds } },
            ...referencedPlayerIds.map((playerId) => ({ benchOrder: { contains: playerId } })),
          ],
        },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    client.leagueLineupPlayer.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    client.leagueLineupAutosub.findMany({
      where: {
        OR: [
          { outgoingPlayerId: { in: referencedPlayerIds } },
          { replacementPlayerId: { in: referencedPlayerIds } },
        ],
      },
    }),
    client.leagueTradePlayer.findMany({ where: { playerId: { in: referencedPlayerIds } } }),
    collectBatchedRows((cursor) =>
      client.lobbyActivity.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ details: { contains: aliasId } })) },
        select: { id: true, details: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.draftEvent.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ payload: { contains: aliasId } })) },
        select: { id: true, payload: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.leagueCompetitionAudit.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ payloadJson: { contains: aliasId } })) },
        select: { id: true, payloadJson: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.teamAction.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ details: { contains: aliasId } })) },
        select: { id: true, leagueId: true, status: true, details: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.leagueTradeEvent.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ payloadJson: { contains: aliasId } })) },
        select: { id: true, payloadJson: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.leagueTradeCommand.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ responseJson: { contains: aliasId } })) },
        select: { id: true, responseJson: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
    collectBatchedRows((cursor) =>
      client.leagueTradeOutboxEvent.findMany({
        where: { OR: aliasIdList.map((aliasId) => ({ payloadJson: { contains: aliasId } })) },
        select: { id: true, payloadJson: true },
        orderBy: { id: 'asc' },
        take: PLANNER_BATCH_SIZE,
        ...cursorPage(cursor),
      })
    ),
  ]);

  for (const [key, rows] of groupBy(
    picks,
    (row) => `${row.draftId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2 || !rows.some((row) => aliasIds.has(row.playerId))) continue;
    const [draftId, canonicalPlayerId] = key.split('\u0000');
    blockers.push({
      code: 'DRAFT_PICK_COLLISION',
      canonicalPlayerId,
      scopeId: draftId,
      aliasIds: rows.map((row) => row.playerId),
      message: `Draft ${draftId} contains more than one pick for canonical player ${canonicalPlayerId}.`,
    });
  }

  let safeSameMemberRosterMerges = 0;
  for (const [key, rows] of groupBy(
    rosterPlayers,
    (row) => `${row.leagueId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2 || !rows.some((row) => aliasIds.has(row.playerId))) continue;
    const [leagueId, canonicalPlayerId] = key.split('\u0000');
    const memberIds = new Set(rows.map((row) => row.memberId));
    if (memberIds.size === 1) {
      safeSameMemberRosterMerges += rows.length - 1;
      continue;
    }
    blockers.push({
      code: 'LEAGUE_OWNERSHIP_CONFLICT',
      canonicalPlayerId,
      scopeId: leagueId,
      aliasIds: rows.map((row) => row.playerId),
      message: `League ${leagueId} has different members owning aliases of ${canonicalPlayerId}.`,
    });
  }

  const ownershipEvidence = rosterPlayers.map((row) => ({
    leagueId: row.leagueId,
    memberId: row.memberId,
    playerId: row.playerId,
    sourceId: row.id,
  }));
  for (const roster of legacyRosters) {
    let playerIds: string[];
    try {
      const parsed = JSON.parse(roster.playerIds) as unknown;
      if (!Array.isArray(parsed) || parsed.some((playerId) => typeof playerId !== 'string')) {
        throw new Error('not a string array');
      }
      playerIds = parsed;
    } catch {
      if (containsAnyAlias(roster.playerIds, aliasIds)) {
        blockers.push({
          code: 'INVALID_LEGACY_ROSTER',
          canonicalPlayerId: '',
          scopeId: roster.id,
          aliasIds: [...aliasIds].filter((aliasId) => roster.playerIds.includes(aliasId)),
          message: `Legacy roster ${roster.id} contains player aliases in invalid JSON.`,
        });
      }
      continue;
    }

    for (const playerId of playerIds) {
      if (!referencedPlayerIds.includes(playerId)) continue;
      ownershipEvidence.push({
        leagueId: roster.leagueId,
        memberId: roster.memberId,
        playerId,
        sourceId: roster.id,
      });
    }
  }

  for (const [key, rows] of groupBy(
    ownershipEvidence,
    (row) => `${row.leagueId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    const memberIds = new Set(rows.map((row) => row.memberId));
    if (memberIds.size < 2 || !rows.some((row) => aliasIds.has(row.playerId))) continue;
    const [leagueId, canonicalPlayerId] = key.split('\u0000');
    const alreadyBlocked = blockers.some(
      (blocker) =>
        blocker.code === 'LEAGUE_OWNERSHIP_CONFLICT' &&
        blocker.scopeId === leagueId &&
        blocker.canonicalPlayerId === canonicalPlayerId
    );
    if (alreadyBlocked) continue;
    blockers.push({
      code: 'LEGACY_OWNERSHIP_CONFLICT',
      canonicalPlayerId,
      scopeId: leagueId,
      aliasIds: [...new Set(rows.map((row) => row.playerId))],
      message: `League ${leagueId} has conflicting normalized or legacy owners for ${canonicalPlayerId}.`,
    });
  }

  for (const [key, rows] of groupBy(
    lineupPlayers,
    (row) => `${row.lineupId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2 || !rows.some((row) => aliasIds.has(row.playerId))) continue;
    const [lineupId, canonicalPlayerId] = key.split('\u0000');
    blockers.push({
      code: 'LINEUP_COLLISION',
      canonicalPlayerId,
      scopeId: lineupId,
      aliasIds: rows.map((row) => row.playerId),
      message: `Lineup ${lineupId} contains multiple aliases of ${canonicalPlayerId}.`,
    });
  }

  for (const [key, rows] of groupBy(
    tradePlayers,
    (row) => `${row.offerId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2 || !rows.some((row) => aliasIds.has(row.playerId))) continue;
    const [offerId, canonicalPlayerId] = key.split('\u0000');
    blockers.push({
      code: 'TRADE_COLLISION',
      canonicalPlayerId,
      scopeId: offerId,
      aliasIds: rows.map((row) => row.playerId),
      message: `Trade offer ${offerId} contains multiple aliases of ${canonicalPlayerId}.`,
    });
  }

  for (const roster of legacyRosters) {
    if (
      ![roster.captainId, roster.viceCaptainId].some(
        (playerId) => playerId && aliasIds.has(playerId)
      )
    ) {
      continue;
    }
    const captainId = roster.captainId ? projectedPlayerId(roster.captainId, aliasMap) : null;
    const viceCaptainId = roster.viceCaptainId
      ? projectedPlayerId(roster.viceCaptainId, aliasMap)
      : null;
    if (captainId && captainId === viceCaptainId) {
      blockers.push({
        code: 'CAPTAIN_COLLISION',
        canonicalPlayerId: captainId,
        scopeId: roster.id,
        aliasIds: [roster.captainId!, roster.viceCaptainId!],
        message: `Roster ${roster.id} would assign ${captainId} as both captain and vice-captain.`,
      });
    }
  }

  for (const autosub of autosubs) {
    const referencedAliasIds = [autosub.outgoingPlayerId, autosub.replacementPlayerId].filter(
      (playerId) => aliasIds.has(playerId)
    );
    if (referencedAliasIds.length === 0) continue;

    const outgoing = projectedPlayerId(autosub.outgoingPlayerId, aliasMap);
    const replacement = projectedPlayerId(autosub.replacementPlayerId, aliasMap);
    if (outgoing === replacement) {
      blockers.push({
        code: 'AUTOSUB_COLLISION',
        canonicalPlayerId: outgoing,
        scopeId: autosub.id,
        aliasIds: [autosub.outgoingPlayerId, autosub.replacementPlayerId],
        message: `Autosub ${autosub.id} would replace a player with the same canonical player.`,
      });
      continue;
    }

    blockers.push({
      code: 'AUTOSUB_REFERENCE',
      canonicalPlayerId:
        aliasMap.get(autosub.outgoingPlayerId) ?? aliasMap.get(autosub.replacementPlayerId) ?? '',
      scopeId: autosub.id,
      aliasIds: referencedAliasIds,
      message: `Historical autosub ${autosub.id} references a player alias and must remain immutable.`,
    });
  }

  for (const action of teamActions) {
    if (action.status !== 'PENDING' || !containsAnyAlias(action.details, aliasIds)) continue;
    blockers.push({
      code: 'PENDING_ACTION_REFERENCE',
      canonicalPlayerId: '',
      scopeId: action.id,
      aliasIds: [...aliasIds].filter((aliasId) => action.details.includes(aliasId)),
      message: `Pending team action ${action.id} in league ${action.leagueId} must be resolved before consolidation.`,
    });
  }

  const jsonDocuments = [
    ...lobbyActivities.map((row) => row.details),
    ...draftEvents.map((row) => row.payload),
    ...competitionAudits.map((row) => row.payloadJson),
    ...teamActions.map((row) => row.details),
    ...tradeEvents.map((row) => row.payloadJson),
    ...tradeCommands.map((row) => row.responseJson),
    ...tradeOutboxEvents.map((row) => row.payloadJson),
  ].filter((value) => containsAnyAlias(value, aliasIds)).length;

  return {
    status: blockers.length > 0 ? 'blocked' : 'ready',
    mappings,
    blockers,
    references: {
      picks: picks.filter((row) => aliasIds.has(row.playerId)).length,
      watchlists: watchlists.filter((row) => aliasIds.has(row.playerId)).length,
      preDraftQueues: preDraftQueues.filter((row) => aliasIds.has(row.playerId)).length,
      queueItems: queueItems.filter((row) => aliasIds.has(row.playerId)).length,
      rosterPlayers: rosterPlayers.filter((row) => aliasIds.has(row.playerId)).length,
      legacyRosters: legacyRosters.filter((row) =>
        [row.playerIds, row.captainId, row.viceCaptainId, row.benchOrder].some((value) =>
          containsAnyAlias(value, aliasIds)
        )
      ).length,
      lineupPlayers: lineupPlayers.filter((row) => aliasIds.has(row.playerId)).length,
      autosubs: autosubs.filter(
        (row) => aliasIds.has(row.outgoingPlayerId) || aliasIds.has(row.replacementPlayerId)
      ).length,
      tradePlayers: tradePlayers.filter((row) => aliasIds.has(row.playerId)).length,
      jsonDocuments,
    },
    safeSameMemberRosterMerges,
  };
}
