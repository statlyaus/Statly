/**
 * Serverless Draft Worker - Firebase Functions Implementation
 * Handles automated draft processing with league isolation
 */

import * as functions from 'firebase-functions/v1';
import type { EventContext } from 'firebase-functions/v1';
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();
const REGION = 'australia-southeast1';

interface DraftPreferences {
  watchlist: string[];
  autoDraftEnabled: boolean;
  draftStrategy: 'BALANCED' | 'OFFENSE' | 'DEFENSE' | 'VALUE';
  priorityPositions: string[];
  maxDraftTime: number; // seconds
}

interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  averagePoints: number;
  projectedPoints: number;
  adp: number; // Average Draft Position
  tier: number;
}

/**
 * League-specific trade update listener
 * Triggers only for trades within the specific league
 */
export const onTradeUpdate = functions
  .region(REGION)
  .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
  .firestore.document('leagues/{leagueId}/trades/{tradeId}')
  .onWrite(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, tradeId } = context.params as { leagueId: string; tradeId: string };
    const tradeData = change.after.data() ?? null;

    if (!tradeData) return;

    functions.logger.info(`Processing league-specific trade update in league ${leagueId}`);

    try {
      switch (tradeData.status) {
        case 'PROPOSED':
          await handleLeagueTradeProposal(leagueId, tradeId);
          break;
        case 'ACCEPTED':
          await processAcceptedLeagueTrade(leagueId, tradeId, tradeData);
          break;
        case 'REJECTED':
          await notifyLeagueTradeRejection(leagueId);
          break;
      }
    } catch (error) {
      functions.logger.error(`League-scoped trade processing failed for ${tradeId}:`, error);
    }
  });

/**
 * Daily waiver processing - league-scoped
 */
export const processWaivers = functions
  .region(REGION)
  .runWith({ failurePolicy: true, timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('0 2 * * *') // 2 AM daily
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.info('Starting daily league-scoped waiver processing');

    try {
      const leaguesWithWaivers = await getLeaguesWithPendingWaivers();

      const results = await Promise.allSettled(
        leaguesWithWaivers.map((leagueId) => processLeagueWaivers(leagueId))
      );

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      functions.logger.info(
        `League-scoped waiver processing complete: ${successful}/${leaguesWithWaivers.length} leagues processed`
      );
    } catch (error) {
      functions.logger.error('League-scoped waiver processing failed:', error);
    }
  });

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

/**
 * User-specific watchlist update listener
 * Triggers only for watchlist changes for a specific user in a league
 */
export const onUserWatchlistUpdate = functions
  .region(REGION)
  .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
  .firestore.document('leagues/{leagueId}/members/{userId}')
  .onUpdate(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, userId } = context.params as { leagueId: string; userId: string };
    const beforeData = change.before.data() ?? {};
    const afterData = change.after.data() ?? {};

    const oldWatchlist: string[] = beforeData.draftPreferences?.watchlist || [];
    const newWatchlist: string[] = afterData.draftPreferences?.watchlist || [];

    const oldSet = new Set(oldWatchlist);
    const newSet = new Set(newWatchlist);
    const changed = oldSet.size !== newSet.size || [...oldSet].some((id) => !newSet.has(id));

    if (changed) {
      functions.logger.info(`User watchlist updated: ${userId} in league ${leagueId}`);

      try {
        // Validate watchlist players are still available in this league
        await validateUserWatchlistForLeague(leagueId, userId, newWatchlist);

        // Update draft recommendations cache for this user in this league
        await updateUserDraftRecommendations(leagueId, userId);
      } catch (error) {
        functions.logger.error(`User watchlist processing failed for ${userId}:`, error);
      }
    }
  });

async function getAvailablePlayersByStrategy(
  leagueId: string,
  strategy: string,
  priorityPositions: string[],
  round: number
): Promise<Player[]> {
  // Query per-league availability index for scalable filtering
  let query = db
    .collection('leagues')
    .doc(leagueId)
    .collection('availablePlayers')
    .where('available', '==', true)
    .orderBy('tier')
    .orderBy('averagePoints', 'desc');

  if (round <= 3) {
    query = query.where('tier', '<=', 2);
  } else if (round <= 8) {
    query = query.where('tier', '<=', 4);
  }

  if (priorityPositions.length > 0 && round <= 10) {
    query = query.where('position', 'in', priorityPositions.slice(0, 10));
  }

  const snapshot = await query.limit(50).get();
  const playerIds = snapshot.docs.map((d) => d.id);
  if (playerIds.length === 0) return [];

  const playerDocs = await Promise.all(
    playerIds.map((id) => db.collection('players').doc(id).get())
  );
  return playerDocs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, ...(d.data() as any) })) as Player[];
}

async function isPlayerAvailable(leagueId: string, playerId: string): Promise<boolean> {
  const indexDoc = await db
    .collection('leagues')
    .doc(leagueId)
    .collection('availablePlayers')
    .doc(playerId)
    .get();
  if (indexDoc.exists) {
    const available = (indexDoc.data() as any)?.available;
    return available === true;
  }
  // Fallback to legacy field
  const doc = await db.collection('players').doc(playerId).get();
  const data = doc.data();
  return data?.leagueAvailability?.[leagueId] !== false;
}

// League-specific trade processing functions

async function handleLeagueTradeProposal(leagueId: string, tradeId: string): Promise<void> {
  // Validate trade within league context
  const isValid = await validateTradeForLeague(leagueId);

  if (!isValid) {
    await db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId).update({
      status: 'REJECTED',
      rejectionReason: 'Invalid trade configuration for this league',
      updatedAt: Timestamp.now(),
    });
    return;
  }

  // Set expiration (72 hours default)
  const tradeExpiresAt = Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000);

  await db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId).update({
    expiresAt: tradeExpiresAt,
    updatedAt: Timestamp.now(),
  });

  // Notify trade partner within league
  await notifyLeagueTradePartner(leagueId);
}

async function processAcceptedLeagueTrade(
  leagueId: string,
  tradeId: string,
  tradeData: any
): Promise<void> {
  const batch = db.batch();

  // Update rosters within league scope
  const fromRosterRef = db
    .collection('leagues')
    .doc(leagueId)
    .collection('rosters')
    .doc(tradeData.fromTeamId);

  const toRosterRef = db
    .collection('leagues')
    .doc(leagueId)
    .collection('rosters')
    .doc(tradeData.toTeamId);

  // Remove players from sending team
  batch.update(fromRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now(),
  });

  // Remove players from receiving team who are being sent away
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.toPlayerIds),
    updatedAt: Timestamp.now(),
  });

  // Add players to receiving team
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayUnion(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now(),
  });

  // Mark trade as processed within league
  const tradeRef = db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId);

  batch.update(tradeRef, {
    status: 'PROCESSED',
    processedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  await batch.commit();

  functions.logger.info(`League trade ${tradeId} processed successfully in league ${leagueId}`);
}

// Waiver processing functions

async function getLeaguesWithPendingWaivers(): Promise<string[]> {
  const snapshot = await db
    .collectionGroup('waivers')
    .where('status', '==', 'PENDING')
    .select() // Only get document IDs
    .get();

  const leagueIds = new Set<string>();

  snapshot.docs.forEach((doc) => {
    const pathParts = doc.ref.path.split('/');
    leagueIds.add(pathParts[1]); // Extract leagueId
  });

  return Array.from(leagueIds);
}

async function processLeagueWaivers(leagueId: string): Promise<void> {
  const pendingWaivers = await getPendingWaivers(leagueId);

  if (pendingWaivers.length === 0) {
    functions.logger.info(`No pending waivers for league ${leagueId}`);
    return;
  }

  // Sort by priority, then by claim time
  pendingWaivers.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.claimTime.toMillis() - b.claimTime.toMillis();
  });

  const batch = db.batch();
  const successfulClaims: string[] = [];

  for (const waiver of pendingWaivers) {
    const success = await processWaiverClaim(leagueId, waiver, batch);
    if (success) successfulClaims.push(waiver.playerId);

    const waiverRef = db.collection('leagues').doc(leagueId).collection('waivers').doc(waiver.id);

    batch.update(waiverRef, {
      status: success ? 'SUCCESSFUL' : 'UNSUCCESSFUL',
      processedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  await batch.commit();

  // Update availability index for successful claims
  await Promise.all(
    successfulClaims.map((pid) => updatePlayerAvailabilityForLeague(leagueId, pid, false))
  );

  functions.logger.info(`Processed ${pendingWaivers.length} waivers for league ${leagueId}`);
}

async function getPendingWaivers(leagueId: string): Promise<any[]> {
  const snapshot = await db
    .collection('leagues')
    .doc(leagueId)
    .collection('waivers')
    .where('status', '==', 'PENDING')
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

async function processWaiverClaim(leagueId: string, waiver: any, batch: any): Promise<boolean> {
  // Check if player is still available
  const isAvailable = await isPlayerAvailable(leagueId, waiver.playerId);

  if (!isAvailable) {
    return false; // Player already claimed
  }

  // Add player to roster
  const rosterRef = db.collection('leagues').doc(leagueId).collection('rosters').doc(waiver.teamId);

  batch.update(rosterRef, {
    playerIds: FieldValue.arrayUnion(waiver.playerId),
    updatedAt: Timestamp.now(),
  });

  // Remove dropped player if specified
  if (waiver.dropPlayerId) {
    batch.update(rosterRef, {
      playerIds: FieldValue.arrayRemove(waiver.dropPlayerId),
      updatedAt: Timestamp.now(),
    });
  }

  // Update player availability
  const playerRef = db.collection('players').doc(waiver.playerId);
  batch.update(playerRef, {
    [`leagueAvailability.${leagueId}`]: false,
    updatedAt: Timestamp.now(),
  });

  // Also update availability index (outside batch by caller after commit)
  return true;
}

// League-specific notification functions

async function notifyLeagueTradePartner(leagueId: string): Promise<void> {
  // Implement league-scoped trade proposal notification
  functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}

async function notifyLeagueTradeRejection(leagueId: string): Promise<void> {
  // Implement league-scoped trade rejection notification
  functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}

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

async function validateTradeForLeague(leagueId: string): Promise<boolean> {
  // Implement league-specific trade validation logic
  // Check league roster limits, position requirements, etc.
  functions.logger.info(`Validating trade for league ${leagueId}`);
  return true;
}

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

async function validateUserWatchlistForLeague(
  leagueId: string,
  userId: string,
  watchlist: string[]
): Promise<void> {
  // Validate that watchlist players are available in this specific league
  const unavailablePlayers: string[] = [];

  for (const playerId of watchlist) {
    const isAvailable = await isPlayerAvailable(leagueId, playerId);
    if (!isAvailable) {
      unavailablePlayers.push(playerId);
    }
  }

  if (unavailablePlayers.length > 0) {
    // Update user's watchlist to remove unavailable players
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection('members')
      .doc(userId)
      .update({
        'draftPreferences.watchlist': FieldValue.arrayRemove(...unavailablePlayers),
        updatedAt: Timestamp.now(),
      });

    functions.logger.info(
      `Removed ${unavailablePlayers.length} unavailable players from ${userId}'s watchlist in league ${leagueId}`
    );
  }
}

async function updateUserDraftRecommendations(leagueId: string, userId: string): Promise<void> {
  // Generate fresh draft recommendations for user in specific league
  try {
    const preferences = await getUserDraftPreferences(leagueId, userId);
    const recommendations = await generateDraftRecommendations(leagueId, preferences);

    await db.collection('leagues').doc(leagueId).collection('members').doc(userId).update({
      draftRecommendations: recommendations,
      recommendationsUpdatedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    functions.logger.info(`Updated draft recommendations for user ${userId} in league ${leagueId}`);
  } catch (error) {
    functions.logger.error(`Failed to update draft recommendations for ${userId}:`, error);
  }
}

async function generateDraftRecommendations(
  leagueId: string,
  preferences: DraftPreferences
): Promise<any[]> {
  // Generate league-specific draft recommendations based on user preferences
  const availablePlayers = await getAvailablePlayersByStrategy(
    leagueId,
    preferences.draftStrategy,
    preferences.priorityPositions,
    1 // Current round approximation
  );

  return availablePlayers.slice(0, 10).map((player) => ({
    playerId: player.id,
    reason: `Recommended based on ${preferences.draftStrategy} strategy`,
    priority: player.tier,
    estimatedValue: player.averagePoints,
  }));
}

async function getUserDraftPreferences(
  leagueId: string,
  userId: string
): Promise<DraftPreferences> {
  const doc = await db.collection('leagues').doc(leagueId).collection('members').doc(userId).get();
  const data = doc.data();
  return (
    data?.draftPreferences || {
      watchlist: [],
      autoDraftEnabled: true,
      draftStrategy: 'BALANCED',
      priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
      maxDraftTime: 90,
    }
  );
}

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
