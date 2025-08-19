"use strict";
/**
 * Serverless Draft Worker - Firebase Functions Implementation
 * Handles automated draft processing with league isolation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processWaivers = exports.onTradeUpdate = exports.onDraftPickMade = exports.processDraftPicks = void 0;
const functions = __importStar(require("firebase-functions"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
// Initialize Firebase Admin
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
/**
 * Scheduled function to process auto-draft picks
 * Runs every 30 seconds during active drafts
 */
exports.processDraftPicks = functions.pubsub
    .schedule('every 30 seconds')
    .timeZone('Australia/Sydney')
    .onRun(async () => {
    functions.logger.info('Starting draft processing cycle');
    try {
        const activeDrafts = await getActiveDrafts();
        functions.logger.info(`Found ${activeDrafts.length} active drafts`);
        const results = await Promise.allSettled(activeDrafts.map(leagueId => processLeagueDraft(leagueId)));
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        functions.logger.info(`Draft processing complete: ${successful} successful, ${failed} failed`);
    }
    catch (error) {
        functions.logger.error('Draft processing cycle failed:', error);
    }
});
/**
 * Real-time trigger when a draft pick is made manually
 */
exports.onDraftPickMade = functions.firestore
    .document('leagues/{leagueId}/draft/picks/{pickId}')
    .onWrite(async (change, context) => {
    const { leagueId, pickId } = context.params;
    const pickData = change.after.data();
    if (!(pickData === null || pickData === void 0 ? void 0 : pickData.playerId)) {
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
    }
    catch (error) {
        functions.logger.error(`Failed to process pick ${pickId}:`, error);
    }
});
/**
 * Trigger when trade is proposed or responded to
 */
exports.onTradeUpdate = functions.firestore
    .document('leagues/{leagueId}/trades/{tradeId}')
    .onWrite(async (change, context) => {
    const { leagueId, tradeId } = context.params;
    const tradeData = change.after.data();
    if (!tradeData)
        return;
    try {
        switch (tradeData.status) {
            case 'PROPOSED':
                await handleTradeProposal(leagueId, tradeId);
                break;
            case 'ACCEPTED':
                await processAcceptedTrade(leagueId, tradeId, tradeData);
                break;
            case 'REJECTED':
                await notifyTradeRejection(leagueId);
                break;
        }
    }
    catch (error) {
        functions.logger.error(`Trade processing failed for ${tradeId}:`, error);
    }
});
/**
 * Daily waiver processing
 */
exports.processWaivers = functions.pubsub
    .schedule('0 2 * * *') // 2 AM daily
    .timeZone('Australia/Sydney')
    .onRun(async () => {
    functions.logger.info('Starting daily waiver processing');
    try {
        const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
        const results = await Promise.allSettled(leaguesWithWaivers.map(leagueId => processLeagueWaivers(leagueId)));
        const successful = results.filter(r => r.status === 'fulfilled').length;
        functions.logger.info(`Waiver processing complete: ${successful}/${leaguesWithWaivers.length} leagues processed`);
    }
    catch (error) {
        functions.logger.error('Waiver processing failed:', error);
    }
});
// Core draft processing functions
async function getActiveDrafts() {
    const snapshot = await db
        .collectionGroup('config')
        .where('draftStatus', '==', 'ACTIVE')
        .get();
    return snapshot.docs.map(doc => {
        const pathParts = doc.ref.path.split('/');
        return pathParts[1]; // Extract leagueId from path
    });
}
async function processLeagueDraft(leagueId) {
    var _a;
    const currentPick = await getCurrentDraftPick(leagueId);
    if (!currentPick) {
        functions.logger.info(`No active pick for league ${leagueId}`);
        return;
    }
    const timeExpired = Date.now() - (((_a = currentPick.pickTime) === null || _a === void 0 ? void 0 : _a.toMillis()) || 0) > (currentPick.timeRemaining * 1000);
    if (timeExpired || currentPick.isAutoPick) {
        functions.logger.info(`Processing auto-draft for league ${leagueId}, pick ${currentPick.pickNumber}`);
        await executeAutoDraftPick(leagueId, currentPick);
    }
}
async function getCurrentDraftPick(leagueId) {
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
    return Object.assign({ id: doc.id }, doc.data());
}
async function executeAutoDraftPick(leagueId, pick) {
    try {
        // Get user's draft preferences
        const preferences = await getUserDraftPreferences(leagueId, pick.userId);
        // Select best available player
        const selectedPlayer = await selectBestAvailablePlayer(leagueId, preferences, pick.round);
        // Execute the pick with batch write
        const batch = db.batch();
        // Update the pick
        const pickRef = db
            .collection('leagues').doc(leagueId)
            .collection('draft').doc('picks')
            .collection('active').doc(pick.id);
        batch.update(pickRef, {
            playerId: selectedPlayer.id,
            pickTime: firestore_1.Timestamp.now(),
            isAutoPick: true,
            updatedAt: firestore_1.Timestamp.now()
        });
        // Update the roster
        const rosterRef = db
            .collection('leagues').doc(leagueId)
            .collection('rosters').doc(pick.teamId);
        batch.update(rosterRef, {
            playerIds: firestore_1.FieldValue.arrayUnion(selectedPlayer.id),
            updatedAt: firestore_1.Timestamp.now()
        });
        // Update player availability
        const playerRef = db.collection('players').doc(selectedPlayer.id);
        batch.update(playerRef, {
            [`leagueAvailability.${leagueId}`]: false,
            updatedAt: firestore_1.Timestamp.now()
        });
        await batch.commit();
        functions.logger.info(`Auto-drafted ${selectedPlayer.name} for user ${pick.userId} in league ${leagueId}`);
        // Advance to next pick
        await advanceToNextPick(leagueId);
    }
    catch (error) {
        functions.logger.error(`Auto-draft failed for pick ${pick.id}:`, error);
        // Fallback: pick highest-ranked available player
        await executeDefaultDraftPick(leagueId, pick);
    }
}
async function getUserDraftPreferences(leagueId, userId) {
    const doc = await db
        .collection('leagues').doc(leagueId)
        .collection('members').doc(userId)
        .get();
    const data = doc.data();
    return (data === null || data === void 0 ? void 0 : data.draftPreferences) || {
        watchlist: [],
        autoDraftEnabled: true,
        draftStrategy: 'BALANCED',
        priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
        maxDraftTime: 90
    };
}
async function selectBestAvailablePlayer(leagueId, preferences, round) {
    // First, try to pick from user's watchlist
    const watchlistPlayers = await getAvailablePlayersFromWatchlist(leagueId, preferences.watchlist);
    if (watchlistPlayers.length > 0) {
        return watchlistPlayers[0]; // Top of watchlist
    }
    // Fallback to best available by strategy
    const availablePlayers = await getAvailablePlayersByStrategy(leagueId, preferences.draftStrategy, preferences.priorityPositions, round);
    if (availablePlayers.length === 0) {
        throw new Error('No available players found');
    }
    return availablePlayers[0];
}
async function getAvailablePlayersFromWatchlist(leagueId, watchlist) {
    if (watchlist.length === 0)
        return [];
    const players = [];
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
async function getAvailablePlayersByStrategy(leagueId, strategy, priorityPositions, round) {
    let query = db.collection('players')
        .where(`leagueAvailability.${leagueId}`, '!=', false)
        .orderBy('tier')
        .orderBy('averagePoints', 'desc');
    // Adjust strategy based on round
    if (round <= 3) {
        // Early rounds: focus on elite players
        query = query.where('tier', '<=', 2);
    }
    else if (round <= 8) {
        // Mid rounds: balanced approach
        query = query.where('tier', '<=', 4);
    }
    // Apply position priority
    if (priorityPositions.length > 0 && round <= 10) {
        query = query.where('position', 'in', priorityPositions.slice(0, 10)); // Firestore limit
    }
    const snapshot = await query.limit(50).get();
    return snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
}
async function isPlayerAvailable(leagueId, playerId) {
    var _a;
    const doc = await db.collection('players').doc(playerId).get();
    const data = doc.data();
    return ((_a = data === null || data === void 0 ? void 0 : data.leagueAvailability) === null || _a === void 0 ? void 0 : _a[leagueId]) !== false;
}
async function getPlayer(playerId) {
    const doc = await db.collection('players').doc(playerId).get();
    if (!doc.exists)
        return null;
    return Object.assign({ id: doc.id }, doc.data());
}
async function executeDefaultDraftPick(leagueId, pick) {
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
    const player = Object.assign({ id: snapshot.docs[0].id }, snapshot.docs[0].data());
    const batch = db.batch();
    const pickRef = db
        .collection('leagues').doc(leagueId)
        .collection('draft').doc('picks')
        .collection('active').doc(pick.id);
    batch.update(pickRef, {
        playerId: player.id,
        pickTime: firestore_1.Timestamp.now(),
        isAutoPick: true,
        updatedAt: firestore_1.Timestamp.now()
    });
    const rosterRef = db
        .collection('leagues').doc(leagueId)
        .collection('rosters').doc(pick.teamId);
    batch.update(rosterRef, {
        playerIds: firestore_1.FieldValue.arrayUnion(player.id),
        updatedAt: firestore_1.Timestamp.now()
    });
    await batch.commit();
    functions.logger.info(`Default pick executed: ${player.name} for league ${leagueId}`);
}
async function advanceToNextPick(leagueId) {
    const leagueSettings = await getLeagueSettings(leagueId);
    const currentPick = await getCurrentDraftPick(leagueId);
    if (!currentPick || !leagueSettings)
        return;
    const nextPickNumber = currentPick.pickNumber + 1;
    const totalPicks = leagueSettings.teamsCount * leagueSettings.totalRounds;
    if (nextPickNumber > totalPicks) {
        // Draft is complete
        await completeDraft(leagueId);
        return;
    }
    // Calculate next pick details
    const nextRound = Math.ceil(nextPickNumber / leagueSettings.teamsCount);
    const nextTeamIndex = getNextTeamIndex(nextPickNumber, leagueSettings.teamsCount, leagueSettings.draftOrderType);
    // Create next pick
    await createNextDraftPick(leagueId, {
        pickNumber: nextPickNumber,
        round: nextRound,
        teamIndex: nextTeamIndex,
        timeLimit: leagueSettings.pickTimeLimit
    });
}
function getNextTeamIndex(pickNumber, teamsCount, orderType) {
    const round = Math.ceil(pickNumber / teamsCount);
    const positionInRound = ((pickNumber - 1) % teamsCount) + 1;
    if (orderType === 'SNAKE' && round % 2 === 0) {
        // Even rounds go in reverse order for snake draft
        return teamsCount - positionInRound;
    }
    return positionInRound - 1; // Zero-indexed
}
async function createNextDraftPick(leagueId, pickDetails) {
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
        pickTime: firestore_1.Timestamp.now(),
        createdAt: firestore_1.Timestamp.now(),
        leagueId,
        draftId: `${leagueId}-draft`
    });
    functions.logger.info(`Created next pick ${pickDetails.pickNumber} for team ${team.id} in league ${leagueId}`);
}
async function getLeagueSettings(leagueId) {
    const doc = await db
        .collection('leagues').doc(leagueId)
        .collection('config').doc('settings')
        .get();
    return doc.exists ? doc.data() : null;
}
async function getLeagueTeams(leagueId) {
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
async function completeDraft(leagueId) {
    await db
        .collection('leagues').doc(leagueId)
        .collection('config').doc('settings')
        .update({
        draftStatus: 'COMPLETED',
        completedAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now()
    });
    functions.logger.info(`Draft completed for league ${leagueId}`);
    // Notify all league members
    await notifyDraftComplete(leagueId);
}
// Trade processing functions
async function handleTradeProposal(leagueId, tradeId) {
    // Validate trade
    const isValid = await validateTrade();
    if (!isValid) {
        await db
            .collection('leagues').doc(leagueId)
            .collection('trades').doc(tradeId)
            .update({
            status: 'REJECTED',
            rejectionReason: 'Invalid trade configuration',
            updatedAt: firestore_1.Timestamp.now()
        });
        return;
    }
    // Set expiration (72 hours default)
    const expiresAt = firestore_1.Timestamp.fromMillis(Date.now() + (72 * 60 * 60 * 1000));
    await db
        .collection('leagues').doc(leagueId)
        .collection('trades').doc(tradeId)
        .update({
        expiresAt,
        updatedAt: firestore_1.Timestamp.now()
    });
    // Notify trade partner
    await notifyTradePartner(leagueId);
}
async function processAcceptedTrade(leagueId, tradeId, tradeData) {
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
        playerIds: firestore_1.FieldValue.arrayRemove(...tradeData.fromPlayerIds),
        updatedAt: firestore_1.Timestamp.now()
    });
    batch.update(fromRosterRef, {
        playerIds: firestore_1.FieldValue.arrayUnion(...tradeData.toPlayerIds),
        updatedAt: firestore_1.Timestamp.now()
    });
    batch.update(toRosterRef, {
        playerIds: firestore_1.FieldValue.arrayRemove(...tradeData.toPlayerIds),
        updatedAt: firestore_1.Timestamp.now()
    });
    batch.update(toRosterRef, {
        playerIds: firestore_1.FieldValue.arrayUnion(...tradeData.fromPlayerIds),
        updatedAt: firestore_1.Timestamp.now()
    });
    // Mark trade as processed
    const tradeRef = db
        .collection('leagues').doc(leagueId)
        .collection('trades').doc(tradeId);
    batch.update(tradeRef, {
        status: 'PROCESSED',
        processedAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now()
    });
    await batch.commit();
    functions.logger.info(`Trade ${tradeId} processed successfully in league ${leagueId}`);
}
// Waiver processing functions
async function getLeaguesWithPendingWaivers() {
    const snapshot = await db
        .collectionGroup('waivers')
        .where('status', '==', 'PENDING')
        .select() // Only get document IDs
        .get();
    const leagueIds = new Set();
    snapshot.docs.forEach(doc => {
        const pathParts = doc.ref.path.split('/');
        leagueIds.add(pathParts[1]); // Extract leagueId
    });
    return Array.from(leagueIds);
}
async function processLeagueWaivers(leagueId) {
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
            processedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now()
        });
    }
    await batch.commit();
    functions.logger.info(`Processed ${pendingWaivers.length} waivers for league ${leagueId}`);
}
async function getPendingWaivers(leagueId) {
    const snapshot = await db
        .collection('leagues').doc(leagueId)
        .collection('waivers')
        .where('status', '==', 'PENDING')
        .get();
    return snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
}
async function processWaiverClaim(leagueId, waiver, batch) {
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
        playerIds: firestore_1.FieldValue.arrayUnion(waiver.playerId),
        updatedAt: firestore_1.Timestamp.now()
    });
    // Remove dropped player if specified
    if (waiver.dropPlayerId) {
        batch.update(rosterRef, {
            playerIds: firestore_1.FieldValue.arrayRemove(waiver.dropPlayerId),
            updatedAt: firestore_1.Timestamp.now()
        });
    }
    // Update player availability
    const playerRef = db.collection('players').doc(waiver.playerId);
    batch.update(playerRef, {
        [`leagueAvailability.${leagueId}`]: false,
        updatedAt: firestore_1.Timestamp.now()
    });
    return true;
}
// Notification functions (implement based on your notification system)
async function notifyLeagueMembers(leagueId, pickData) {
    // Implement push notifications, email, or in-app notifications
    functions.logger.info(`Notifying league ${leagueId} of pick: ${pickData.playerId}`);
}
async function notifyTradePartner(leagueId) {
    // Implement trade proposal notification
    functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}
async function notifyTradeRejection(leagueId) {
    // Implement trade rejection notification
    functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}
async function notifyDraftComplete(leagueId) {
    // Implement draft completion notification
    functions.logger.info(`Notifying draft completion for league ${leagueId}`);
}
async function validateTrade() {
    // Implement trade validation logic
    // Check roster limits, player eligibility, etc.
    return true;
}
async function updatePlayerAvailability(playerId, isAvailable) {
    // Update global player availability if needed
    functions.logger.info(`Updated player ${playerId} availability: ${isAvailable}`);
}
//# sourceMappingURL=draftWorker.js.map