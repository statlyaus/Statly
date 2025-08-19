/**
 * Serverless Draft Worker - Firebase Functions Implementation
 * Handles automated draft processing with league isolation
 */

import * as functions from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

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
export const processDraftPicks = functions.pubsub
  .schedule('every 30 seconds')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.info('Starting draft processing cycle');
    
    try {
      const activeDrafts = await getActiveDrafts();
      functions.logger.info(`Found ${activeDrafts.length} active drafts`);
      
      const results = await Promise.allSettled(
        activeDrafts.map(leagueId => processLeagueDraft(leagueId))
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      functions.logger.info(`Draft processing complete: ${successful} successful, ${failed} failed`);
      
    } catch (error) {
      functions.logger.error('Draft processing cycle failed:', error);
    }
  });

/**
 * Real-time trigger when a draft pick is made manually
 */
export const onDraftPickMade = functions.firestore
  .document('leagues/{leagueId}/draft/picks/{pickId}')
  .onWrite(async (change, context) => {
    const { leagueId, pickId } = context.params;
    const pickData = change.after.data() as DraftPick | undefined;
    
    if (!pickData?.playerId) {
      functions.logger.info(`Pick ${pickId} in league ${leagueId} not yet made`);
      return;
    }
    
    functions.logger.info(`Processing manual pick: ${pickData.playerId} for league ${leagueId}`);
    
    try {
      // Advance to next pick
      await advanceToNextPick(leagueId);
      
      // Notify league members
      await notifyLeagueMembers(leagueId, pickData);
      
      // Update player availability
      await updatePlayerAvailability(pickData.playerId, false);
      
      functions.logger.info(`Successfully processed pick ${pickId}`);
      
    } catch (error) {
      functions.logger.error(`Failed to process pick ${pickId}:`, error);
    }
  });

/**
 * Trigger when trade is proposed or responded to
 */
export const onTradeUpdate = functions.firestore
  .document('leagues/{leagueId}/trades/{tradeId}')
  .onWrite(async (change, context) => {
    const { leagueId, tradeId } = context.params;
    const tradeData = change.after.data();
    
    if (!tradeData) return;
    
    try {
      switch (tradeData.status) {
        case 'PROPOSED':
          await handleTradeProposal(leagueId, tradeId, tradeData);
          break;
        case 'ACCEPTED':
          await processAcceptedTrade(leagueId, tradeId, tradeData);
          break;
        case 'REJECTED':
          await notifyTradeRejection(leagueId, tradeData);
          break;
      }
    } catch (error) {
      functions.logger.error(`Trade processing failed for ${tradeId}:`, error);
    }
  });

/**
 * Daily waiver processing
 */
export const processWaivers = functions.pubsub
  .schedule('0 2 * * *') // 2 AM daily
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.info('Starting daily waiver processing');
    
    try {
      const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
      
      const results = await Promise.allSettled(
        leaguesWithWaivers.map(leagueId => processLeagueWaivers(leagueId))
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      functions.logger.info(`Waiver processing complete: ${successful}/${leaguesWithWaivers.length} leagues processed`);
      
    } catch (error) {
      functions.logger.error('Waiver processing failed:', error);
    }
  });

// Core draft processing functions

async function getActiveDrafts(): Promise<string[]> {
  const snapshot = await db
    .collectionGroup('config')
    .where('draftStatus', '==', 'ACTIVE')
    .get();
  
  return snapshot.docs.map(doc => {
    const pathParts = doc.ref.path.split('/');
    return pathParts[1]; // Extract leagueId from path
  });
}

async function processLeagueDraft(leagueId: string): Promise<void> {
  const currentPick = await getCurrentDraftPick(leagueId);
  
  if (!currentPick) {
    functions.logger.info(`No active pick for league ${leagueId}`);
    return;
  }
  
  const timeExpired = Date.now() - (currentPick.pickTime?.toMillis() || 0) > (currentPick.timeRemaining * 1000);
  
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
    
    // Execute the pick with batch write
    const batch = db.batch();
    
    // Update the pick
    const pickRef = db
      .collection('leagues').doc(leagueId)
      .collection('draft').doc('picks')
      .collection('active').doc(pick.id);
    
    batch.update(pickRef, {
      playerId: selectedPlayer.id,
      pickTime: Timestamp.now(),
      isAutoPick: true,
      updatedAt: Timestamp.now()
    });
    
    // Update the roster
    const rosterRef = db
      .collection('leagues').doc(leagueId)
      .collection('rosters').doc(pick.teamId);
    
    batch.update(rosterRef, {
      playerIds: FieldValue.arrayUnion(selectedPlayer.id),
      updatedAt: Timestamp.now()
    });
    
    // Update player availability
    const playerRef = db.collection('players').doc(selectedPlayer.id);
    batch.update(playerRef, {
      [`leagueAvailability.${leagueId}`]: false,
      updatedAt: Timestamp.now()
    });
    
    await batch.commit();
    
    functions.logger.info(`Auto-drafted ${selectedPlayer.name} for user ${pick.userId} in league ${leagueId}`);
    
    // Advance to next pick
    await advanceToNextPick(leagueId);
    
  } catch (error) {
    functions.logger.error(`Auto-draft failed for pick ${pick.id}:`, error);
    
    // Fallback: pick highest-ranked available player
    await executeDefaultDraftPick(leagueId, pick);
  }
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

async function selectBestAvailablePlayer(
  leagueId: string,
  preferences: DraftPreferences,
  round: number
): Promise<Player> {
  // First, try to pick from user's watchlist
  const watchlistPlayers = await getAvailablePlayersFromWatchlist(leagueId, preferences.watchlist);
  
  if (watchlistPlayers.length > 0) {
    return watchlistPlayers[0]; // Top of watchlist
  }
  
  // Fallback to best available by strategy
  const availablePlayers = await getAvailablePlayersByStrategy(
    leagueId,
    preferences.draftStrategy,
    preferences.priorityPositions,
    round
  );
  
  if (availablePlayers.length === 0) {
    throw new Error('No available players found');
  }
  
  return availablePlayers[0];
}

async function getAvailablePlayersFromWatchlist(
  leagueId: string,
  watchlist: string[]
): Promise<Player[]> {
  if (watchlist.length === 0) return [];
  
  const players: Player[] = [];
  
  // Check each player in watchlist order
  for (const playerId of watchlist) {
    const isAvailable = await isPlayerAvailable(leagueId, playerId);
    if (isAvailable) {
      const player = await getPlayer(playerId);
      if (player) {
        players.push(player);
      }
    }
  }
  
  return players;
}

async function getAvailablePlayersByStrategy(
  leagueId: string,
  strategy: string,
  priorityPositions: string[],
  round: number
): Promise<Player[]> {
  let query = db.collection('players')
    .where(`leagueAvailability.${leagueId}`, '!=', false)
    .orderBy('tier')
    .orderBy('averagePoints', 'desc');
  
  // Adjust strategy based on round
  if (round <= 3) {
    // Early rounds: focus on elite players
    query = query.where('tier', '<=', 2);
  } else if (round <= 8) {
    // Mid rounds: balanced approach
    query = query.where('tier', '<=', 4);
  }
  
  // Apply position priority
  if (priorityPositions.length > 0 && round <= 10) {
    query = query.where('position', 'in', priorityPositions.slice(0, 10)); // Firestore limit
  }
  
  const snapshot = await query.limit(50).get();
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as Player[];
}

async function isPlayerAvailable(leagueId: string, playerId: string): Promise<boolean> {
  const doc = await db.collection('players').doc(playerId).get();
  const data = doc.data();
  
  return data?.leagueAvailability?.[leagueId] !== false;
}

async function getPlayer(playerId: string): Promise<Player | null> {
  const doc = await db.collection('players').doc(playerId).get();
  
  if (!doc.exists) return null;
  
  return { id: doc.id, ...doc.data() } as Player;
}

async function executeDefaultDraftPick(leagueId: string, pick: DraftPick): Promise<void> {
  // Get highest-ranked available player as fallback
  const snapshot = await db.collection('players')
    .where(`leagueAvailability.${leagueId}`, '!=', false)
    .orderBy('tier')
    .orderBy('averagePoints', 'desc')
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    throw new Error('No players available for default pick');
  }
  
  const player = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Player;
  
  const batch = db.batch();
  
  const pickRef = db
    .collection('leagues').doc(leagueId)
    .collection('draft').doc('picks')
    .collection('active').doc(pick.id);
  
  batch.update(pickRef, {
    playerId: player.id,
    pickTime: Timestamp.now(),
    isAutoPick: true,
    updatedAt: Timestamp.now()
  });
  
  const rosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(pick.teamId);
  
  batch.update(rosterRef, {
    playerIds: FieldValue.arrayUnion(player.id),
    updatedAt: Timestamp.now()
  });
  
  await batch.commit();
  
  functions.logger.info(`Default pick executed: ${player.name} for league ${leagueId}`);
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

function getNextTeamIndex(
  pickNumber: number,
  teamsCount: number,
  orderType: 'SNAKE' | 'LINEAR'
): number {
  const round = Math.ceil(pickNumber / teamsCount);
  const positionInRound = ((pickNumber - 1) % teamsCount) + 1;
  
  if (orderType === 'SNAKE' && round % 2 === 0) {
    // Even rounds go in reverse order for snake draft
    return teamsCount - positionInRound;
  }
  
  return positionInRound - 1; // Zero-indexed
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
    .collection('active').doc();
  
  await pickRef.set({
    pickNumber: pickDetails.pickNumber,
    round: pickDetails.round,
    userId: team.userId,
    teamId: team.id,
    timeRemaining: pickDetails.timeLimit,
    isAutoPick: false,
    pickTime: Timestamp.now(),
    createdAt: Timestamp.now(),
    leagueId,
    draftId: `${leagueId}-draft`
  });
  
  functions.logger.info(`Created next pick ${pickDetails.pickNumber} for team ${team.id} in league ${leagueId}`);
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
  
  functions.logger.info(`Draft completed for league ${leagueId}`);
  
  // Notify all league members
  await notifyDraftComplete(leagueId);
}

// Trade processing functions

async function handleTradeProposal(leagueId: string, tradeId: string, tradeData: any): Promise<void> {
  // Validate trade
  const isValid = await validateTrade(leagueId, tradeData);
  
  if (!isValid) {
    await db
      .collection('leagues').doc(leagueId)
      .collection('trades').doc(tradeId)
      .update({
        status: 'REJECTED',
        rejectionReason: 'Invalid trade configuration',
        updatedAt: Timestamp.now()
      });
    return;
  }
  
  // Set expiration (72 hours default)
  const expiresAt = Timestamp.fromMillis(Date.now() + (72 * 60 * 60 * 1000));
  
  await db
    .collection('leagues').doc(leagueId)
    .collection('trades').doc(tradeId)
    .update({
      expiresAt,
      updatedAt: Timestamp.now()
    });
  
  // Notify trade partner
  await notifyTradePartner(leagueId, tradeData);
}

async function processAcceptedTrade(leagueId: string, tradeId: string, tradeData: any): Promise<void> {
  const batch = db.batch();
  
  // Update rosters
  const fromRosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(tradeData.fromTeamId);
  
  const toRosterRef = db
    .collection('leagues').doc(leagueId)
    .collection('rosters').doc(tradeData.toTeamId);
  
  // Remove players from sending team, add players from receiving team
  batch.update(fromRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  batch.update(fromRosterRef, {
    playerIds: FieldValue.arrayUnion(...tradeData.toPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayRemove(...tradeData.toPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  batch.update(toRosterRef, {
    playerIds: FieldValue.arrayUnion(...tradeData.fromPlayerIds),
    updatedAt: Timestamp.now()
  });
  
  // Mark trade as processed
  const tradeRef = db
    .collection('leagues').doc(leagueId)
    .collection('trades').doc(tradeId);
  
  batch.update(tradeRef, {
    status: 'PROCESSED',
    processedAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });
  
  await batch.commit();
  
  functions.logger.info(`Trade ${tradeId} processed successfully in league ${leagueId}`);
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
  
  for (const waiver of pendingWaivers) {
    const success = await processWaiverClaim(leagueId, waiver, batch);
    
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
  
  return true;
}

// Notification functions (implement based on your notification system)

async function notifyLeagueMembers(leagueId: string, pickData: DraftPick): Promise<void> {
  // Implement push notifications, email, or in-app notifications
  functions.logger.info(`Notifying league ${leagueId} of pick: ${pickData.playerId}`);
}

async function notifyTradePartner(leagueId: string, _tradeData: unknown): Promise<void> {
  // Implement trade proposal notification
  functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}

async function notifyTradeRejection(leagueId: string, _tradeData: unknown): Promise<void> {
  // Implement trade rejection notification
  functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}

async function notifyDraftComplete(leagueId: string): Promise<void> {
  // Implement draft completion notification
  functions.logger.info(`Notifying draft completion for league ${leagueId}`);
}

async function validateTrade(_leagueId: string, _tradeData: unknown): Promise<boolean> {
  // Implement trade validation logic
  // Check roster limits, player eligibility, etc.
  return true;
}

async function updatePlayerAvailability(playerId: string, isAvailable: boolean): Promise<void> {
  // Update global player availability if needed
  functions.logger.info(`Updated player ${playerId} availability: ${isAvailable}`);
}
