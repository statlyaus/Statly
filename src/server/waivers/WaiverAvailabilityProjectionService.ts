import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { groupWaiverPlayersByIdentity } from '@/server/waivers/waiverPlayerIdentity';

type PrismaLike = Pick<
  typeof prisma,
  'leagueRosterPlayer' | 'player' | 'playerExternalIdentity' | 'teamAction'
>;
type FirestoreLike = typeof adminDb;
const FIRESTORE_BATCH_WRITE_LIMIT = 450;

export interface WaiverAvailabilityProjectionResult {
  owned: number;
  available: number;
}

export class WaiverAvailabilityProjectionService {
  constructor(
    private readonly db: PrismaLike = prisma,
    private readonly firestore: FirestoreLike = adminDb
  ) {}

  async projectLeague(input: { leagueId: string }): Promise<WaiverAvailabilityProjectionResult> {
    const ownerships = await this.db.leagueRosterPlayer.findMany({
      where: { leagueId: input.leagueId },
      select: { playerId: true, memberId: true },
    });
    const waiverHolds = await this.db.teamAction.findMany({
      where: {
        leagueId: input.leagueId,
        actionType: 'DROP_PLAYER',
        status: 'PENDING',
        processingAt: { gt: new Date() },
      },
      select: { details: true, processingAt: true },
    });
    const allPlayers = await this.db.player.findMany({
      select: { id: true, name: true, club: true, position: true },
    });
    const retiredExternalIds = this.db.playerExternalIdentity
      ? (
          await this.db.playerExternalIdentity.findMany({
            where: { provider: 'statly-legacy' },
            select: { externalId: true, playerId: true },
          })
        )
          .filter((identity) => identity.externalId !== identity.playerId)
          .map((identity) => identity.externalId)
      : [];
    const playerGroups = groupWaiverPlayersByIdentity(allPlayers);
    const owned = new Map(ownerships.map((ownership) => [ownership.playerId, ownership.memberId]));
    const held = new Map<string, Date | null>();
    for (const hold of waiverHolds) {
      const details = parseActionDetails(hold.details);
      const playerId = typeof details.playerId === 'string' ? details.playerId : null;
      if (playerId) {
        const canonicalPlayerId =
          (await resolveCanonicalPlayerId(playerId, undefined, this.db)) ?? playerId;
        held.set(canonicalPlayerId, hold.processingAt ?? null);
      }
    }
    const leagueRef = this.firestore.collection('leagues').doc(input.leagueId);
    let batch = this.firestore.batch();
    let writeCount = 0;
    const commitIfNeeded = async (pendingWrites = 1) => {
      if (writeCount > 0 && writeCount + pendingWrites > FIRESTORE_BATCH_WRITE_LIMIT) {
        await batch.commit();
        batch = this.firestore.batch();
        writeCount = 0;
      }
    };
    const set = async (
      ref: FirebaseFirestore.DocumentReference,
      data: Record<string, unknown>,
      options: FirebaseFirestore.SetOptions
    ) => {
      await commitIfNeeded();
      batch.set(ref, data, options);
      writeCount += 1;
    };
    const remove = async (ref: FirebaseFirestore.DocumentReference) => {
      await commitIfNeeded();
      batch.delete(ref);
      writeCount += 1;
    };

    let ownedCount = 0;
    let availableCount = 0;
    const removedAliasIds = new Set<string>();

    for (const group of playerGroups) {
      const player = group.representative;
      const ownedAlias = group.aliases.find((alias) => owned.has(alias.id));
      const heldAlias = group.aliases.find((alias) => held.has(alias.id));
      const ownerMemberId = ownedAlias ? owned.get(ownedAlias.id) : undefined;
      const ownershipRef = leagueRef.collection('playerOwnerships').doc(player.id);
      const availabilityRef = leagueRef.collection('availablePlayers').doc(player.id);
      const updatedAt = new Date().toISOString();

      if (ownerMemberId) {
        ownedCount += 1;
        await set(
          ownershipRef,
          {
            playerId: player.id,
            memberId: ownerMemberId,
            status: 'owned',
            available: false,
            updatedAt,
          },
          { merge: true }
        );
        await remove(availabilityRef);
      } else if (heldAlias) {
        await set(
          availabilityRef,
          {
            playerId: player.id,
            status: 'waiver',
            available: false,
            processingAt: held.get(heldAlias.id),
            updatedAt,
          },
          { merge: true }
        );
        await remove(ownershipRef);
      } else {
        availableCount += 1;
        await set(
          availabilityRef,
          {
            playerId: player.id,
            status: 'available',
            available: true,
            updatedAt,
          },
          { merge: true }
        );
        await remove(ownershipRef);
      }

      for (const alias of group.aliases) {
        if (alias.id === player.id) continue;
        await remove(leagueRef.collection('availablePlayers').doc(alias.id));
        await remove(leagueRef.collection('playerOwnerships').doc(alias.id));
        removedAliasIds.add(alias.id);
      }
    }

    for (const retiredExternalId of retiredExternalIds) {
      if (removedAliasIds.has(retiredExternalId)) continue;
      await remove(leagueRef.collection('availablePlayers').doc(retiredExternalId));
      await remove(leagueRef.collection('playerOwnerships').doc(retiredExternalId));
    }

    if (writeCount > 0) {
      await batch.commit();
    }

    return {
      owned: ownedCount,
      available: availableCount,
    };
  }
}

function parseActionDetails(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;

  try {
    const parsed = JSON.parse(String(raw ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
