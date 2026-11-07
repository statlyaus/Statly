/**
 * Serverless Draft Worker - Firebase Functions Implementation
 * Handles automated draft processing with league isolation
 */

import * as functions from 'firebase-functions/v1';
import type { EventContext } from 'firebase-functions/v1';
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();
const REGION = 'australia-southeast1';

/**
 * Team-specific roster write listener.
 * Keeps ownership and availability indexes in sync with canonical league rosters.
 */
export const onTeamRosterUpdate = functions
  .region(REGION)
  .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
  .firestore.document('leagues/{leagueId}/rosters/{teamId}')
  .onWrite(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, teamId } = context.params as { leagueId: string; teamId: string };
    const beforeData = change.before.exists ? (change.before.data() ?? {}) : {};
    const afterData = change.after.exists ? (change.after.data() ?? {}) : {};

    functions.logger.info(`Team roster written: ${teamId} in league ${leagueId}`);

    try {
      const oldPlayerIds = getRosterPlayerIds(beforeData);
      const newPlayerIds = getRosterPlayerIds(afterData);

      const addedPlayers = newPlayerIds.filter((id: string) => !oldPlayerIds.includes(id));
      const removedPlayers = oldPlayerIds.filter((id: string) => !newPlayerIds.includes(id));
      const userId = stringOrUndefined(afterData.userId) ?? stringOrUndefined(beforeData.userId);

      await syncRosterOwnershipForLeague(leagueId, teamId, userId, addedPlayers, removedPlayers);

      // Notify team members of roster changes
      await notifyTeamRosterChanges(leagueId, teamId, addedPlayers, removedPlayers);
    } catch (error) {
      functions.logger.error(`Team roster update processing failed for ${teamId}:`, error);
    }
  });

// League-specific trade processing functions

// League-specific notification functions

// Team-specific notification functions

async function notifyTeamRosterChanges(
  leagueId: string,
  teamId: string,
  addedPlayers: string[],
  removedPlayers: string[]
): Promise<void> {
  // Implement team-scoped roster change notifications
  functions.logger.info(
    `Notifying team ${teamId} in league ${leagueId} of roster changes: +${addedPlayers.length}, -${removedPlayers.length}`
  );
}

async function syncRosterOwnershipForLeague(
  leagueId: string,
  teamId: string,
  userId: string | undefined,
  addedPlayers: string[],
  removedPlayers: string[]
): Promise<void> {
  if (addedPlayers.length === 0 && removedPlayers.length === 0) {
    return;
  }

  const batch = db.batch();
  const now = Timestamp.now();

  for (const playerId of addedPlayers) {
    const ownershipRef = db
      .collection('leagues')
      .doc(leagueId)
      .collection('playerOwnerships')
      .doc(playerId);

    batch.set(
      ownershipRef,
      {
        leagueId,
        playerId,
        teamId,
        ...(userId ? { userId } : {}),
        acquiredAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  for (const playerId of removedPlayers) {
    const ownershipRef = db
      .collection('leagues')
      .doc(leagueId)
      .collection('playerOwnerships')
      .doc(playerId);

    batch.delete(ownershipRef);
  }

  await batch.commit();

  await Promise.all([
    ...addedPlayers.map((playerId) => updatePlayerAvailabilityForLeague(leagueId, playerId, false)),
    ...removedPlayers.map((playerId) => updatePlayerAvailabilityForLeague(leagueId, playerId, true)),
  ]);
}

function getRosterPlayerIds(data: DocumentData): string[] {
  if (!Array.isArray(data.playerIds)) {
    return [];
  }

  return [...new Set(data.playerIds.map((id: unknown) => String(id)).filter(Boolean))];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

// League-specific validation functions

// League-specific player availability functions

async function updatePlayerAvailabilityForLeague(
  leagueId: string,
  playerId: string,
  isAvailable: boolean
): Promise<void> {
  // Update player availability only for specific league
  const playerRef = db.collection('players').doc(playerId);

  await playerRef.update({
    [`leagueAvailability.${leagueId}`]: isAvailable,
    updatedAt: Timestamp.now(),
  });

  // Maintain per-league availability index
  const indexRef = db
    .collection('leagues')
    .doc(leagueId)
    .collection('availablePlayers')
    .doc(playerId);

  if (isAvailable) {
    // Include fields used for querying to avoid N+1 reads
    const snap = await playerRef.get();
    const pdata = snap.data() as any;
    await indexRef.set(
      {
        available: true,
        tier: pdata?.tier ?? 999,
        averagePoints: pdata?.averagePoints ?? 0,
        position: pdata?.position ?? 'UNK',
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  } else {
    await indexRef.set(
      {
        available: false,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  }

  functions.logger.info(
    `Updated player ${playerId} availability in league ${leagueId}: ${isAvailable}`
  );
}

// User-specific functions

/**
 * Firestore trigger to maintain ownershipPercent and available flag in availablePlayers
 * on changes to playerOwnerships; add HTTP backfill to recompute for a league; include helpers to count teams.
 */

async function getLeagueTeamCount(leagueId: string): Promise<number> {
  // Prefer explicit settings if stored
  try {
    // Prefer explicit settings if stored
    const leagueDoc = await db.collection('leagues').doc(leagueId).get();
    const numFromSettings = (leagueDoc.data() as any)?.settings?.numTeams;
    if (
      typeof numFromSettings === 'number' &&
      Number.isFinite(numFromSettings) &&
      numFromSettings > 0
    ) {
      return numFromSettings;
    }

    // Try aggregation count if available
    const rosters = db.collection('leagues').doc(leagueId).collection('rosters');
    const countMethod = (rosters as any).count;
    if (typeof countMethod === 'function') {
      const agg = await countMethod.call(rosters).get();
      const c = agg.data().count as number;
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    }

    // Fallback to full get
    const snap = await rosters.get();
    return snap.size || 0;
  } catch (e) {
    functions.logger.warn('getLeagueTeamCount failed', { leagueId, error: String(e) });
    return 0;
  }
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const onPlayerOwnershipWrite = functions
  .region(REGION)
  .firestore.document('leagues/{leagueId}/playerOwnerships/{playerId}')
  .onWrite(async (change, context) => {
    const { leagueId, playerId } = context.params as { leagueId: string; playerId: string };
    const after = change.after;

    // Determine owners count from doc shape (supports both single-owner and owners[] variants)
    let ownersCount = 0;
    if (after.exists) {
      const data = after.data() as any;
      if (Array.isArray(data?.owners)) ownersCount = data.owners.length;
      else ownersCount = 1; // single-owner schema
    } else {
      ownersCount = 0;
    }

    const teamCount = await getLeagueTeamCount(leagueId);
    // Avoid divide-by-zero; if unknown, treat 1 team so 0/100 logic still holds
    const safeTeams = teamCount > 0 ? teamCount : 1;
    const ownershipPercent = clampPercent((ownersCount / safeTeams) * 100);
    const available = ownersCount === 0;

    const indexRef = db
      .collection('leagues')
      .doc(leagueId)
      .collection('availablePlayers')
      .doc(playerId);
    // Merge-only update; do not clobber tier/position, etc.
    await indexRef.set(
      {
        available,
        ownershipPercent,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  });

export const backfillOwnershipPercent = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      // AuthN/AuthZ: require either valid INTERNAL_TASK_SECRET (constant-time) or admin Firebase ID token
      const internalSecret = process.env.INTERNAL_TASK_SECRET || '';
      const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as
        | string
        | undefined;
      const bearer =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length)
          : undefined;
      const providedSecret = (req.headers['x-internal-secret'] as string | undefined) ?? undefined;

      function safeEquals(a?: string, b?: string): boolean {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        const aBuf = Buffer.from(a, 'utf8');
        const bBuf = Buffer.from(b, 'utf8');
        if (aBuf.length !== bBuf.length) return false;
        return crypto.timingSafeEqual(aBuf, bBuf);
      }

      let authorized = false;
      if (providedSecret && internalSecret && safeEquals(providedSecret, internalSecret)) {
        authorized = true;
      } else if (bearer) {
        try {
          const decoded = await getAuth().verifyIdToken(bearer);
          if ((decoded as any)?.admin === true || (decoded as any)?.roles?.includes?.('admin')) {
            authorized = true;
          }
        } catch {
          // ignore, will result in 401 unless secret matches
        }
      }

      if (!authorized) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const leagueId = (req.query.leagueId as string) || (req.body && req.body.leagueId);
      if (!leagueId) {
        res.status(400).json({ error: 'leagueId is required' });
        return;
      }

      const teamCount = await getLeagueTeamCount(leagueId);
      const safeTeams = teamCount > 0 ? teamCount : 1;

      // Build a map of playerId -> ownersCount from playerOwnerships
      const ownershipSnap = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('playerOwnerships')
        .select('owners', 'teamId')
        .get();
      const ownershipMap = new Map<string, number>();
      ownershipSnap.forEach((doc) => {
        const data = doc.data() as any;
        const ownersCount = Array.isArray(data?.owners) ? data.owners.length : 1;
        ownershipMap.set(doc.id, ownersCount);
      });

      // Iterate availablePlayers index and update ownershipPercent + available
      const indexSnap = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('availablePlayers')
        .get();
      const batch = db.batch();
      indexSnap.forEach((doc) => {
        const ownersCount = ownershipMap.get(doc.id) || 0;
        const available = ownersCount === 0;
        const ownershipPercent = clampPercent((ownersCount / safeTeams) * 100);
        batch.set(
          doc.ref,
          { available, ownershipPercent, updatedAt: Timestamp.now() },
          { merge: true }
        );
      });

      await batch.commit();
      res.status(200).json({ updated: indexSnap.size, teamCount: safeTeams });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Internal error' });
    }
  });
