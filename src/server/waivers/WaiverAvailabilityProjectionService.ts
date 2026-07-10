import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';

type PrismaLike = Pick<typeof prisma, 'leagueRosterPlayer' | 'leagueWaiverHold' | 'player'>;
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
    const waiverHolds = await this.db.leagueWaiverHold.findMany({
      where: {
        leagueId: input.leagueId,
        availableAt: { gt: new Date() },
      },
      select: { playerId: true, availableAt: true },
    });
    const allPlayers = await this.db.player.findMany({ select: { id: true } });
    const owned = new Map(ownerships.map((ownership) => [ownership.playerId, ownership.memberId]));
    const held = new Map<string, Date | null>();
    for (const hold of waiverHolds) {
      held.set(hold.playerId, hold.availableAt);
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

    for (const player of allPlayers) {
      const ownerMemberId = owned.get(player.id);
      const ownershipRef = leagueRef.collection('playerOwnerships').doc(player.id);
      const availabilityRef = leagueRef.collection('availablePlayers').doc(player.id);
      const updatedAt = new Date().toISOString();

      if (ownerMemberId) {
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
      } else if (held.has(player.id)) {
        await set(
          availabilityRef,
          {
            playerId: player.id,
            status: 'waiver',
            available: false,
            processingAt: held.get(player.id),
            updatedAt,
          },
          { merge: true }
        );
        await remove(ownershipRef);
      } else {
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
    }

    if (writeCount > 0) {
      await batch.commit();
    }

    return {
      owned: ownerships.length,
      available: allPlayers.filter((player) => !owned.has(player.id) && !held.has(player.id))
        .length,
    };
  }
}
