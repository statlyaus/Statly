import type { Player, Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export const STATLY_LEGACY_PLAYER_PROVIDER = 'statly-legacy';
export const PLAYER_STATS_2025_PROVIDER = 'player-stats-2025';

type PlayerIdentityReadClient = Pick<Prisma.TransactionClient, 'player'> &
  Partial<Pick<Prisma.TransactionClient, 'playerExternalIdentity'>>;
type PlayerIdentityWriteClient = Pick<
  Prisma.TransactionClient,
  'player' | 'playerExternalIdentity'
> & {
  $transaction?: PrismaClient['$transaction'];
};

export type CanonicalPlayerInput = {
  provider: string;
  externalId: string;
  name: string;
  club: string;
  position: string;
  active?: boolean;
  canonicalPlayerId?: string;
  allowExactAttributeMatch?: boolean;
};

export class AmbiguousPlayerIdentityError extends Error {
  constructor(
    readonly nameValue: string,
    readonly clubValue: string,
    readonly candidateIds: string[]
  ) {
    super(
      `Player identity is ambiguous for ${nameValue} (${clubValue}): ${candidateIds.join(', ')}`
    );
    this.name = 'AmbiguousPlayerIdentityError';
  }
}

function requiredIdentityPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required to resolve a player identity`);
  }
  return normalized;
}

function mutablePlayerData(input: CanonicalPlayerInput) {
  return {
    name: input.name.trim(),
    club: input.club.trim(),
    position: input.position.trim(),
    active: input.active ?? true,
  };
}

export async function resolveCanonicalPlayerId(
  externalId: string,
  provider = STATLY_LEGACY_PLAYER_PROVIDER,
  client: PlayerIdentityReadClient = prisma
): Promise<string | null> {
  const normalizedExternalId = externalId.trim();
  if (!normalizedExternalId) return null;

  const normalizedProvider = requiredIdentityPart(provider, 'Player identity provider');
  const identity = client.playerExternalIdentity
    ? await client.playerExternalIdentity.findUnique({
        where: {
          provider_externalId: {
            provider: normalizedProvider,
            externalId: normalizedExternalId,
          },
        },
        select: { playerId: true },
      })
    : null;

  if (identity) {
    return identity.playerId;
  }

  if (typeof client.player?.findUnique !== 'function') {
    return normalizedExternalId;
  }

  const directPlayer = await client.player.findUnique({
    where: { id: normalizedExternalId },
    select: { id: true },
  });

  return directPlayer?.id ?? null;
}

export async function resolveCanonicalPlayerIds(
  externalIds: readonly string[],
  provider = STATLY_LEGACY_PLAYER_PROVIDER,
  client: PlayerIdentityReadClient = prisma
): Promise<Map<string, string>> {
  const uniqueExternalIds = [
    ...new Set(externalIds.map((playerId) => playerId.trim()).filter(Boolean)),
  ];
  if (uniqueExternalIds.length === 0) return new Map();

  const resolved = new Map<string, string>();
  if (client.playerExternalIdentity) {
    const identities = await client.playerExternalIdentity.findMany({
      where: { provider, externalId: { in: uniqueExternalIds } },
      select: { externalId: true, playerId: true },
    });
    for (const identity of identities) resolved.set(identity.externalId, identity.playerId);
  }

  const unresolvedIds = uniqueExternalIds.filter((playerId) => !resolved.has(playerId));
  if (unresolvedIds.length === 0) return resolved;
  if (typeof client.player?.findMany !== 'function') {
    for (const playerId of unresolvedIds) resolved.set(playerId, playerId);
    return resolved;
  }

  const directPlayers = await client.player.findMany({
    where: { id: { in: unresolvedIds } },
    select: { id: true },
  });
  for (const player of directPlayers) resolved.set(player.id, player.id);
  return resolved;
}

async function upsertCanonicalPlayerWithClient(
  client: PlayerIdentityWriteClient,
  input: CanonicalPlayerInput
): Promise<Player> {
  const provider = requiredIdentityPart(input.provider, 'Player identity provider');
  const externalId = requiredIdentityPart(input.externalId, 'External player ID');
  const playerData = mutablePlayerData(input);

  const existingIdentity = await client.playerExternalIdentity.findUnique({
    where: { provider_externalId: { provider, externalId } },
    select: { playerId: true },
  });

  if (existingIdentity) {
    return client.player.update({
      where: { id: existingIdentity.playerId },
      data: playerData,
    });
  }

  let canonicalPlayer: Player | null = null;

  if (input.canonicalPlayerId) {
    canonicalPlayer = await client.player.findUnique({
      where: { id: input.canonicalPlayerId },
    });

    if (!canonicalPlayer) {
      throw new Error(`Canonical player ${input.canonicalPlayerId} does not exist`);
    }
  } else if (input.allowExactAttributeMatch) {
    const candidates = await client.player.findMany({
      where: { name: playerData.name, club: playerData.club },
      orderBy: { id: 'asc' },
      take: 2,
    });

    if (candidates.length > 1) {
      throw new AmbiguousPlayerIdentityError(
        playerData.name,
        playerData.club,
        candidates.map((candidate) => candidate.id)
      );
    }

    canonicalPlayer = candidates[0] ?? null;
    if (!canonicalPlayer) {
      const sameNameCandidates = await client.player.findMany({
        where: { name: playerData.name },
        orderBy: { id: 'asc' },
        take: 2,
      });
      if (sameNameCandidates.length > 0) {
        throw new AmbiguousPlayerIdentityError(
          playerData.name,
          playerData.club,
          sameNameCandidates.map((candidate) => candidate.id)
        );
      }
    }
  }

  if (canonicalPlayer) {
    canonicalPlayer = await client.player.update({
      where: { id: canonicalPlayer.id },
      data: playerData,
    });
  } else {
    canonicalPlayer = await client.player.create({ data: playerData });
  }

  await client.playerExternalIdentity.create({
    data: {
      playerId: canonicalPlayer.id,
      provider,
      externalId,
      verifiedAt: new Date(),
    },
  });

  return canonicalPlayer;
}

export async function upsertCanonicalPlayer(
  client: PlayerIdentityWriteClient,
  input: CanonicalPlayerInput
): Promise<Player> {
  if (typeof client.$transaction === 'function') {
    return client.$transaction((tx: Prisma.TransactionClient) =>
      upsertCanonicalPlayerWithClient(tx, input)
    );
  }

  return upsertCanonicalPlayerWithClient(client, input);
}

export async function upsertCanonicalPlayerInTransaction(
  input: CanonicalPlayerInput
): Promise<Player> {
  return upsertCanonicalPlayer(prisma, input);
}
