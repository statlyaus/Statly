import type { PlayerAliasSource, Prisma, PrismaClient } from '@prisma/client';

import { buildPlayerAliasCreateInput } from '@/server/playerIdentityResolver';
import {
  validateReviewedSeasonRoster,
  type NormalizedReviewedSeasonRosterEntry,
  type ReviewedSeasonRosterAlias,
  type ReviewedSeasonRosterEntry,
} from './playerDirectorySeasonRoster';
import {
  normalizeLookupPart,
  normalizeTeamLookup,
} from '../../shared/player-identity/playerMatchStats';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type ExistingPlayer = {
  id: string;
  name: string;
  club: string;
  position: string;
  active: boolean;
};

type ExistingRegistration = {
  playerId: string;
  season: number;
  club: string;
  normalizedClub: string;
  position: string;
  listStatus: string;
  active: boolean;
};

type ExistingAlias = {
  playerId: string;
  normalizedAliasName: string;
  normalizedClub: string | null;
  scopeKey: string;
  seasonFrom: number | null;
  seasonTo: number | null;
};

export type SeasonRosterPlayerWrite = {
  id: string;
  name: string;
  club: string;
  position: string;
  active: boolean;
};

export type SeasonRosterRegistrationWrite = {
  playerId: string;
  season: number;
  club: string;
  normalizedClub: string;
  position: string;
  listStatus: string;
  active: boolean;
  source: PlayerAliasSource;
  approvedBy: string;
  notes: string;
};

export type SeasonRosterAliasWrite = {
  playerId: string;
  aliasName: string;
  normalizedAliasName: string;
  club: string | null;
  normalizedClub: string | null;
  scopeKey: string;
  seasonFrom: number | null;
  seasonTo: number | null;
  source: PlayerAliasSource;
  confidence: number;
  approvedBy: string;
  notes: string;
};

export type SeasonRosterSyncPlan = {
  valid: boolean;
  errors: string[];
  season: number;
  playersToCreate: SeasonRosterPlayerWrite[];
  playersToUpdate: SeasonRosterPlayerWrite[];
  registrationsToCreate: SeasonRosterRegistrationWrite[];
  registrationsToUpdate: SeasonRosterRegistrationWrite[];
  aliasesToCreate: SeasonRosterAliasWrite[];
  existingPlayerIds: string[];
};

export type SeasonRosterSyncApplyResult = SeasonRosterSyncPlan & {
  applied: boolean;
};

function emptyPlan(season: number, errors: string[] = []): SeasonRosterSyncPlan {
  return {
    valid: errors.length === 0,
    errors,
    season,
    playersToCreate: [],
    playersToUpdate: [],
    registrationsToCreate: [],
    registrationsToUpdate: [],
    aliasesToCreate: [],
    existingPlayerIds: [],
  };
}

function registrationKey(input: {
  playerId: string;
  season: number;
  club?: string | null;
  normalizedClub?: string | null;
}): string {
  return [
    input.playerId,
    input.season,
    input.normalizedClub ?? normalizeTeamLookup(input.club),
  ].join('|');
}

function aliasScopeKey(input: {
  seasonFrom: number | null;
  seasonTo: number | null;
  club: string | null;
}) {
  const normalizedClub = normalizeTeamLookup(input.club);
  return `${input.seasonFrom ?? 'all'}:${input.seasonTo ?? 'all'}:${normalizedClub || 'global'}`;
}

function aliasKey(input: { normalizedAliasName: string; scopeKey: string }): string {
  return `${input.normalizedAliasName}|${input.scopeKey}`;
}

function aliasLabel(alias: SeasonRosterAliasWrite): string {
  return `${alias.normalizedAliasName} in scope ${alias.scopeKey}`;
}

function isPrismaDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function playerWrite(entry: NormalizedReviewedSeasonRosterEntry): SeasonRosterPlayerWrite {
  return {
    id: entry.playerId,
    name: entry.playerName,
    club: entry.club,
    position: entry.position,
    active: entry.active,
  };
}

function registrationWrite(
  entry: NormalizedReviewedSeasonRosterEntry
): SeasonRosterRegistrationWrite {
  return {
    playerId: entry.playerId,
    season: entry.season,
    club: entry.club,
    normalizedClub: entry.normalizedClub,
    position: entry.position,
    listStatus: entry.listStatus,
    active: entry.active,
    source: 'MANUAL',
    approvedBy: entry.reviewedBy,
    notes: entry.notes,
  };
}

function aliasWrite(
  entry: NormalizedReviewedSeasonRosterEntry,
  alias: ReviewedSeasonRosterAlias
): SeasonRosterAliasWrite {
  const createInput = buildPlayerAliasCreateInput({
    playerId: entry.playerId,
    aliasName: normalizeDisplayText(alias.aliasName),
    club: alias.club ?? entry.club,
    seasonFrom: alias.seasonFrom ?? entry.season,
    seasonTo: alias.seasonTo ?? entry.season,
    source: 'MANUAL',
    confidence: alias.confidence,
    approvedBy: entry.reviewedBy,
    notes: alias.notes,
  });

  return {
    playerId: createInput.playerId,
    aliasName: createInput.aliasName,
    normalizedAliasName: createInput.normalizedAliasName,
    club: createInput.club ?? null,
    normalizedClub: createInput.normalizedClub ?? null,
    scopeKey:
      createInput.scopeKey ??
      aliasScopeKey({
        seasonFrom: createInput.seasonFrom ?? null,
        seasonTo: createInput.seasonTo ?? null,
        club: createInput.club ?? null,
      }),
    seasonFrom: createInput.seasonFrom ?? null,
    seasonTo: createInput.seasonTo ?? null,
    source: createInput.source ?? 'MANUAL',
    confidence: createInput.confidence ?? 1,
    approvedBy: createInput.approvedBy ?? entry.reviewedBy,
    notes: createInput.notes ?? alias.notes,
  };
}

function playerNeedsUpdate(existing: ExistingPlayer, next: SeasonRosterPlayerWrite): boolean {
  return (
    existing.name !== next.name ||
    existing.club !== next.club ||
    existing.position !== next.position ||
    existing.active !== next.active
  );
}

function playerNameClubKey(input: { name: string; club: string }): string {
  return [
    normalizeLookupPart(normalizeDisplayText(input.name)),
    normalizeTeamLookup(input.club),
  ].join('|');
}

function registrationNeedsUpdate(
  existing: ExistingRegistration,
  next: SeasonRosterRegistrationWrite
): boolean {
  return (
    existing.club !== next.club ||
    existing.normalizedClub !== next.normalizedClub ||
    existing.position !== next.position ||
    existing.listStatus !== next.listStatus ||
    existing.active !== next.active
  );
}

function buildCandidateAliases(
  entries: NormalizedReviewedSeasonRosterEntry[]
): SeasonRosterAliasWrite[] {
  return entries.flatMap((entry) =>
    entry.aliases
      .map((alias) => aliasWrite(entry, alias))
      .filter((alias) => alias.normalizedAliasName)
  );
}

export async function buildSeasonRosterSyncPlan(
  prisma: PrismaLike,
  params: { season: number; entries: ReviewedSeasonRosterEntry[] }
): Promise<SeasonRosterSyncPlan> {
  const validation = validateReviewedSeasonRoster(params);
  if (!validation.valid) return emptyPlan(params.season, validation.errors);

  const playerIds = validation.normalizedEntries.map((entry) => entry.playerId).sort();
  const candidateAliases = buildCandidateAliases(validation.normalizedEntries);
  const candidateAliasKeys = [
    ...new Map(candidateAliases.map((alias) => [aliasKey(alias), alias])).values(),
  ];
  const [players, possibleDuplicatePlayers, registrations, aliases] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, name: true, club: true, position: true, active: true },
    }),
    prisma.player.findMany({
      select: { id: true, name: true, club: true, position: true, active: true },
    }),
    prisma.playerSeasonRegistration.findMany({
      where: { season: params.season, playerId: { in: playerIds } },
      select: {
        playerId: true,
        season: true,
        club: true,
        normalizedClub: true,
        position: true,
        listStatus: true,
        active: true,
      },
    }),
    prisma.playerAlias.findMany({
      where:
        candidateAliasKeys.length > 0
          ? {
              OR: candidateAliasKeys.map((alias) => ({
                normalizedAliasName: alias.normalizedAliasName,
                scopeKey: alias.scopeKey,
              })),
            }
          : { playerId: { in: [] } },
      select: {
        playerId: true,
        normalizedAliasName: true,
        normalizedClub: true,
        scopeKey: true,
        seasonFrom: true,
        seasonTo: true,
      },
    }),
  ]);

  const playersById = new Map((players as ExistingPlayer[]).map((player) => [player.id, player]));
  const duplicatePlayersByNameClub = new Map(
    (possibleDuplicatePlayers as ExistingPlayer[]).map((player) => [
      playerNameClubKey(player),
      player,
    ])
  );
  const registrationsByKey = new Map(
    (registrations as ExistingRegistration[]).map((registration) => [
      registrationKey(registration),
      registration,
    ])
  );
  const existingAliasKeys = new Set(
    (aliases as ExistingAlias[]).map((alias) =>
      aliasKey({
        normalizedAliasName: alias.normalizedAliasName,
        scopeKey:
          alias.scopeKey ||
          aliasScopeKey({
            seasonFrom: alias.seasonFrom,
            seasonTo: alias.seasonTo,
            club: alias.normalizedClub,
          }),
      })
    )
  );
  const existingAliasesByKey = new Map(
    (aliases as ExistingAlias[]).map((alias) => [
      aliasKey({
        normalizedAliasName: alias.normalizedAliasName,
        scopeKey:
          alias.scopeKey ||
          aliasScopeKey({
            seasonFrom: alias.seasonFrom,
            seasonTo: alias.seasonTo,
            club: alias.normalizedClub,
          }),
      }),
      alias,
    ])
  );
  const candidateAliasesByKey = new Map<string, SeasonRosterAliasWrite[]>();
  for (const alias of candidateAliases) {
    const key = aliasKey(alias);
    candidateAliasesByKey.set(key, [...(candidateAliasesByKey.get(key) ?? []), alias]);
  }
  const aliasConflictErrors: string[] = [];
  for (const [key, aliasesForKey] of candidateAliasesByKey) {
    const reviewedPlayerIds = [...new Set(aliasesForKey.map((alias) => alias.playerId))].sort();
    const firstAlias = aliasesForKey[0];
    if (!firstAlias) continue;

    if (reviewedPlayerIds.length > 1) {
      aliasConflictErrors.push(
        `Alias ${firstAlias.aliasName} in scope ${firstAlias.scopeKey} is assigned to multiple reviewed players: ${reviewedPlayerIds.join(', ')}`
      );
      continue;
    }

    const existingAlias = existingAliasesByKey.get(key);
    if (existingAlias && existingAlias.playerId !== firstAlias.playerId) {
      aliasConflictErrors.push(
        `Alias ${firstAlias.aliasName} for ${firstAlias.playerId} conflicts with existing alias ${aliasLabel(firstAlias)} owned by ${existingAlias.playerId}`
      );
    }
  }
  const plannedAliasKeys = new Set<string>();
  const duplicatePlayerErrors: string[] = [];
  const plan = emptyPlan(params.season, aliasConflictErrors);

  for (const entry of validation.normalizedEntries) {
    const nextPlayer = playerWrite(entry);
    const existingPlayer = playersById.get(entry.playerId);
    if (!existingPlayer) {
      const duplicatePlayer = duplicatePlayersByNameClub.get(playerNameClubKey(nextPlayer));
      if (duplicatePlayer && duplicatePlayer.id !== entry.playerId) {
        duplicatePlayerErrors.push(
          `Player ${entry.playerId} (${entry.playerName}, ${entry.club}) conflicts with existing Prisma player ${duplicatePlayer.id}`
        );
        continue;
      }
      plan.playersToCreate.push(nextPlayer);
    } else {
      plan.existingPlayerIds.push(entry.playerId);
      if (playerNeedsUpdate(existingPlayer, nextPlayer)) plan.playersToUpdate.push(nextPlayer);
    }

    const nextRegistration = registrationWrite(entry);
    const existingRegistration = registrationsByKey.get(registrationKey(nextRegistration));
    if (!existingRegistration) {
      plan.registrationsToCreate.push(nextRegistration);
    } else if (registrationNeedsUpdate(existingRegistration, nextRegistration)) {
      plan.registrationsToUpdate.push(nextRegistration);
    }

    for (const nextAlias of candidateAliases.filter((alias) => alias.playerId === entry.playerId)) {
      const key = aliasKey(nextAlias);
      if (aliasConflictErrors.length > 0) continue;
      if (existingAliasKeys.has(key) || plannedAliasKeys.has(key)) continue;
      plannedAliasKeys.add(key);
      plan.aliasesToCreate.push(nextAlias);
    }
  }

  plan.errors.push(...duplicatePlayerErrors);
  plan.valid = plan.errors.length === 0;

  plan.existingPlayerIds.sort();
  plan.playersToCreate.sort((a, b) => a.id.localeCompare(b.id));
  plan.playersToUpdate.sort((a, b) => a.id.localeCompare(b.id));
  plan.registrationsToCreate.sort((a, b) => registrationKey(a).localeCompare(registrationKey(b)));
  plan.registrationsToUpdate.sort((a, b) => registrationKey(a).localeCompare(registrationKey(b)));
  plan.aliasesToCreate.sort((a, b) => aliasKey(a).localeCompare(aliasKey(b)));

  return plan;
}

export async function applySeasonRosterSyncPlan(
  prisma: PrismaClient,
  plan: SeasonRosterSyncPlan
): Promise<SeasonRosterSyncApplyResult> {
  if (!plan.valid) return { ...plan, applied: false };

  await prisma.$transaction(async (tx) => {
    for (const player of plan.playersToCreate) {
      await tx.player.upsert({
        where: { id: player.id },
        create: player,
        update: {
          name: player.name,
          club: player.club,
          position: player.position,
          active: player.active,
        },
      });
    }

    for (const player of plan.playersToUpdate) {
      await tx.player.upsert({
        where: { id: player.id },
        create: player,
        update: {
          name: player.name,
          club: player.club,
          position: player.position,
          active: player.active,
        },
      });
    }

    for (const registration of plan.registrationsToCreate) {
      await tx.playerSeasonRegistration.upsert({
        where: {
          playerId_season_normalizedClub: {
            playerId: registration.playerId,
            season: registration.season,
            normalizedClub: registration.normalizedClub,
          },
        },
        create: registration,
        update: {
          club: registration.club,
          position: registration.position,
          listStatus: registration.listStatus,
          active: registration.active,
          source: registration.source,
          approvedBy: registration.approvedBy,
          notes: registration.notes,
        },
      });
    }

    for (const registration of plan.registrationsToUpdate) {
      await tx.playerSeasonRegistration.upsert({
        where: {
          playerId_season_normalizedClub: {
            playerId: registration.playerId,
            season: registration.season,
            normalizedClub: registration.normalizedClub,
          },
        },
        create: registration,
        update: {
          club: registration.club,
          position: registration.position,
          listStatus: registration.listStatus,
          active: registration.active,
          source: registration.source,
          approvedBy: registration.approvedBy,
          notes: registration.notes,
        },
      });
    }

    for (const alias of plan.aliasesToCreate) {
      const existingAlias = await tx.playerAlias.findFirst({
        where: {
          normalizedAliasName: alias.normalizedAliasName,
          scopeKey: alias.scopeKey,
        },
        select: {
          playerId: true,
        },
      });
      if (existingAlias) {
        if (existingAlias.playerId !== alias.playerId) {
          throw new Error(
            `Alias ${alias.aliasName} for ${alias.playerId} conflicts with existing alias ${aliasLabel(alias)} owned by ${existingAlias.playerId}`
          );
        }
        continue;
      }
      try {
        await tx.playerAlias.create({
          data: buildPlayerAliasCreateInput(alias),
        });
      } catch (error) {
        if (!isPrismaDuplicateKeyError(error)) throw error;

        const aliasAfterDuplicate = await tx.playerAlias.findFirst({
          where: {
            normalizedAliasName: alias.normalizedAliasName,
            scopeKey: alias.scopeKey,
          },
          select: {
            playerId: true,
          },
        });
        if (aliasAfterDuplicate?.playerId === alias.playerId) continue;
        if (aliasAfterDuplicate) {
          throw new Error(
            `Alias ${alias.aliasName} for ${alias.playerId} conflicts with existing alias ${aliasLabel(alias)} owned by ${aliasAfterDuplicate.playerId}`
          );
        }
        throw error;
      }
    }
  });

  return { ...plan, applied: true };
}
