/**
 * Serverless Draft Worker - Firebase Functions Implementation
 * Handles automated draft processing with league isolation
 */

import * as functions from 'firebase-functions/v1';
import type { EventContext } from 'firebase-functions/v1';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();
const REGION = 'australia-southeast1';

// Configurable runtime for the draft worker (tunable without code changes)
const DRAFT_WORKER_MEMORY = (process.env.DRAFT_WORKER_MEMORY || process.env.FUNCTIONS_MEMORY || '1GB') as any; // '256MB' | '512MB' | '1GB' | '2GB'
const DRAFT_WORKER_TIMEOUT_SECONDS = parseInt(
  process.env.DRAFT_WORKER_TIMEOUT_SECONDS || process.env.FUNCTIONS_TIMEOUT_SECONDS || '300',
  10
);

// Types for draft entities
interface DraftPick {
  id: string;
  leagueId: string;
  pickNumber: number;
  round: number;
  userId: string;
  teamId: string;
  playerId?: string;
  pickTime?: Timestamp;
  timeRemaining: number;
  isAutoPick: boolean;
  draftId: string;
  // Add deadlineAt for precise timeout handling
  deadlineAt?: Timestamp;
}

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

interface LeagueSettings {
  draftOrderType: 'SNAKE' | 'LINEAR';
  pickTimeLimit: number; // seconds
  autoDraftAfterTime: boolean;
  draftStartTime: Timestamp;
  draftStatus: 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  totalRounds: number;
  teamsCount: number;
}

/**
 * Scheduled function to process auto-draft picks
 * Runs every 30 seconds during active drafts
 */
export const processDraftPicks = functions
  .region(REGION)
  .runWith({ failurePolicy: true, timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS, memory: DRAFT_WORKER_MEMORY })
  .pubsub
  .schedule('every 30 seconds')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    // Basic runtime metrics for Cloud Monitoring (log-based metrics)
    const startTs = Date.now();
    const cpuStart = process.cpuUsage();
    const memStart = process.memoryUsage();

    functions.logger.info('draftWorker.processDraftPicks.start', {
      region: REGION,
      config: { memory: DRAFT_WORKER_MEMORY, timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS },
      rssMb: Math.round(memStart.rss / 1024 / 1024),
      heapUsedMb: Math.round(memStart.heapUsed / 1024 / 1024),
      timestamp: new Date(startTs).toISOString(),
    });

    try {
      const activeDrafts = await getActiveDrafts();
      functions.logger.info(`Found ${activeDrafts.length} active drafts`);

      const results = await Promise.allSettled(activeDrafts.map((leagueId) => processLeagueDraft(leagueId)));

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      const cpu = process.cpuUsage(cpuStart);
      const memEnd = process.memoryUsage();
      const durationMs = Date.now() - startTs;

      functions.logger.info('draftWorker.processDraftPicks.complete', {
        successful,
        failed,
        activeDraftsCount: activeDrafts.length,
        durationMs,
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        rssMb: Math.round(memEnd.rss / 1024 / 1024),
        heapUsedMb: Math.round(memEnd.heapUsed / 1024 / 1024),
        config: { memory: DRAFT_WORKER_MEMORY, timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS, region: REGION },
      });
    } catch (error) {
      const cpu = process.cpuUsage(cpuStart);
      const memEnd = process.memoryUsage();
      const durationMs = Date.now() - startTs;

      functions.logger.error('draftWorker.processDraftPicks.error', {
        error: String(error),
        durationMs,
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        rssMb: Math.round(memEnd.rss / 1024 / 1024),
        heapUsedMb: Math.round(memEnd.heapUsed / 1024 / 1024),
        config: { memory: DRAFT_WORKER_MEMORY, timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS, region: REGION },
      });
    }
  });

/**
 * League-specific draft pick listener
 * Triggers only for picks within the specific league
 */
export const onDraftPickMade = functions.region(REGION).runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' }).firestore
  .document('leagues/{leagueId}/draft/picks/active/{pickId}')
  .onWrite(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, pickId } = context.params as { leagueId: string; pickId: string };
    // Process only when playerId transitions from empty to a value
    if (!change.after.exists) return;
    const beforeData = (change.before.exists ? (change.before.data() as Partial<DraftPick>) : undefined);
    const pickData = (change.after.data() as DraftPick | undefined) ?? undefined;
    // Process only when playerId transitions from empty to a value
    if (!pickData?.playerId || beforeData?.playerId === pickData.playerId) {
      functions.logger.info(`No actionable change for pick ${pickId} in league ${leagueId}`, { leagueId, pickId });
      return;
    }

    functions.logger.info(`Processing league-specific pick: ${pickData.playerId} for league ${leagueId}`, { leagueId, pickId, playerId: pickData.playerId });

    try {
      // League-scoped operations only
      await advanceToNextPick(leagueId);

      // Notify only league members (league-scoped)
      await notifyLeagueMembers(leagueId, pickData);

      // Update player availability for this league only
      await updatePlayerAvailabilityForLeague(leagueId, pickData.playerId, false);

      await logDraftEvent(leagueId, 'PICK_PROCESSED', { pickId, playerId: pickData.playerId });
      functions.logger.info(`Successfully processed league-scoped pick ${pickId}`, { leagueId, pickId });

    } catch (error) {
      functions.logger.error(`Failed to process league-scoped pick ${pickId}:`, { leagueId, pickId, error });
      await logDraftEvent(leagueId, 'PICK_PROCESS_FAILED', { pickId, error: String(error) });
    }
  });

/**
 * League-specific trade update listener
 * Triggers only for trades within the specific league
 */
export const onTradeUpdate = functions.region(REGION).runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' }).firestore
  .document('leagues/{leagueId}/trades/{tradeId}')
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
export const processWaivers = functions.region(REGION).runWith({ failurePolicy: true, timeoutSeconds: 300, memory: '512MB' }).pubsub
  .schedule('0 2 * * *') // 2 AM daily
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.info('Starting daily league-scoped waiver processing');
    
    try {
      const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
      
      const results = await Promise.allSettled(
        leaguesWithWaivers.map(leagueId => processLeagueWaivers(leagueId))
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      functions.logger.info(`League-scoped waiver processing complete: ${successful}/${leaguesWithWaivers.length} leagues processed`);
      
    } catch (error) {
      functions.logger.error('League-scoped waiver processing failed:', error);
    }
  });

/**
 * Team-specific roster update listener
 * Triggers only for roster changes within a specific team
 */
export const onTeamRosterUpdate = functions.region(REGION).runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' }).firestore
  .document('leagues/{leagueId}/rosters/{teamId}')
  .onUpdate(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, teamId } = context.params as { leagueId: string; teamId: string };
    const beforeData = change.before.data() ?? {};
    const afterData = change.after.data() ?? {};
    
    functions.logger.info(`Team roster updated: ${teamId} in league ${leagueId}`);
    
    try {
      // Check for player additions/removals
      const oldPlayerIds = beforeData.playerIds || [];
      const newPlayerIds = afterData.playerIds || [];
      
      const addedPlayers = newPlayerIds.filter((id: string) => !oldPlayerIds.includes(id));
      const removedPlayers = oldPlayerIds.filter((id: string) => !newPlayerIds.includes(id));
      
      // Update league-specific player availability
      for (const playerId of addedPlayers) {
        await updatePlayerAvailabilityForLeague(leagueId, playerId, false);
      }
      
      for (const playerId of removedPlayers) {
        await updatePlayerAvailabilityForLeague(leagueId, playerId, true);
      }
      
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
export const onUserWatchlistUpdate = functions.region(REGION).runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' }).firestore
  .document('leagues/{leagueId}/members/{userId}')
  .onUpdate(async (change: functions.Change<DocumentSnapshot>, context: EventContext) => {
    const { leagueId, userId } = context.params as { leagueId: string; userId: string };
    const beforeData = change.before.data() ?? {};
    const afterData = change.after.data() ?? {};
    
    const oldWatchlist: string[] = beforeData.draftPreferences?.watchlist || [];
    const newWatchlist: string[] = afterData.draftPreferences?.watchlist || [];
    
    const oldSet = new Set(oldWatchlist);
    const newSet = new Set(newWatchlist);
    const changed = oldSet.size !== newSet.size || [...oldSet].some(id => !newSet.has(id));
    
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

// Core draft processing functions

async function getActiveDrafts(): Promise<string[]> {
  const snapshot = await db.collection('activeDrafts').select().get();
  return snapshot.docs.map(d => d.id);
}

async function processLeagueDraft(leagueId: string): Promise<void> {
  const currentPick = await getCurrentDraftPick(leagueId);
  
  if (!currentPick) {
    functions.logger.info(`No active pick for league ${leagueId}`);
    return;
  }
  
  const now = Date.now();
  let pickMillis = currentPick.pickTime?.toMillis() || now;
  if (pickMillis > now) pickMillis = now; // clamp to avoid future pickTime
  const timeExpired = currentPick.deadlineAt
    ? now > currentPick.deadlineAt.toMillis()
    : (now - pickMillis) > (currentPick.timeRemaining * 1000);
  
  if (timeExpired || currentPick.isAutoPick) {
    functions.logger.info(`Processing auto-draft for league ${leagueId}, pick ${currentPick.pickNumber}`);
    await executeAutoDraftPick(leagueId, currentPick);
  }
}

async function getCurrentDraftPick(leagueId: string): Promise<DraftPick | null> {
  const snapshot = await db
    .collection('leagues').doc(leagueId)
    .collection('draft').doc('picks')
    .collection('active')
    .where('playerId', '==', null)
    .orderBy('pickNumber')
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    return null;
  }
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as DraftPick;
}

async function getAvailablePlayersByStrategy(
  leagueId: string,
  strategy: string,
  priorityPositions: string[],
  round: number
): Promise<Player[]> {
  // Query per-league availability index for scalable filtering
  let query = db
    .collection('leagues').doc(leagueId)
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
  const playerIds = snapshot.docs.map(d => d.id);
  if (playerIds.length === 0) return [];

  const playerDocs = await Promise.all(
    playerIds.map(id => db.collection('players').doc(id).get())
  );
  return playerDocs
    .filter(d => d.exists)
    .map(d => ({ id: d.id, ...(d.data() as any) })) as Player[];
}

async function isPlayerAvailable(leagueId: string, playerId: string): Promise<boolean> {
  const indexDoc = await db
    .collection('leagues').doc(leagueId)
    .collection('availablePlayers').doc(playerId)
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

async function executeAutoDraftPick(leagueId: string, pick: DraftPick): Promise<void> {
  try {
    // Get user's draft preferences
    const preferences = await getUserDraftPreferences(leagueId, pick.userId);

    // Select best available player
    const selectedPlayer = await selectBestAvailablePlayer(
      leagueId,
      preferences,
      pick.round
    );

    // Execute the pick transactionally
    const pickRef = db
      .collection('leagues').doc(leagueId)
      .collection('draft').doc('picks')
      .collection('active').doc(pick.id);
    const rosterRef = db
      .collection('leagues').doc(leagueId)
      .collection('rosters').doc(pick.teamId);
    const playerRef = db.collection('players').doc(selectedPlayer.id);

    await db.runTransaction(async (tx) => {
      const pickSnap = await tx.get(pickRef);
      if (!pickSnap.exists) throw new Error('Pick no longer exists');
      const pickData = pickSnap.data() as DraftPick;
      if (pickData.playerId) {
        throw new Error('Pick already assigned');
      }
      const playerSnap = await tx.get(playerRef);
      const playerData = playerSnap.data() as any;
      if (playerData?.leagueAvailability?.[leagueId] === false) {
        throw new Error('Player no longer available');
      }
      tx.update(pickRef, {
        playerId: selectedPlayer.id,
        pickTime: Timestamp.now(),
        isAutoPick: true,
        updatedAt: Timestamp.now()
      });
      tx.update(rosterRef, {
        playerIds: FieldValue.arrayUnion(selectedPlayer.id),
        updatedAt: Timestamp.now()
      });
      tx.update(playerRef, {
        [`leagueAvailability.${leagueId}`]: false,
        updatedAt: Timestamp.now()
      });
      // Update per-league availability index inside the same transaction
      const indexRef = db
        .collection('leagues').doc(leagueId)
        .collection('availablePlayers').doc(selectedPlayer.id);
      tx.set(indexRef, { available: false, updatedAt: Timestamp.now() }, { merge: true });
    });

    functions.logger.info(`Auto-drafted ${selectedPlayer.name} for user ${pick.userId} in league ${leagueId}`);

    // Advance to next pick
    await advanceToNextPick(leagueId);

  } catch (error) {
    functions.logger.error(`Auto-draft failed for pick ${pick.id}:`, error);

    // Fallback: pick highest-ranked available player
    await executeDefaultDraftPick(leagueId, pick);
  }
}

async function executeDefaultDraftPick(leagueId: string, pick: DraftPick): Promise<void> {
  // Get highest-ranked available player from league index as fallback
  const snapshot = await db
    .collection('leagues').doc(leagueId)
    .collection('availablePlayers')
    .where('available', '==', true)
    .orderBy('tier')
    .orderBy('averagePoints', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error('No players available for default pick');
  }

  const playerId = snapshot.docs[0].id;
  const playerRef = db.collection('players').doc(playerId);
  const pickRef = db
    .collection('leagues').doc(leagueId)
    .collection('draft').doc('picks')
    .collection('active').doc(pick.id);
  const rosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(pick.teamId);

  await db.runTransaction(async (tx) => {
    const pickSnap = await tx.get(pickRef);
    if (!pickSnap.exists) throw new Error('Pick no longer exists');
    const pickData = pickSnap.data() as DraftPick;
    if (pickData.playerId) throw new Error('Pick already assigned');
    const playerSnap = await tx.get(playerRef);
    const playerData = playerSnap.data() as any;
    if (playerData?.leagueAvailability?.[leagueId] === false) {
      throw new Error('Player no longer available');
    }
    tx.update(pickRef, {
      playerId: playerId,
      pickTime: Timestamp.now(),
      isAutoPick: true,
      updatedAt: Timestamp.now()
    });
    tx.update(rosterRef, {
      playerIds: FieldValue.arrayUnion(playerId),
      updatedAt: Timestamp.now()
    });
    tx.update(playerRef, {
      [`leagueAvailability.${leagueId}`]: false,
      updatedAt: Timestamp.now()
    });
    // Update per-league availability index inside the same transaction
    const indexRef = db
      .collection('leagues').doc(leagueId)
      .collection('availablePlayers').doc(playerId);
    tx.set(indexRef, { available: false, updatedAt: Timestamp.now() }, { merge: true });
  });

  functions.logger.info(`Default pick executed for league ${leagueId}`);
}

async function advanceToNextPick(leagueId: string): Promise<void> {
  const leagueSettings = await getLeagueSettings(leagueId);
  const currentPick = await getCurrentDraftPick(leagueId);
  
  if (!currentPick || !leagueSettings) return;
  
  const nextPickNumber = currentPick.pickNumber + 1;
  const totalPicks = leagueSettings.teamsCount * leagueSettings.totalRounds;
  
  if (nextPickNumber > totalPicks) {
    // Draft is complete
    await completeDraft(leagueId);
    return;
  }
  
  // Calculate next pick details
  const nextRound = Math.ceil(nextPickNumber / leagueSettings.teamsCount);
  const nextTeamIndex = getNextTeamIndex(
    nextPickNumber,
    leagueSettings.teamsCount,
    leagueSettings.draftOrderType
  );
  
  // Create next pick
  await createNextDraftPick(leagueId, {
    pickNumber: nextPickNumber,
    round: nextRound,
    teamIndex: nextTeamIndex,
    timeLimit: leagueSettings.pickTimeLimit
  });
}

async function createNextDraftPick(
  leagueId: string,
  pickDetails: {
    pickNumber: number;
    round: number;
    teamIndex: number;
    timeLimit: number;
  }
): Promise<void> {
  const teams = await getLeagueTeams(leagueId);
  const team = teams[pickDetails.teamIndex];

  if (!team) {
    throw new Error(`No team found at index ${pickDetails.teamIndex}`);
  }

  const pickRef = db
    .collection('leagues').doc(leagueId)
    .collection('draft').doc('picks')
    .collection('active').doc(String(pickDetails.pickNumber));

  const now = Date.now();
  const deadlineAt = Timestamp.fromMillis(now + pickDetails.timeLimit * 1000);

  try {
    await pickRef.create({
      pickNumber: pickDetails.pickNumber,
      round: pickDetails.round,
      userId: team.userId,
      teamId: team.id,
      timeRemaining: pickDetails.timeLimit,
      isAutoPick: false,
      pickTime: Timestamp.now(),
      deadlineAt,
      createdAt: Timestamp.now(),
      leagueId,
      draftId: `${leagueId}-draft`
    });
    await setActiveDraft(leagueId, true);
    functions.logger.info(`Created next pick ${pickDetails.pickNumber} for team ${team.id} in league ${leagueId}`, { leagueId, pickNumber: pickDetails.pickNumber });
  } catch (e: any) {
    if (isAlreadyExistsError(e)) {
      functions.logger.info(`Next pick ${pickDetails.pickNumber} already exists for league ${leagueId}`, { leagueId, pickNumber: pickDetails.pickNumber });
    } else {
      throw e;
    }
  }
}

async function getLeagueSettings(leagueId: string): Promise<LeagueSettings | null> {
  const doc = await db
    .collection('leagues').doc(leagueId)
    .collection('config').doc('settings')
    .get();
  
  return doc.exists ? doc.data() as LeagueSettings : null;
}

async function getLeagueTeams(leagueId: string): Promise<Array<{ id: string; userId: string }>> {
  const snapshot = await db
    .collection('leagues').doc(leagueId)
    .collection('rosters')
    .orderBy('draftOrder')
    .get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    userId: doc.data().userId
  }));
}

async function completeDraft(leagueId: string): Promise<void> {
  await db
    .collection('leagues').doc(leagueId)
    .collection('config').doc('settings')
    .update({
      draftStatus: 'COMPLETED',
      completedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  await setActiveDraft(leagueId, false);

  functions.logger.info(`Draft completed for league ${leagueId}`, { leagueId });

  // Notify all league members
  await notifyDraftComplete(leagueId);
}

// League-specific trade processing functions

async function handleLeagueTradeProposal(leagueId: string, tradeId: string): Promise<void> {
  // Validate trade within league context
  const isValid = await validateTradeForLeague(leagueId);
  
  if (!isValid) {
    await db
      .collection('leagues').doc(leagueId)
      .collection('trades').doc(tradeId)
      .update({
        status: 'REJECTED',
        rejectionReason: 'Invalid trade configuration for this league',
        updatedAt: Timestamp.now()
      });
    return;
  }
  
  // Set expiration (72 hours default)
  const tradeExpiresAt = Timestamp.fromMillis(Date.now() + (72 * 60 * 60 * 1000));
  
  await db
    .collection('leagues').doc(leagueId)
    .collection('trades').doc(tradeId)
    .update({
      expiresAt: tradeExpiresAt,
      updatedAt: Timestamp.now()
    });
  
  // Notify trade partner within league
  await notifyLeagueTradePartner(leagueId);
}

async function processAcceptedLeagueTrade(leagueId: string, tradeId: string, tradeData: any): Promise<void> {
  const batch = db.batch();
  
  // Update rosters within league scope
  const fromRosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(tradeData.fromTeamId);
  
  const toRosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(tradeData.toTeamId);
  
  // Remove players from sending team
  batch.update(fromRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  // Remove players from receiving team who are being sent away
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.toPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  // Add players to receiving team
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayUnion(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  // Mark trade as processed within league
  const tradeRef = db
    .collection('leagues').doc(leagueId)
    .collection('trades').doc(tradeId);
  
  batch.update(tradeRef, {
    status: 'PROCESSED',
    processedAt: Timestamp.now(),
    updatedAt: Timestamp.now()
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
  
  snapshot.docs.forEach(doc => {
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
    
    const waiverRef = db
      .collection('leagues').doc(leagueId)
      .collection('waivers').doc(waiver.id);
    
    batch.update(waiverRef, {
      status: success ? 'SUCCESSFUL' : 'UNSUCCESSFUL',
      processedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
  }
  
  await batch.commit();
  
  // Update availability index for successful claims
  await Promise.all(successfulClaims.map(pid => updatePlayerAvailabilityForLeague(leagueId, pid, false)));
  
  functions.logger.info(`Processed ${pendingWaivers.length} waivers for league ${leagueId}`);
}

async function getPendingWaivers(leagueId: string): Promise<any[]> {
  const snapshot = await db
    .collection('leagues').doc(leagueId)
    .collection('waivers')
    .where('status', '==', 'PENDING')
    .get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function processWaiverClaim(leagueId: string, waiver: any, batch: any): Promise<boolean> {
  // Check if player is still available
  const isAvailable = await isPlayerAvailable(leagueId, waiver.playerId);
  
  if (!isAvailable) {
    return false; // Player already claimed
  }
  
  // Add player to roster
  const rosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(waiver.teamId);
  
  batch.update(rosterRef, {
    playerIds: FieldValue.arrayUnion(waiver.playerId),
    updatedAt: Timestamp.now()
  });
  
  // Remove dropped player if specified
  if (waiver.dropPlayerId) {
    batch.update(rosterRef, {
      playerIds: FieldValue.arrayRemove(waiver.dropPlayerId),
      updatedAt: Timestamp.now()
    });
  }
  
  // Update player availability
  const playerRef = db.collection('players').doc(waiver.playerId);
  batch.update(playerRef, {
    [`leagueAvailability.${leagueId}`]: false,
    updatedAt: Timestamp.now()
  });
  
  // Also update availability index (outside batch by caller after commit)
  return true;
}

// League-specific notification functions

async function notifyLeagueMembers(leagueId: string, pickData: DraftPick): Promise<void> {
  // Implement league-scoped push notifications, email, or in-app notifications
  functions.logger.info(`Notifying league ${leagueId} members of pick: ${pickData.playerId}`);
}

async function notifyLeagueTradePartner(leagueId: string): Promise<void> {
  // Implement league-scoped trade proposal notification
  functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}

async function notifyLeagueTradeRejection(leagueId: string): Promise<void> {
  // Implement league-scoped trade rejection notification
  functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}

async function notifyDraftComplete(leagueId: string): Promise<void> {
  // Implement league-scoped draft completion notification
  functions.logger.info(`Notifying draft completion for league ${leagueId}`);
}

// Team-specific notification functions

async function notifyTeamRosterChanges(
  leagueId: string, 
  teamId: string, 
  addedPlayers: string[], 
  removedPlayers: string[]
): Promise<void> {
  // Implement team-scoped roster change notifications
  functions.logger.info(`Notifying team ${teamId} in league ${leagueId} of roster changes: +${addedPlayers.length}, -${removedPlayers.length}`);
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
    updatedAt: Timestamp.now()
  });
  
  // Maintain per-league availability index
  const indexRef = db
    .collection('leagues').doc(leagueId)
    .collection('availablePlayers').doc(playerId);
  
  if (isAvailable) {
    // Include fields used for querying to avoid N+1 reads
    const snap = await playerRef.get();
    const pdata = snap.data() as any;
    await indexRef.set({
      available: true,
      tier: pdata?.tier ?? 999,
      averagePoints: pdata?.averagePoints ?? 0,
      position: pdata?.position ?? 'UNK',
      updatedAt: Timestamp.now()
    }, { merge: true });
  } else {
    await indexRef.set({
      available: false,
      updatedAt: Timestamp.now()
    }, { merge: true });
  }
  
  functions.logger.info(`Updated player ${playerId} availability in league ${leagueId}: ${isAvailable}`);
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
      .collection('leagues').doc(leagueId)
      .collection('members').doc(userId)
      .update({
        'draftPreferences.watchlist': FieldValue.arrayRemove(...unavailablePlayers),
        updatedAt: Timestamp.now()
      });
    
    functions.logger.info(`Removed ${unavailablePlayers.length} unavailable players from ${userId}'s watchlist in league ${leagueId}`);
  }
}

async function updateUserDraftRecommendations(leagueId: string, userId: string): Promise<void> {
  // Generate fresh draft recommendations for user in specific league
  try {
    const preferences = await getUserDraftPreferences(leagueId, userId);
    const recommendations = await generateDraftRecommendations(leagueId, preferences);
    
    await db
      .collection('leagues').doc(leagueId)
      .collection('members').doc(userId)
      .update({
        draftRecommendations: recommendations,
        recommendationsUpdatedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
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
  
  return availablePlayers.slice(0, 10).map(player => ({
    playerId: player.id,
    reason: `Recommended based on ${preferences.draftStrategy} strategy`,
    priority: player.tier,
    estimatedValue: player.averagePoints
  }));
}

async function getUserDraftPreferences(leagueId: string, userId: string): Promise<DraftPreferences> {
  const doc = await db
    .collection('leagues').doc(leagueId)
    .collection('members').doc(userId)
    .get();
  const data = doc.data();
  return data?.draftPreferences || {
    watchlist: [],
    autoDraftEnabled: true,
    draftStrategy: 'BALANCED',
    priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
    maxDraftTime: 90
  };
}

async function getPlayer(playerId: string): Promise<Player | null> {
  const doc = await db.collection('players').doc(playerId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as any) } as Player;
}

async function selectBestAvailablePlayer(
  leagueId: string,
  preferences: DraftPreferences,
  round: number
): Promise<Player> {
  // First, try to pick from user's watchlist in order
  const watchlistPlayers = await getAvailablePlayersFromWatchlist(leagueId, preferences.watchlist);
  if (watchlistPlayers.length > 0) {
    return watchlistPlayers[0];
  }

  // Fallback to best available by strategy
  const availablePlayers = await getAvailablePlayersByStrategy(
    leagueId,
    preferences.draftStrategy,
    preferences.priorityPositions ?? [],
    round
  );
  if (availablePlayers.length === 0) {
    throw new Error('No available players found for auto-draft');
  }
  return availablePlayers[0];
}

async function getAvailablePlayersFromWatchlist(
  leagueId: string,
  watchlist: string[]
): Promise<Player[]> {
  if (!watchlist || watchlist.length === 0) return [];
  const players: Player[] = [];
  for (const playerId of watchlist) {
    const available = await isPlayerAvailable(leagueId, playerId);
    if (!available) continue;
    const p = await getPlayer(playerId);
    if (p) players.push(p);
  }
  return players;
}

function getNextTeamIndex(
  pickNumber: number,
  teamsCount: number,
  orderType: 'SNAKE' | 'LINEAR'
): number {
  const round = Math.ceil(pickNumber / teamsCount);
  const positionInRound = ((pickNumber - 1) % teamsCount) + 1;

  if (orderType === 'SNAKE' && round % 2 === 0) {
    // Even rounds reverse order
    return teamsCount - positionInRound;
  }

  return positionInRound - 1; // Zero-indexed
}

async function setActiveDraft(leagueId: string, active: boolean): Promise<void> {
  const ref = db.collection('activeDrafts').doc(leagueId);
  if (active) {
    await ref.set({ leagueId, active: true, updatedAt: Timestamp.now() }, { merge: true });
  } else {
    await ref.delete().catch(() => undefined);
  }
}

async function logDraftEvent(leagueId: string, type: string, data: Record<string, unknown>): Promise<void> {
  const ref = db
    .collection('leagues').doc(leagueId)
    .collection('draftLogs').doc();
  await ref.set({ type, data, createdAt: Timestamp.now() });
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
    if (typeof numFromSettings === 'number' && Number.isFinite(numFromSettings) && numFromSettings > 0) {
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

function clampPercent(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

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

    const indexRef = db.collection('leagues').doc(leagueId).collection('availablePlayers').doc(playerId);
    // Merge-only update; do not clobber tier/position, etc.
    await indexRef.set({
      available,
      ownershipPercent,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

export const backfillOwnershipPercent = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    try {
      // AuthN/AuthZ: require either valid INTERNAL_TASK_SECRET (constant-time) or admin Firebase ID token
      const internalSecret = process.env.INTERNAL_TASK_SECRET || '';
      const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
      const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
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
        } catch (e) {
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
      const ownershipSnap = await db.collection('leagues').doc(leagueId).collection('playerOwnerships').select('owners', 'teamId').get();
      const ownershipMap = new Map<string, number>();
      ownershipSnap.forEach((doc) => {
        const data = doc.data() as any;
        const ownersCount = Array.isArray(data?.owners) ? data.owners.length : 1;
        ownershipMap.set(doc.id, ownersCount);
      });

      // Iterate availablePlayers index and update ownershipPercent + available
      const indexSnap = await db.collection('leagues').doc(leagueId).collection('availablePlayers').get();
      const batch = db.batch();
      indexSnap.forEach((doc) => {
        const ownersCount = ownershipMap.get(doc.id) || 0;
        const available = ownersCount === 0;
        const ownershipPercent = clampPercent((ownersCount / safeTeams) * 100);
        batch.set(doc.ref, { available, ownershipPercent, updatedAt: Timestamp.now() }, { merge: true });
      });

      await batch.commit();
      res.status(200).json({ updated: indexSnap.size, teamCount: safeTeams });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Internal error' });
    }
  });

// Helper: robust ALREADY_EXISTS detection for Firestore
function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.status ?? '';
  const codeStr = typeof code === 'number' ? String(code) : String(code || '').toUpperCase();
  return codeStr === '6' || codeStr === 'ALREADY_EXISTS' || /ALREADY[-_ ]?EXISTS/i.test(String((err as any)?.message || ''));
}
