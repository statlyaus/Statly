import type { Prisma } from '@prisma/client';

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
  | 'LINEUP_COLLISION'
  | 'TRADE_COLLISION'
  | 'CAPTAIN_COLLISION'
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
  if (!value) return false;
  return [...aliasIds].some((aliasId) => value.includes(aliasId));
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
    client.leagueRoster.findMany(),
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
    client.lobbyActivity.findMany({ where: { details: { not: null } }, select: { details: true } }),
    client.draftEvent.findMany({ where: { payload: { not: null } }, select: { payload: true } }),
    client.leagueCompetitionAudit.findMany({ select: { payloadJson: true } }),
    client.teamAction.findMany({ select: { details: true } }),
    client.leagueTradeEvent.findMany({
      where: { payloadJson: { not: null } },
      select: { payloadJson: true },
    }),
    client.leagueTradeCommand.findMany({
      where: { responseJson: { not: null } },
      select: { responseJson: true },
    }),
    client.leagueTradeOutboxEvent.findMany({ select: { payloadJson: true } }),
  ]);

  for (const [key, rows] of groupBy(
    picks,
    (row) => `${row.draftId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2) continue;
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
    if (rows.length < 2) continue;
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

  for (const [key, rows] of groupBy(
    lineupPlayers,
    (row) => `${row.lineupId}\u0000${projectedPlayerId(row.playerId, aliasMap)}`
  )) {
    if (rows.length < 2) continue;
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
    if (rows.length < 2) continue;
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
    }
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
