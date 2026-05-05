import type {
  PlayerAliasSource,
  Prisma,
  PrismaClient,
  UnresolvedPlayerStatStatus,
} from '@prisma/client';

import {
  buildNameVariants,
  normalizeLookupPart,
  normalizeTeamLookup,
  readCanonicalPlayerId,
} from './playerMatchStats';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type PlayerIdentityInput = {
  playerName: string;
  team?: string | null;
  season?: number | null;
  source?: string | null;
  sourceDocumentId?: string | null;
  sourceMatchId?: string | null;
  round?: number | null;
  rawPayload?: Record<string, unknown> | null;
};

type ResolvedPlayerIdentity = {
  outcome: 'resolved';
  playerId: string;
  playerName: string;
  matchedBy: 'canonical_id' | 'player' | 'alias';
  candidates: string[];
};

type AmbiguousPlayerIdentity = {
  outcome: 'ambiguous';
  candidates: string[];
  diagnostics: {
    playerName: string;
    normalizedPlayerNames: string[];
    normalizedTeam: string;
  };
};

type UnresolvedPlayerIdentity = {
  outcome: 'unresolved';
  candidates: string[];
  diagnostics: {
    playerName: string;
    normalizedPlayerNames: string[];
    normalizedTeam: string;
  };
};

export type PlayerIdentityResolution =
  | ResolvedPlayerIdentity
  | AmbiguousPlayerIdentity
  | UnresolvedPlayerIdentity;

type CanonicalPlayerRecord = {
  id: string;
  name: string;
  club: string;
  position: string;
};

type PlayerAliasRecord = {
  playerId: string;
  normalizedAliasName: string;
  normalizedClub: string | null;
  scopeKey?: string | null;
  seasonFrom: number | null;
  seasonTo: number | null;
};

type PlayerSeasonRegistrationRecord = {
  playerId: string;
  season: number;
  club: string;
  normalizedClub: string;
  position: string;
  player: CanonicalPlayerRecord;
};

export type PlayerIdentityDirectory = {
  playersById: Map<string, CanonicalPlayerRecord>;
  canonicalByKey: Map<string, Set<string>>;
  aliasByKey: Map<string, Set<string>>;
};

function serializeKey(normalizedName: string, normalizedTeam: string): string {
  return `${normalizedName}|${normalizedTeam}`;
}

function addCandidate(map: Map<string, Set<string>>, key: string, playerId: string) {
  const existing = map.get(key);
  if (existing) {
    existing.add(playerId);
    return;
  }
  map.set(key, new Set([playerId]));
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isAliasInSeason(alias: PlayerAliasRecord, season?: number | null): boolean {
  if (season == null) return true;
  if (alias.seasonFrom != null && season < alias.seasonFrom) return false;
  if (alias.seasonTo != null && season > alias.seasonTo) return false;
  return true;
}

export async function loadPlayerIdentityDirectory(
  prisma: PrismaLike,
  season?: number | null
): Promise<PlayerIdentityDirectory> {
  const [players, aliases, registrations] = await Promise.all([
    prisma.player.findMany({
      select: {
        id: true,
        name: true,
        club: true,
        position: true,
      },
    }),
    prisma.playerAlias.findMany({
      select: {
        playerId: true,
        normalizedAliasName: true,
        normalizedClub: true,
        scopeKey: true,
        seasonFrom: true,
        seasonTo: true,
      },
    }),
    season == null
      ? Promise.resolve([] as PlayerSeasonRegistrationRecord[])
      : prisma.playerSeasonRegistration.findMany({
          where: {
            season,
            active: true,
          },
          select: {
            playerId: true,
            season: true,
            club: true,
            normalizedClub: true,
            position: true,
            player: {
              select: {
                id: true,
                name: true,
                club: true,
                position: true,
              },
            },
          },
        }),
  ]);

  const playersById = new Map<string, CanonicalPlayerRecord>();
  const canonicalByKey = new Map<string, Set<string>>();
  const aliasByKey = new Map<string, Set<string>>();

  players.forEach((player) => {
    playersById.set(player.id, player);
    const normalizedTeam = normalizeTeamLookup(player.club);
    for (const normalizedName of buildNameVariants(player.name)) {
      addCandidate(canonicalByKey, serializeKey(normalizedName, normalizedTeam), player.id);
      addCandidate(canonicalByKey, serializeKey(normalizedName, ''), player.id);
    }
  });

  registrations.forEach((registration) => {
    playersById.set(registration.player.id, registration.player);
    const normalizedTeam = registration.normalizedClub || normalizeTeamLookup(registration.club);
    for (const normalizedName of buildNameVariants(registration.player.name)) {
      addCandidate(canonicalByKey, serializeKey(normalizedName, normalizedTeam), registration.playerId);
    }
  });

  aliases.forEach((alias: PlayerAliasRecord) => {
    if (!isAliasInSeason(alias, season)) return;
    const normalizedTeam = alias.normalizedClub ?? '';
    addCandidate(
      aliasByKey,
      serializeKey(alias.normalizedAliasName, normalizedTeam),
      alias.playerId
    );
    addCandidate(aliasByKey, serializeKey(alias.normalizedAliasName, ''), alias.playerId);
  });

  return {
    playersById,
    canonicalByKey,
    aliasByKey,
  };
}

function resolveByKey(
  directory: PlayerIdentityDirectory,
  normalizedNames: string[],
  normalizedTeam: string
): { matchedBy: 'player' | 'alias'; candidates: string[] } | null {
  const candidateIds = new Set<string>();
  let matchedBy: 'player' | 'alias' | null = null;

  for (const normalizedName of normalizedNames) {
    const exactCanonical = directory.canonicalByKey.get(
      serializeKey(normalizedName, normalizedTeam)
    );
    if (exactCanonical?.size) {
      exactCanonical.forEach((candidate) => candidateIds.add(candidate));
      matchedBy = 'player';
      continue;
    }

    const exactAlias = directory.aliasByKey.get(serializeKey(normalizedName, normalizedTeam));
    if (exactAlias?.size) {
      exactAlias.forEach((candidate) => candidateIds.add(candidate));
      matchedBy = 'alias';
      continue;
    }

    const fallbackCanonical = directory.canonicalByKey.get(serializeKey(normalizedName, ''));
    if (fallbackCanonical?.size) {
      fallbackCanonical.forEach((candidate) => candidateIds.add(candidate));
      matchedBy = matchedBy ?? 'player';
    }

    const fallbackAlias = directory.aliasByKey.get(serializeKey(normalizedName, ''));
    if (fallbackAlias?.size) {
      fallbackAlias.forEach((candidate) => candidateIds.add(candidate));
      matchedBy = matchedBy ?? 'alias';
    }
  }

  if (candidateIds.size === 0 || !matchedBy) {
    return null;
  }

  return {
    matchedBy,
    candidates: Array.from(candidateIds).sort(),
  };
}

export function resolvePlayerIdentityFromDirectory(
  directory: PlayerIdentityDirectory,
  input: PlayerIdentityInput
): PlayerIdentityResolution {
  const playerName = readString(input.playerName) ?? '';
  const normalizedTeam = normalizeTeamLookup(input.team);
  const normalizedPlayerNames = buildNameVariants(playerName);
  const canonicalId = input.rawPayload ? readCanonicalPlayerId(input.rawPayload) : null;

  if (canonicalId && directory.playersById.has(canonicalId)) {
    const player = directory.playersById.get(canonicalId)!;
    return {
      outcome: 'resolved',
      playerId: player.id,
      playerName: player.name,
      matchedBy: 'canonical_id',
      candidates: [player.id],
    };
  }

  const keyResolution = resolveByKey(directory, normalizedPlayerNames, normalizedTeam);
  if (keyResolution && keyResolution.candidates.length === 1) {
    const player = directory.playersById.get(keyResolution.candidates[0]);
    if (player) {
      return {
        outcome: 'resolved',
        playerId: player.id,
        playerName: player.name,
        matchedBy: keyResolution.matchedBy,
        candidates: keyResolution.candidates,
      };
    }
  }

  if (keyResolution && keyResolution.candidates.length > 1) {
    return {
      outcome: 'ambiguous',
      candidates: keyResolution.candidates,
      diagnostics: {
        playerName,
        normalizedPlayerNames,
        normalizedTeam,
      },
    };
  }

  return {
    outcome: 'unresolved',
    candidates: [],
    diagnostics: {
      playerName,
      normalizedPlayerNames,
      normalizedTeam,
    },
  };
}

export async function resolvePlayerIdentity(
  prisma: PrismaLike,
  input: PlayerIdentityInput
): Promise<PlayerIdentityResolution> {
  const directory = await loadPlayerIdentityDirectory(prisma, input.season);
  return resolvePlayerIdentityFromDirectory(directory, input);
}

export async function recordUnresolvedPlayerStatRow(
  prisma: PrismaLike,
  input: PlayerIdentityInput,
  resolution: AmbiguousPlayerIdentity | UnresolvedPlayerIdentity
): Promise<void> {
  const source = readString(input.source) ?? 'footywire_etl';
  const sourceDocumentId = readString(input.sourceDocumentId) ?? 'unknown';

  await prisma.unresolvedPlayerStatRow.upsert({
    where: {
      source_sourceDocumentId: {
        source,
        sourceDocumentId,
      },
    },
    update: {
      season: input.season ?? getDefaultSeasonForUnresolved(),
      round: input.round ?? null,
      playerName: input.playerName,
      normalizedPlayerName: normalizeLookupPart(input.playerName),
      team: input.team ?? null,
      normalizedTeam: normalizeTeamLookup(input.team),
      candidatePlayerIdsJson:
        resolution.candidates.length > 0 ? JSON.stringify(resolution.candidates) : null,
      rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
      status: (resolution.outcome === 'ambiguous'
        ? 'REVIEWED'
        : 'NEW') as UnresolvedPlayerStatStatus,
      sourceMatchId: input.sourceMatchId ?? null,
      resolutionNotes:
        resolution.outcome === 'ambiguous'
          ? 'Multiple candidate players matched during ingest-time resolution.'
          : 'No canonical player or alias matched during ingest-time resolution.',
      resolvedPlayerId: null,
      resolvedAt: null,
    },
    create: {
      source,
      sourceDocumentId,
      sourceMatchId: input.sourceMatchId ?? null,
      season: input.season ?? getDefaultSeasonForUnresolved(),
      round: input.round ?? null,
      playerName: input.playerName,
      normalizedPlayerName: normalizeLookupPart(input.playerName),
      team: input.team ?? null,
      normalizedTeam: normalizeTeamLookup(input.team),
      candidatePlayerIdsJson:
        resolution.candidates.length > 0 ? JSON.stringify(resolution.candidates) : null,
      rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
      status: (resolution.outcome === 'ambiguous'
        ? 'REVIEWED'
        : 'NEW') as UnresolvedPlayerStatStatus,
      resolutionNotes:
        resolution.outcome === 'ambiguous'
          ? 'Multiple candidate players matched during ingest-time resolution.'
          : 'No canonical player or alias matched during ingest-time resolution.',
    },
  });
}

function getDefaultSeasonForUnresolved(): number {
  return new Date().getFullYear();
}

export function buildPlayerAliasCreateInput(input: {
  playerId: string;
  aliasName: string;
  club?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
  source?: PlayerAliasSource;
  confidence?: number;
  approvedBy?: string | null;
  notes?: string | null;
}): Prisma.PlayerAliasUncheckedCreateInput {
  const normalizedClub = normalizeTeamLookup(input.club);
  return {
    playerId: input.playerId,
    aliasName: input.aliasName,
    normalizedAliasName: normalizeLookupPart(input.aliasName),
    club: input.club ?? null,
    normalizedClub,
    scopeKey: buildPlayerAliasScopeKey({
      normalizedClub,
      seasonFrom: input.seasonFrom,
      seasonTo: input.seasonTo,
    }),
    source: input.source ?? 'MANUAL',
    seasonFrom: input.seasonFrom ?? null,
    seasonTo: input.seasonTo ?? null,
    confidence: input.confidence ?? 1,
    approvedBy: input.approvedBy ?? null,
    notes: input.notes ?? null,
  };
}

export function buildPlayerAliasScopeKey(input: {
  club?: string | null;
  normalizedClub?: string | null;
  seasonFrom?: number | null;
  seasonTo?: number | null;
}): string {
  const normalizedClub = input.normalizedClub ?? normalizeTeamLookup(input.club);
  const clubPart = normalizedClub || 'global';
  return `${input.seasonFrom ?? 'all'}:${input.seasonTo ?? 'all'}:${clubPart}`;
}
