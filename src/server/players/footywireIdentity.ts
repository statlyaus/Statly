import type { Prisma, PrismaClient } from '@prisma/client';

import { normalizeClub, normalizePlayerName } from './footywirePositions';

/**
 * Footywire identity provider: links the ETL's Footywire player ids (`player_uid` in Firestore
 * `player_match_stats`, e.g. `ply_marcus_bontempelli`) to Statly `Player` rows through
 * `PlayerExternalIdentity` rows with provider `footywire`.
 *
 * Links are made only by a reviewed manifest (docs/runbooks/player-identity.md). A proposal offers
 * exact normalized name AND club matches as candidates and reports every other ETL player for
 * review. Applying never merges or edits `Player` rows and never moves an existing link: any
 * conflict blocks the whole manifest. Read paths only follow links whose review time is recorded.
 */

export const FOOTYWIRE_STATS_PROVIDER = 'footywire';

export type FootywireEtlPlayer = { externalId: string; name: string; club: string };
export type FootywireIdentityMapping = { externalId: string; playerId: string };

export type FootywireIdentityProposal = {
  schemaVersion: 1;
  provider: typeof FOOTYWIRE_STATS_PROVIDER;
  reviewed: false;
  reviewedBy: '';
  reviewedAt: '';
  warning: string;
  alreadyMapped: number;
  mappings: (FootywireIdentityMapping & { name: string; club: string })[];
  unmatched: (FootywireEtlPlayer & {
    reason: 'NO_CANDIDATE' | 'AMBIGUOUS';
    candidatePlayerIds: string[];
  })[];
};

export type ReviewedFootywireIdentityManifest = {
  schemaVersion: 1;
  provider: typeof FOOTYWIRE_STATS_PROVIDER;
  reviewed: true;
  reviewedBy: string;
  reviewedAt: string;
  mappings: FootywireIdentityMapping[];
};

export class FootywireIdentityBlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super(`Footywire identity manifest is blocked:\n- ${blockers.join('\n- ')}`);
    this.name = 'FootywireIdentityBlockedError';
  }
}

const identityKey = (name: string, club: string) =>
  `${normalizePlayerName(name)}|${normalizeClub(club)}`;

export function proposeFootywireIdentityManifest(input: {
  etlPlayers: readonly FootywireEtlPlayer[];
  players: readonly { id: string; name: string; club: string }[];
  existingIdentities: readonly FootywireIdentityMapping[];
}): FootywireIdentityProposal {
  const candidatesByKey = new Map<string, string[]>();
  for (const player of input.players) {
    const key = identityKey(player.name, player.club);
    candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), player.id]);
  }
  const mapped = new Set(input.existingIdentities.map((identity) => identity.externalId));
  const linkedPlayers = new Set(input.existingIdentities.map((identity) => identity.playerId));

  const etlPlayers = [
    ...new Map(input.etlPlayers.map((player) => [player.externalId, player])).values(),
  ].sort((a, b) => a.externalId.localeCompare(b.externalId));

  const proposal: FootywireIdentityProposal = {
    schemaVersion: 1,
    provider: FOOTYWIRE_STATS_PROVIDER,
    reviewed: false,
    reviewedBy: '',
    reviewedAt: '',
    warning:
      'Name and club are candidate evidence only. Check every mapping and every unmatched player; ' +
      'remove wrong mappings, add reviewed ones, then set reviewed, reviewedBy and reviewedAt.',
    alreadyMapped: 0,
    mappings: [],
    unmatched: [],
  };

  for (const etlPlayer of etlPlayers) {
    if (mapped.has(etlPlayer.externalId)) {
      proposal.alreadyMapped += 1;
      continue;
    }
    const candidates = [
      ...(candidatesByKey.get(identityKey(etlPlayer.name, etlPlayer.club)) ?? []),
    ].sort();
    if (candidates.length === 1 && !linkedPlayers.has(candidates[0])) {
      proposal.mappings.push({ ...etlPlayer, playerId: candidates[0] });
    } else {
      proposal.unmatched.push({
        ...etlPlayer,
        reason: candidates.length === 0 ? 'NO_CANDIDATE' : 'AMBIGUOUS',
        candidatePlayerIds: candidates,
      });
    }
  }
  return proposal;
}

export function validateReviewedFootywireIdentityManifest(
  value: unknown
): ReviewedFootywireIdentityManifest {
  const manifest = (value ?? {}) as Record<string, unknown>;
  if (manifest.schemaVersion !== 1) throw new Error('Manifest schemaVersion must be 1');
  if (manifest.provider !== FOOTYWIRE_STATS_PROVIDER) {
    throw new Error(`Manifest provider must be "${FOOTYWIRE_STATS_PROVIDER}"`);
  }
  if (manifest.reviewed !== true) throw new Error('Manifest must be reviewed before it is used');
  if (typeof manifest.reviewedBy !== 'string' || !manifest.reviewedBy.trim()) {
    throw new Error('Manifest reviewedBy is required');
  }
  if (
    typeof manifest.reviewedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(manifest.reviewedAt) ||
    !Number.isFinite(Date.parse(manifest.reviewedAt))
  ) {
    throw new Error('Manifest reviewedAt must be an ISO timestamp');
  }
  if (!Array.isArray(manifest.mappings)) throw new Error('Manifest mappings must be a list');

  const mappings = manifest.mappings.map((mapping, index) => {
    const { externalId, playerId } = (mapping ?? {}) as Record<string, unknown>;
    if (
      typeof externalId !== 'string' ||
      !externalId.trim() ||
      typeof playerId !== 'string' ||
      !playerId.trim()
    ) {
      throw new Error(`Manifest mapping ${index} needs an externalId and a playerId`);
    }
    return { externalId: externalId.trim(), playerId: playerId.trim() };
  });

  return {
    schemaVersion: 1,
    provider: FOOTYWIRE_STATS_PROVIDER,
    reviewed: true,
    reviewedBy: manifest.reviewedBy.trim(),
    reviewedAt: manifest.reviewedAt,
    mappings,
  };
}

export function planFootywireIdentityMappings(input: {
  mappings: readonly FootywireIdentityMapping[];
  existingIdentities: readonly FootywireIdentityMapping[];
  existingPlayerIds: ReadonlySet<string>;
}) {
  const playerByExternal = new Map(
    input.existingIdentities.map((identity) => [identity.externalId, identity.playerId])
  );
  const externalByPlayer = new Map(
    input.existingIdentities.map((identity) => [identity.playerId, identity.externalId])
  );
  const seen = new Set<string>();
  const create: FootywireIdentityMapping[] = [];
  const unchanged: FootywireIdentityMapping[] = [];
  const blockers: string[] = [];

  for (const mapping of input.mappings) {
    const { externalId, playerId } = mapping;
    if (seen.has(externalId)) {
      blockers.push(`${externalId} is mapped more than once in the manifest`);
      continue;
    }
    seen.add(externalId);

    const linkedPlayer = playerByExternal.get(externalId);
    if (linkedPlayer === playerId) {
      unchanged.push(mapping);
      continue;
    }
    if (linkedPlayer) {
      blockers.push(`${externalId} is already linked to ${linkedPlayer}, not ${playerId}`);
      continue;
    }
    if (!input.existingPlayerIds.has(playerId)) {
      blockers.push(`${externalId} names player ${playerId}, which does not exist`);
      continue;
    }
    const linkedExternal = externalByPlayer.get(playerId);
    if (linkedExternal) {
      blockers.push(
        `${playerId} already has Footywire id ${linkedExternal}; it cannot also take ${externalId}`
      );
      continue;
    }
    externalByPlayer.set(playerId, externalId);
    create.push(mapping);
  }

  return { create, unchanged, blockers };
}

type IdentityClient = Pick<Prisma.TransactionClient, 'player' | 'playerExternalIdentity'>;

async function planWithClient(client: IdentityClient, manifest: ReviewedFootywireIdentityManifest) {
  const externalIds = manifest.mappings.map((mapping) => mapping.externalId);
  const playerIds = manifest.mappings.map((mapping) => mapping.playerId);
  const [existingIdentities, players] = await Promise.all([
    client.playerExternalIdentity.findMany({
      where: {
        provider: FOOTYWIRE_STATS_PROVIDER,
        OR: [{ externalId: { in: externalIds } }, { playerId: { in: playerIds } }],
      },
      select: { externalId: true, playerId: true },
    }),
    client.player.findMany({ where: { id: { in: playerIds } }, select: { id: true } }),
  ]);
  return planFootywireIdentityMappings({
    mappings: manifest.mappings,
    existingIdentities,
    existingPlayerIds: new Set(players.map((player) => player.id)),
  });
}

/** Dry run: what applying the manifest would create, keep and refuse. Writes nothing. */
export async function planFootywireIdentityManifest(
  client: IdentityClient,
  manifestValue: unknown
) {
  return planWithClient(client, validateReviewedFootywireIdentityManifest(manifestValue));
}

export async function applyFootywireIdentityManifest(
  client: Pick<PrismaClient, '$transaction'>,
  manifestValue: unknown
): Promise<{ created: number; unchanged: number }> {
  const manifest = validateReviewedFootywireIdentityManifest(manifestValue);
  return client.$transaction(
    async (tx) => {
      const plan = await planWithClient(tx, manifest);
      if (plan.blockers.length > 0) throw new FootywireIdentityBlockedError(plan.blockers);
      if (plan.create.length > 0) {
        await tx.playerExternalIdentity.createMany({
          data: plan.create.map((mapping) => ({
            provider: FOOTYWIRE_STATS_PROVIDER,
            externalId: mapping.externalId,
            playerId: mapping.playerId,
            verifiedAt: new Date(manifest.reviewedAt),
          })),
        });
      }
      return { created: plan.create.length, unchanged: plan.unchanged.length };
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Reviewed Footywire links for the given ETL player ids. Ids with no reviewed link are absent: the
 * caller reports them, it never guesses.
 */
export async function resolveFootywirePlayerIds(
  externalIds: readonly string[],
  client: Pick<Prisma.TransactionClient, 'playerExternalIdentity'>
): Promise<Map<string, string>> {
  const unique = [...new Set(externalIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const identities = await client.playerExternalIdentity.findMany({
    where: {
      provider: FOOTYWIRE_STATS_PROVIDER,
      externalId: { in: unique },
      verifiedAt: { not: null },
    },
    select: { externalId: true, playerId: true },
  });
  return new Map(identities.map((identity) => [identity.externalId, identity.playerId]));
}
