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
exports.onUserWatchlistUpdate = exports.onTeamRosterUpdate = exports.processWaivers = exports.onTradeUpdate = exports.onDraftPickMade = exports.processDraftPicks = void 0;
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
 * League-specific draft pick listener
 * Triggers only for picks within the specific league
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
    functions.logger.info(`Processing league-specific pick: ${pickData.playerId} for league ${leagueId}`);
    try {
        // League-scoped operations only
        await advanceToNextPick(leagueId);
        // Notify only league members (league-scoped)
        await notifyLeagueMembers(leagueId, pickData);
        // Update player availability for this league only
        await updatePlayerAvailabilityForLeague(leagueId, pickData.playerId, false);
        functions.logger.info(`Successfully processed league-scoped pick ${pickId}`);
    }
    catch (error) {
        functions.logger.error(`Failed to process league-scoped pick ${pickId}:`, error);
    }
});
/**
 * League-specific trade update listener
 * Triggers only for trades within the specific league
 */
exports.onTradeUpdate = functions.firestore
    .document('leagues/{leagueId}/trades/{tradeId}')
    .onWrite(async (change, context) => {
    const { leagueId, tradeId } = context.params;
    const tradeData = change.after.data();
    if (!tradeData)
        return;
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
    }
    catch (error) {
        functions.logger.error(`League-scoped trade processing failed for ${tradeId}:`, error);
    }
});
/**
 * Daily waiver processing - league-scoped
 */
exports.processWaivers = functions.pubsub
    .schedule('0 2 * * *') // 2 AM daily
    .timeZone('Australia/Sydney')
    .onRun(async () => {
    functions.logger.info('Starting daily league-scoped waiver processing');
    try {
        const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
        const results = await Promise.allSettled(leaguesWithWaivers.map(leagueId => processLeagueWaivers(leagueId)));
        const successful = results.filter(r => r.status === 'fulfilled').length;
        functions.logger.info(`League-scoped waiver processing complete: ${successful}/${leaguesWithWaivers.length} leagues processed`);
    }
    catch (error) {
        functions.logger.error('League-scoped waiver processing failed:', error);
    }
});
/**
 * Team-specific roster update listener
 * Triggers only for roster changes within a specific team
 */
exports.onTeamRosterUpdate = functions.firestore
    .document('leagues/{leagueId}/rosters/{teamId}')
    .onUpdate(async (change, context) => {
    const { leagueId, teamId } = context.params;
    const beforeData = change.before.data();
    const afterData = change.after.data();
    functions.logger.info(`Team roster updated: ${teamId} in league ${leagueId}`);
    try {
        // Check for player additions/removals
        const oldPlayerIds = beforeData.playerIds || [];
        const newPlayerIds = afterData.playerIds || [];
        const addedPlayers = newPlayerIds.filter((id) => !oldPlayerIds.includes(id));
        const removedPlayers = oldPlayerIds.filter((id) => !newPlayerIds.includes(id));
        // Update league-specific player availability
        for (const playerId of addedPlayers) {
            await updatePlayerAvailabilityForLeague(leagueId, playerId, false);
        }
        for (const playerId of removedPlayers) {
            await updatePlayerAvailabilityForLeague(leagueId, playerId, true);
        }
        // Notify team members of roster changes
        await notifyTeamRosterChanges(leagueId, teamId, addedPlayers, removedPlayers);
    }
    catch (error) {
        functions.logger.error(`Team roster update processing failed for ${teamId}:`, error);
    }
});
/**
 * User-specific watchlist update listener
 * Triggers only for watchlist changes for a specific user in a league
 */
exports.onUserWatchlistUpdate = functions.firestore
    .document('leagues/{leagueId}/members/{userId}')
    .onUpdate(async (change, context) => {
    var _a, _b;
    const { leagueId, userId } = context.params;
    const beforeData = change.before.data();
    const afterData = change.after.data();
    const oldWatchlist = ((_a = beforeData.draftPreferences) === null || _a === void 0 ? void 0 : _a.watchlist) || [];
    const newWatchlist = ((_b = afterData.draftPreferences) === null || _b === void 0 ? void 0 : _b.watchlist) || [];
    if (JSON.stringify(oldWatchlist) !== JSON.stringify(newWatchlist)) {
        functions.logger.info(`User watchlist updated: ${userId} in league ${leagueId}`);
        try {
            // Validate watchlist players are still available in this league
            await validateUserWatchlistForLeague(leagueId, userId, newWatchlist);
            // Update draft recommendations cache for this user in this league
            await updateUserDraftRecommendations(leagueId, userId);
        }
        catch (error) {
            functions.logger.error(`User watchlist processing failed for ${userId}:`, error);
        }
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
// League-specific trade processing functions
async function handleLeagueTradeProposal(leagueId, tradeId) {
    // Validate trade within league context
    const isValid = await validateTradeForLeague(leagueId);
    if (!isValid) {
        await db
            .collection('leagues').doc(leagueId)
            .collection('trades').doc(tradeId)
            .update({
            status: 'REJECTED',
            rejectionReason: 'Invalid trade configuration for this league',
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
    // Notify trade partner within league
    await notifyLeagueTradePartner(leagueId);
}
async function processAcceptedLeagueTrade(leagueId, tradeId, tradeData) {
    const batch = db.batch();
    // Update rosters within league scope
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
    // Mark trade as processed within league
    const tradeRef = db
        .collection('leagues').doc(leagueId)
        .collection('trades').doc(tradeId);
    batch.update(tradeRef, {
        status: 'PROCESSED',
        processedAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now()
    });
    await batch.commit();
    functions.logger.info(`League trade ${tradeId} processed successfully in league ${leagueId}`);
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
// League-specific notification functions
async function notifyLeagueMembers(leagueId, pickData) {
    // Implement league-scoped push notifications, email, or in-app notifications
    functions.logger.info(`Notifying league ${leagueId} members of pick: ${pickData.playerId}`);
}
async function notifyLeagueTradePartner(leagueId) {
    // Implement league-scoped trade proposal notification
    functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}
async function notifyLeagueTradeRejection(leagueId) {
    // Implement league-scoped trade rejection notification
    functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}
async function notifyDraftComplete(leagueId) {
    // Implement league-scoped draft completion notification
    functions.logger.info(`Notifying draft completion for league ${leagueId}`);
}
// Team-specific notification functions
async function notifyTeamRosterChanges(leagueId, teamId, addedPlayers, removedPlayers) {
    // Implement team-scoped roster change notifications
    functions.logger.info(`Notifying team ${teamId} in league ${leagueId} of roster changes: +${addedPlayers.length}, -${removedPlayers.length}`);
}
// League-specific validation functions
async function validateTradeForLeague(leagueId) {
    // Implement league-specific trade validation logic
    // Check league roster limits, position requirements, etc.
    functions.logger.info(`Validating trade for league ${leagueId}`);
    return true;
}
// League-specific player availability functions
async function updatePlayerAvailabilityForLeague(leagueId, playerId, isAvailable) {
    // Update player availability only for specific league
    const playerRef = db.collection('players').doc(playerId);
    await playerRef.update({
        [`leagueAvailability.${leagueId}`]: isAvailable,
        updatedAt: firestore_1.Timestamp.now()
    });
    functions.logger.info(`Updated player ${playerId} availability in league ${leagueId}: ${isAvailable}`);
}
// User-specific functions
async function validateUserWatchlistForLeague(leagueId, userId, watchlist) {
    // Validate that watchlist players are available in this specific league
    const unavailablePlayers = [];
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
            'draftPreferences.watchlist': firestore_1.FieldValue.arrayRemove(...unavailablePlayers),
            updatedAt: firestore_1.Timestamp.now()
        });
        functions.logger.info(`Removed ${unavailablePlayers.length} unavailable players from ${userId}'s watchlist in league ${leagueId}`);
    }
}
async function updateUserDraftRecommendations(leagueId, userId) {
    // Generate fresh draft recommendations for user in specific league
    try {
        const preferences = await getUserDraftPreferences(leagueId, userId);
        const recommendations = await generateDraftRecommendations(leagueId, preferences);
        await db
            .collection('leagues').doc(leagueId)
            .collection('members').doc(userId)
            .update({
            draftRecommendations: recommendations,
            recommendationsUpdatedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now()
        });
        functions.logger.info(`Updated draft recommendations for user ${userId} in league ${leagueId}`);
    }
    catch (error) {
        functions.logger.error(`Failed to update draft recommendations for ${userId}:`, error);
    }
}
async function generateDraftRecommendations(leagueId, preferences) {
    // Generate league-specific draft recommendations based on user preferences
    const availablePlayers = await getAvailablePlayersByStrategy(leagueId, preferences.draftStrategy, preferences.priorityPositions, 1 // Current round approximation
    );
    return availablePlayers.slice(0, 10).map(player => ({
        playerId: player.id,
        reason: `Recommended based on ${preferences.draftStrategy} strategy`,
        priority: player.tier,
        estimatedValue: player.averagePoints
    }));
}
//# sourceMappingURL=draftWorker.js.map