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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillOwnershipPercent = exports.processWaiverExpirations = exports.onPlayerOwnershipWrite = exports.onUserWatchlistUpdate = exports.onTeamRosterUpdate = exports.processWaivers = exports.onTradeUpdate = exports.onDraftPickMade = exports.processDraftPicks = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const functions = __importStar(require("firebase-functions/v1"));
// Initialize Firebase Admin
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const REGION = 'australia-southeast1';
// Configurable runtime for the draft worker (tunable without code changes)
const DRAFT_WORKER_MEMORY = (process.env.DRAFT_WORKER_MEMORY ||
    process.env.FUNCTIONS_MEMORY ||
    '1GB'); // '256MB' | '512MB' | '1GB' | '2GB'
const DRAFT_WORKER_TIMEOUT_SECONDS = parseInt(process.env.DRAFT_WORKER_TIMEOUT_SECONDS || process.env.FUNCTIONS_TIMEOUT_SECONDS || '300', 10);
/**
 * Scheduled function to process auto-draft picks
 * Runs every 30 seconds during active drafts
 */
exports.processDraftPicks = functions
    .region(REGION)
    .runWith({
    failurePolicy: true,
    timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS,
    memory: DRAFT_WORKER_MEMORY,
})
    .pubsub.schedule('every 30 seconds')
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
            config: {
                memory: DRAFT_WORKER_MEMORY,
                timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS,
                region: REGION,
            },
        });
    }
    catch (error) {
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
            config: {
                memory: DRAFT_WORKER_MEMORY,
                timeoutSeconds: DRAFT_WORKER_TIMEOUT_SECONDS,
                region: REGION,
            },
        });
    }
});
/**
 * League-specific draft pick listener
 * Triggers only for picks within the specific league
 */
exports.onDraftPickMade = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
    .firestore.document('leagues/{leagueId}/draft/picks/active/{pickId}')
    .onWrite(async (change, context) => {
    var _a;
    const { leagueId, pickId } = context.params;
    // Process only when playerId transitions from empty to a value
    if (!change.after.exists)
        return;
    const beforeData = change.before.exists
        ? change.before.data()
        : undefined;
    const pickData = (_a = change.after.data()) !== null && _a !== void 0 ? _a : undefined;
    // Process only when playerId transitions from empty to a value
    if (!(pickData === null || pickData === void 0 ? void 0 : pickData.playerId) || (beforeData === null || beforeData === void 0 ? void 0 : beforeData.playerId) === pickData.playerId) {
        functions.logger.info(`No actionable change for pick ${pickId} in league ${leagueId}`, {
            leagueId,
            pickId,
        });
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
        functions.logger.info(`Successfully processed league-scoped pick ${pickId}`, {
            leagueId,
            pickId,
        });
    }
    catch (error) {
        functions.logger.error(`Failed to process league-scoped pick ${pickId}:`, {
            leagueId,
            pickId,
            error,
        });
        await logDraftEvent(leagueId, 'PICK_PROCESS_FAILED', { pickId, error: String(error) });
    }
});
/**
 * League-specific trade update listener
 * Triggers only for trades within the specific league
 */
exports.onTradeUpdate = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
    .firestore.document('leagues/{leagueId}/trades/{tradeId}')
    .onWrite(async (change, context) => {
    var _a;
    const { leagueId, tradeId } = context.params;
    const tradeData = (_a = change.after.data()) !== null && _a !== void 0 ? _a : null;
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
exports.processWaivers = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 300, memory: '512MB' })
    .pubsub.schedule('0 2 * * *') // 2 AM daily
    .timeZone('Australia/Sydney')
    .onRun(async () => {
    functions.logger.info('Starting daily league-scoped waiver processing');
    try {
        const leaguesWithWaivers = await getLeaguesWithPendingWaivers();
        const results = await Promise.allSettled(leaguesWithWaivers.map((leagueId) => processLeagueWaivers(leagueId)));
        const successful = results.filter((r) => r.status === 'fulfilled').length;
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
exports.onTeamRosterUpdate = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
    .firestore.document('leagues/{leagueId}/rosters/{teamId}')
    .onUpdate(async (change, context) => {
    var _a, _b;
    const { leagueId, teamId } = context.params;
    const beforeData = (_a = change.before.data()) !== null && _a !== void 0 ? _a : {};
    const afterData = (_b = change.after.data()) !== null && _b !== void 0 ? _b : {};
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
exports.onUserWatchlistUpdate = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
    .firestore.document('leagues/{leagueId}/members/{userId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d;
    const { leagueId, userId } = context.params;
    const beforeData = (_a = change.before.data()) !== null && _a !== void 0 ? _a : {};
    const afterData = (_b = change.after.data()) !== null && _b !== void 0 ? _b : {};
    const oldWatchlist = ((_c = beforeData.draftPreferences) === null || _c === void 0 ? void 0 : _c.watchlist) || [];
    const newWatchlist = ((_d = afterData.draftPreferences) === null || _d === void 0 ? void 0 : _d.watchlist) || [];
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
        }
        catch (error) {
            functions.logger.error(`User watchlist processing failed for ${userId}:`, error);
        }
    }
});
// Core draft processing functions
async function getActiveDrafts() {
    const snapshot = await db.collection('activeDrafts').select().get();
    return snapshot.docs.map((d) => d.id);
}
async function processLeagueDraft(leagueId) {
    var _a;
    const currentPick = await getCurrentDraftPick(leagueId);
    if (!currentPick) {
        functions.logger.info(`No active pick for league ${leagueId}`);
        return;
    }
    const now = Date.now();
    let pickMillis = ((_a = currentPick.pickTime) === null || _a === void 0 ? void 0 : _a.toMillis()) || now;
    if (pickMillis > now)
        pickMillis = now; // clamp to avoid future pickTime
    const timeExpired = currentPick.deadlineAt
        ? now > currentPick.deadlineAt.toMillis()
        : now - pickMillis > currentPick.timeRemaining * 1000;
    if (timeExpired || currentPick.isAutoPick) {
        functions.logger.info(`Processing auto-draft for league ${leagueId}, pick ${currentPick.pickNumber}`);
        await executeAutoDraftPick(leagueId, currentPick);
    }
}
async function getCurrentDraftPick(leagueId) {
    const snapshot = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('draft')
        .doc('picks')
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
async function getAvailablePlayersByStrategy(leagueId, strategy, priorityPositions, round) {
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
    }
    else if (round <= 8) {
        query = query.where('tier', '<=', 4);
    }
    if (priorityPositions.length > 0 && round <= 10) {
        query = query.where('position', 'in', priorityPositions.slice(0, 10));
    }
    const snapshot = await query.limit(50).get();
    const playerIds = snapshot.docs.map((d) => d.id);
    if (playerIds.length === 0)
        return [];
    const playerDocs = await Promise.all(playerIds.map((id) => db.collection('players').doc(id).get()));
    return playerDocs
        .filter((d) => d.exists)
        .map((d) => (Object.assign({ id: d.id }, d.data())));
}
async function isPlayerAvailable(leagueId, playerId) {
    var _a, _b;
    const indexDoc = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('availablePlayers')
        .doc(playerId)
        .get();
    if (indexDoc.exists) {
        const available = (_a = indexDoc.data()) === null || _a === void 0 ? void 0 : _a.available;
        return available === true;
    }
    // Fallback to legacy field
    const doc = await db.collection('players').doc(playerId).get();
    const data = doc.data();
    return ((_b = data === null || data === void 0 ? void 0 : data.leagueAvailability) === null || _b === void 0 ? void 0 : _b[leagueId]) !== false;
}
async function executeAutoDraftPick(leagueId, pick) {
    try {
        // Get user's draft preferences
        const preferences = await getUserDraftPreferences(leagueId, pick.userId);
        // Select best available player
        const selectedPlayer = await selectBestAvailablePlayer(leagueId, preferences, pick.round);
        // Execute the pick transactionally
        const pickRef = db
            .collection('leagues')
            .doc(leagueId)
            .collection('draft')
            .doc('picks')
            .collection('active')
            .doc(pick.id);
        const rosterRef = db.collection('leagues').doc(leagueId).collection('rosters').doc(pick.teamId);
        const playerRef = db.collection('players').doc(selectedPlayer.id);
        await db.runTransaction(async (tx) => {
            var _a;
            const pickSnap = await tx.get(pickRef);
            if (!pickSnap.exists)
                throw new Error('Pick no longer exists');
            const pickData = pickSnap.data();
            if (pickData.playerId) {
                throw new Error('Pick already assigned');
            }
            const playerSnap = await tx.get(playerRef);
            const playerData = playerSnap.data();
            if (((_a = playerData === null || playerData === void 0 ? void 0 : playerData.leagueAvailability) === null || _a === void 0 ? void 0 : _a[leagueId]) === false) {
                throw new Error('Player no longer available');
            }
            tx.update(pickRef, {
                playerId: selectedPlayer.id,
                pickTime: firestore_1.Timestamp.now(),
                isAutoPick: true,
                updatedAt: firestore_1.Timestamp.now(),
            });
            tx.update(rosterRef, {
                playerIds: firestore_1.FieldValue.arrayUnion(selectedPlayer.id),
                updatedAt: firestore_1.Timestamp.now(),
            });
            tx.update(playerRef, {
                [`leagueAvailability.${leagueId}`]: false,
                updatedAt: firestore_1.Timestamp.now(),
            });
            // Update per-league availability index inside the same transaction
            const indexRef = db
                .collection('leagues')
                .doc(leagueId)
                .collection('availablePlayers')
                .doc(selectedPlayer.id);
            tx.set(indexRef, { available: false, updatedAt: firestore_1.Timestamp.now() }, { merge: true });
        });
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
async function executeDefaultDraftPick(leagueId, pick) {
    // Get highest-ranked available player from league index as fallback
    const snapshot = await db
        .collection('leagues')
        .doc(leagueId)
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
        .collection('leagues')
        .doc(leagueId)
        .collection('draft')
        .doc('picks')
        .collection('active')
        .doc(pick.id);
    const rosterRef = db.collection('leagues').doc(leagueId).collection('rosters').doc(pick.teamId);
    await db.runTransaction(async (tx) => {
        var _a;
        const pickSnap = await tx.get(pickRef);
        if (!pickSnap.exists)
            throw new Error('Pick no longer exists');
        const pickData = pickSnap.data();
        if (pickData.playerId)
            throw new Error('Pick already assigned');
        const playerSnap = await tx.get(playerRef);
        const playerData = playerSnap.data();
        if (((_a = playerData === null || playerData === void 0 ? void 0 : playerData.leagueAvailability) === null || _a === void 0 ? void 0 : _a[leagueId]) === false) {
            throw new Error('Player no longer available');
        }
        tx.update(pickRef, {
            playerId: playerId,
            pickTime: firestore_1.Timestamp.now(),
            isAutoPick: true,
            updatedAt: firestore_1.Timestamp.now(),
        });
        tx.update(rosterRef, {
            playerIds: firestore_1.FieldValue.arrayUnion(playerId),
            updatedAt: firestore_1.Timestamp.now(),
        });
        tx.update(playerRef, {
            [`leagueAvailability.${leagueId}`]: false,
            updatedAt: firestore_1.Timestamp.now(),
        });
        // Update per-league availability index inside the same transaction
        const indexRef = db
            .collection('leagues')
            .doc(leagueId)
            .collection('availablePlayers')
            .doc(playerId);
        tx.set(indexRef, { available: false, updatedAt: firestore_1.Timestamp.now() }, { merge: true });
    });
    functions.logger.info(`Default pick executed for league ${leagueId}`);
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
        timeLimit: leagueSettings.pickTimeLimit,
    });
}
async function createNextDraftPick(leagueId, pickDetails) {
    const teams = await getLeagueTeams(leagueId);
    const team = teams[pickDetails.teamIndex];
    if (!team) {
        throw new Error(`No team found at index ${pickDetails.teamIndex}`);
    }
    const pickRef = db
        .collection('leagues')
        .doc(leagueId)
        .collection('draft')
        .doc('picks')
        .collection('active')
        .doc(String(pickDetails.pickNumber));
    const now = Date.now();
    const deadlineAt = firestore_1.Timestamp.fromMillis(now + pickDetails.timeLimit * 1000);
    try {
        await pickRef.create({
            pickNumber: pickDetails.pickNumber,
            round: pickDetails.round,
            userId: team.userId,
            teamId: team.id,
            timeRemaining: pickDetails.timeLimit,
            isAutoPick: false,
            pickTime: firestore_1.Timestamp.now(),
            deadlineAt,
            createdAt: firestore_1.Timestamp.now(),
            leagueId,
            draftId: `${leagueId}-draft`,
        });
        await setActiveDraft(leagueId, true);
        functions.logger.info(`Created next pick ${pickDetails.pickNumber} for team ${team.id} in league ${leagueId}`, { leagueId, pickNumber: pickDetails.pickNumber });
    }
    catch (e) {
        if (isAlreadyExistsError(e)) {
            functions.logger.info(`Next pick ${pickDetails.pickNumber} already exists for league ${leagueId}`, { leagueId, pickNumber: pickDetails.pickNumber });
        }
        else {
            throw e;
        }
    }
}
async function getLeagueSettings(leagueId) {
    const doc = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('config')
        .doc('settings')
        .get();
    return doc.exists ? doc.data() : null;
}
async function getLeagueTeams(leagueId) {
    const snapshot = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('rosters')
        .orderBy('draftOrder')
        .get();
    return snapshot.docs.map((doc) => ({
        id: doc.id,
        userId: doc.data().userId,
    }));
}
async function completeDraft(leagueId) {
    await db.collection('leagues').doc(leagueId).collection('config').doc('settings').update({
        draftStatus: 'COMPLETED',
        completedAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now(),
    });
    await setActiveDraft(leagueId, false);
    functions.logger.info(`Draft completed for league ${leagueId}`, { leagueId });
    // Initialize league available player pool with post-draft waiver period
    await initializeAvailablePlayerPool(leagueId).catch((e) => functions.logger.warn('initializeAvailablePlayerPool failed', { leagueId, error: String(e) }));
    // Notify all league members
    await notifyDraftComplete(leagueId);
}
// League-specific trade processing functions
async function handleLeagueTradeProposal(leagueId, tradeId) {
    // Validate trade within league context
    const isValid = await validateTradeForLeague(leagueId);
    if (!isValid) {
        await db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId).update({
            status: 'REJECTED',
            rejectionReason: 'Invalid trade configuration for this league',
            updatedAt: firestore_1.Timestamp.now(),
        });
        return;
    }
    // Set expiration (72 hours default)
    const tradeExpiresAt = firestore_1.Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000);
    await db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId).update({
        expiresAt: tradeExpiresAt,
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Notify trade partner within league
    await notifyLeagueTradePartner(leagueId);
}
async function processAcceptedLeagueTrade(leagueId, tradeId, tradeData) {
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
        playerIds: firestore_1.FieldValue.arrayRemove(...tradeData.fromPlayerIds),
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Remove players from receiving team who are being sent away
    batch.update(toRosterRef, {
        playerIds: firestore_1.FieldValue.arrayRemove(...tradeData.toPlayerIds),
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Add players to receiving team
    batch.update(toRosterRef, {
        playerIds: firestore_1.FieldValue.arrayUnion(...tradeData.fromPlayerIds),
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Mark trade as processed within league
    const tradeRef = db.collection('leagues').doc(leagueId).collection('trades').doc(tradeId);
    batch.update(tradeRef, {
        status: 'PROCESSED',
        processedAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now(),
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
    snapshot.docs.forEach((doc) => {
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
    const successfulClaims = [];
    for (const waiver of pendingWaivers) {
        const success = await processWaiverClaim(leagueId, waiver, batch);
        if (success)
            successfulClaims.push(waiver.playerId);
        const waiverRef = db.collection('leagues').doc(leagueId).collection('waivers').doc(waiver.id);
        batch.update(waiverRef, {
            status: success ? 'SUCCESSFUL' : 'UNSUCCESSFUL',
            processedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
    }
    await batch.commit();
    // Update availability index for successful claims
    await Promise.all(successfulClaims.map((pid) => updatePlayerAvailabilityForLeague(leagueId, pid, false)));
    functions.logger.info(`Processed ${pendingWaivers.length} waivers for league ${leagueId}`);
}
async function getPendingWaivers(leagueId) {
    const snapshot = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('waivers')
        .where('status', '==', 'PENDING')
        .get();
    return snapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
}
async function processWaiverClaim(leagueId, waiver, batch) {
    // Check if player is still available
    const isAvailable = await isPlayerAvailable(leagueId, waiver.playerId);
    if (!isAvailable) {
        return false; // Player already claimed
    }
    // Add player to roster
    const rosterRef = db.collection('leagues').doc(leagueId).collection('rosters').doc(waiver.teamId);
    batch.update(rosterRef, {
        playerIds: firestore_1.FieldValue.arrayUnion(waiver.playerId),
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Remove dropped player if specified
    if (waiver.dropPlayerId) {
        batch.update(rosterRef, {
            playerIds: firestore_1.FieldValue.arrayRemove(waiver.dropPlayerId),
            updatedAt: firestore_1.Timestamp.now(),
        });
    }
    // Update player availability
    const playerRef = db.collection('players').doc(waiver.playerId);
    batch.update(playerRef, {
        [`leagueAvailability.${leagueId}`]: false,
        updatedAt: firestore_1.Timestamp.now(),
    });
    // Also update availability index (outside batch by caller after commit)
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
async function initializeAvailablePlayerPool(leagueId) {
    var _a, _b;
    // Determine waiver period (hours). Default to 24 if not configured.
    let waiverHours = 24;
    try {
        const settingsDoc = await db
            .collection('leagues')
            .doc(leagueId)
            .collection('config')
            .doc('settings')
            .get();
        const data = settingsDoc.data();
        const configured = Number((_b = (_a = data === null || data === void 0 ? void 0 : data.waiverRules) === null || _a === void 0 ? void 0 : _a.waiverPeriodHours) !== null && _b !== void 0 ? _b : data === null || data === void 0 ? void 0 : data.waiverPeriodHours);
        if (Number.isFinite(configured) && configured > 0 && configured < 7 * 24) {
            waiverHours = configured;
        }
    }
    catch (_) { }
    // Build a set of owned playerIds from rosters
    const owned = new Set();
    const rostersSnap = await db.collection('leagues').doc(leagueId).collection('rosters').get();
    rostersSnap.forEach((doc) => {
        var _a;
        const ids = Array.isArray((_a = doc.data()) === null || _a === void 0 ? void 0 : _a.playerIds)
            ? doc.data().playerIds
            : [];
        ids.forEach((pid) => owned.add(String(pid)));
    });
    const waiverUntil = firestore_1.Timestamp.fromMillis(Date.now() + waiverHours * 60 * 60 * 1000);
    // Iterate players collection in pages to initialize availablePlayers index
    let lastDoc = undefined;
    // Cap page size to avoid memory spikes
    const pageSize = 500;
    // Safety guard to prevent runaway loops
    let pages = 0;
    while (true) {
        let query = db.collection('players').orderBy('__name__');
        if (lastDoc)
            query = query.startAfter(lastDoc);
        const snap = await query.limit(pageSize).get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((doc) => {
            var _a, _b, _c;
            const playerId = doc.id;
            if (owned.has(playerId))
                return; // skip drafted players
            const pdata = doc.data();
            const ref = db
                .collection('leagues')
                .doc(leagueId)
                .collection('availablePlayers')
                .doc(playerId);
            batch.set(ref, {
                available: true,
                status: 'WAIVERS',
                waiverUntil,
                tier: (_a = pdata === null || pdata === void 0 ? void 0 : pdata.tier) !== null && _a !== void 0 ? _a : 999,
                averagePoints: (_b = pdata === null || pdata === void 0 ? void 0 : pdata.averagePoints) !== null && _b !== void 0 ? _b : 0,
                position: (_c = pdata === null || pdata === void 0 ? void 0 : pdata.position) !== null && _c !== void 0 ? _c : 'UNK',
                updatedAt: firestore_1.Timestamp.now(),
            }, { merge: true });
        });
        await batch.commit();
        lastDoc = snap.docs[snap.docs.length - 1];
        pages += 1;
        if (pages > 200)
            break; // guard against runaway
    }
    functions.logger.info('Initialized available player pool post-draft', {
        leagueId,
        waiverHours,
    });
}
async function updatePlayerAvailabilityForLeague(leagueId, playerId, isAvailable) {
    var _a, _b, _c;
    // Update player availability only for specific league
    const playerRef = db.collection('players').doc(playerId);
    await playerRef.update({
        [`leagueAvailability.${leagueId}`]: isAvailable,
        updatedAt: firestore_1.Timestamp.now(),
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
        const pdata = snap.data();
        await indexRef.set({
            available: true,
            tier: (_a = pdata === null || pdata === void 0 ? void 0 : pdata.tier) !== null && _a !== void 0 ? _a : 999,
            averagePoints: (_b = pdata === null || pdata === void 0 ? void 0 : pdata.averagePoints) !== null && _b !== void 0 ? _b : 0,
            position: (_c = pdata === null || pdata === void 0 ? void 0 : pdata.position) !== null && _c !== void 0 ? _c : 'UNK',
            updatedAt: firestore_1.Timestamp.now(),
        }, { merge: true });
    }
    else {
        await indexRef.set({
            available: false,
            updatedAt: firestore_1.Timestamp.now(),
        }, { merge: true });
    }
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
            .collection('leagues')
            .doc(leagueId)
            .collection('members')
            .doc(userId)
            .update({
            'draftPreferences.watchlist': firestore_1.FieldValue.arrayRemove(...unavailablePlayers),
            updatedAt: firestore_1.Timestamp.now(),
        });
        functions.logger.info(`Removed ${unavailablePlayers.length} unavailable players from ${userId}'s watchlist in league ${leagueId}`);
    }
}
async function updateUserDraftRecommendations(leagueId, userId) {
    // Generate fresh draft recommendations for user in specific league
    try {
        const preferences = await getUserDraftPreferences(leagueId, userId);
        const recommendations = await generateDraftRecommendations(leagueId, preferences);
        await db.collection('leagues').doc(leagueId).collection('members').doc(userId).update({
            draftRecommendations: recommendations,
            recommendationsUpdatedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
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
    return availablePlayers.slice(0, 10).map((player) => ({
        playerId: player.id,
        reason: `Recommended based on ${preferences.draftStrategy} strategy`,
        priority: player.tier,
        estimatedValue: player.averagePoints,
    }));
}
async function getUserDraftPreferences(leagueId, userId) {
    const doc = await db.collection('leagues').doc(leagueId).collection('members').doc(userId).get();
    const data = doc.data();
    return ((data === null || data === void 0 ? void 0 : data.draftPreferences) || {
        watchlist: [],
        autoDraftEnabled: true,
        draftStrategy: 'BALANCED',
        priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
        maxDraftTime: 90,
    });
}
async function getPlayer(playerId) {
    const doc = await db.collection('players').doc(playerId).get();
    if (!doc.exists)
        return null;
    return Object.assign({ id: doc.id }, doc.data());
}
async function selectBestAvailablePlayer(leagueId, preferences, round) {
    var _a;
    // First, try to pick from user's watchlist in order
    const watchlistPlayers = await getAvailablePlayersFromWatchlist(leagueId, preferences.watchlist);
    if (watchlistPlayers.length > 0) {
        return watchlistPlayers[0];
    }
    // Fallback to best available by strategy
    const availablePlayers = await getAvailablePlayersByStrategy(leagueId, preferences.draftStrategy, (_a = preferences.priorityPositions) !== null && _a !== void 0 ? _a : [], round);
    if (availablePlayers.length === 0) {
        throw new Error('No available players found for auto-draft');
    }
    return availablePlayers[0];
}
async function getAvailablePlayersFromWatchlist(leagueId, watchlist) {
    if (!watchlist || watchlist.length === 0)
        return [];
    const players = [];
    for (const playerId of watchlist) {
        const available = await isPlayerAvailable(leagueId, playerId);
        if (!available)
            continue;
        const p = await getPlayer(playerId);
        if (p)
            players.push(p);
    }
    return players;
}
function getNextTeamIndex(pickNumber, teamsCount, orderType) {
    const round = Math.ceil(pickNumber / teamsCount);
    const positionInRound = ((pickNumber - 1) % teamsCount) + 1;
    if (orderType === 'SNAKE' && round % 2 === 0) {
        // Even rounds reverse order
        return teamsCount - positionInRound;
    }
    return positionInRound - 1; // Zero-indexed
}
async function setActiveDraft(leagueId, active) {
    const ref = db.collection('activeDrafts').doc(leagueId);
    if (active) {
        await ref.set({ leagueId, active: true, updatedAt: firestore_1.Timestamp.now() }, { merge: true });
    }
    else {
        await ref.delete().catch(() => undefined);
    }
}
async function logDraftEvent(leagueId, type, data) {
    const ref = db.collection('leagues').doc(leagueId).collection('draftLogs').doc();
    await ref.set({ type, data, createdAt: firestore_1.Timestamp.now() });
}
/**
 * Firestore trigger to maintain ownershipPercent and available flag in availablePlayers
 * on changes to playerOwnerships; add HTTP backfill to recompute for a league; include helpers to count teams.
 */
async function getLeagueTeamCount(leagueId) {
    var _a, _b;
    // Prefer explicit settings if stored
    try {
        // Prefer explicit settings if stored
        const leagueDoc = await db.collection('leagues').doc(leagueId).get();
        const numFromSettings = (_b = (_a = leagueDoc.data()) === null || _a === void 0 ? void 0 : _a.settings) === null || _b === void 0 ? void 0 : _b.numTeams;
        if (typeof numFromSettings === 'number' &&
            Number.isFinite(numFromSettings) &&
            numFromSettings > 0) {
            return numFromSettings;
        }
        // Try aggregation count if available
        const rosters = db.collection('leagues').doc(leagueId).collection('rosters');
        const countMethod = rosters.count;
        if (typeof countMethod === 'function') {
            const agg = await countMethod.call(rosters).get();
            const c = agg.data().count;
            if (typeof c === 'number' && Number.isFinite(c) && c > 0)
                return c;
        }
        // Fallback to full get
        const snap = await rosters.get();
        return snap.size || 0;
    }
    catch (e) {
        functions.logger.warn('getLeagueTeamCount failed', { leagueId, error: String(e) });
        return 0;
    }
}
function clampPercent(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
}
exports.onPlayerOwnershipWrite = functions
    .region(REGION)
    .firestore.document('leagues/{leagueId}/playerOwnerships/{playerId}')
    .onWrite(async (change, context) => {
    const { leagueId, playerId } = context.params;
    const after = change.after;
    // Determine owners count from doc shape (supports both single-owner and owners[] variants)
    let ownersCount = 0;
    if (after.exists) {
        const data = after.data();
        if (Array.isArray(data === null || data === void 0 ? void 0 : data.owners))
            ownersCount = data.owners.length;
        else
            ownersCount = 1; // single-owner schema
    }
    else {
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
    await indexRef.set({
        available,
        ownershipPercent,
        updatedAt: firestore_1.Timestamp.now(),
    }, { merge: true });
});
// Scheduled task: promote expired waivers to AVAILABLE
exports.processWaiverExpirations = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 300, memory: '256MB' })
    .pubsub.schedule('every 10 minutes')
    .timeZone('Australia/Sydney')
    .onRun(async () => {
    const now = firestore_1.Timestamp.now();
    try {
        // Scan all leagues' availablePlayers via collection group
        const snap = await db
            .collectionGroup('availablePlayers')
            .where('status', '==', 'WAIVERS')
            .where('waiverUntil', '<=', now)
            .get();
        if (snap.empty)
            return;
        const updatesByLeague = {};
        const batch = db.batch();
        snap.docs.forEach((doc) => {
            // leagueId is the second segment of path: leagues/{leagueId}/availablePlayers/{playerId}
            const parts = doc.ref.path.split('/');
            const leagueId = parts[1] || 'unknown';
            updatesByLeague[leagueId] = (updatesByLeague[leagueId] || 0) + 1;
            batch.set(doc.ref, { status: 'AVAILABLE', updatedAt: firestore_1.Timestamp.now() }, { merge: true });
        });
        await batch.commit();
        functions.logger.info('Processed waiver expirations', { counts: updatesByLeague });
    }
    catch (e) {
        functions.logger.error('processWaiverExpirations failed', { error: String(e) });
    }
});
exports.backfillOwnershipPercent = functions
    .region(REGION)
    .https.onRequest(async (req, res) => {
    var _a, _b, _c;
    try {
        // AuthN/AuthZ: require either valid INTERNAL_TASK_SECRET (constant-time) or admin Firebase ID token
        const internalSecret = process.env.INTERNAL_TASK_SECRET || '';
        const authHeader = (req.headers['authorization'] || req.headers['Authorization']);
        const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice('Bearer '.length)
            : undefined;
        const providedSecret = (_a = req.headers['x-internal-secret']) !== null && _a !== void 0 ? _a : undefined;
        function safeEquals(a, b) {
            if (typeof a !== 'string' || typeof b !== 'string')
                return false;
            const aBuf = Buffer.from(a, 'utf8');
            const bBuf = Buffer.from(b, 'utf8');
            if (aBuf.length !== bBuf.length)
                return false;
            return node_crypto_1.default.timingSafeEqual(aBuf, bBuf);
        }
        let authorized = false;
        if (providedSecret && internalSecret && safeEquals(providedSecret, internalSecret)) {
            authorized = true;
        }
        else if (bearer) {
            try {
                const decoded = await (0, auth_1.getAuth)().verifyIdToken(bearer);
                if ((decoded === null || decoded === void 0 ? void 0 : decoded.admin) === true || ((_c = (_b = decoded === null || decoded === void 0 ? void 0 : decoded.roles) === null || _b === void 0 ? void 0 : _b.includes) === null || _c === void 0 ? void 0 : _c.call(_b, 'admin'))) {
                    authorized = true;
                }
            }
            catch (e) {
                // ignore, will result in 401 unless secret matches
            }
        }
        if (!authorized) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const leagueId = req.query.leagueId || (req.body && req.body.leagueId);
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
        const ownershipMap = new Map();
        ownershipSnap.forEach((doc) => {
            const data = doc.data();
            const ownersCount = Array.isArray(data === null || data === void 0 ? void 0 : data.owners) ? data.owners.length : 1;
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
            batch.set(doc.ref, { available, ownershipPercent, updatedAt: firestore_1.Timestamp.now() }, { merge: true });
        });
        await batch.commit();
        res.status(200).json({ updated: indexSnap.size, teamCount: safeTeams });
    }
    catch (e) {
        res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Internal error' });
    }
});
// Helper: robust ALREADY_EXISTS detection for Firestore
function isAlreadyExistsError(err) {
    var _a, _b;
    const code = (_b = (_a = err === null || err === void 0 ? void 0 : err.code) !== null && _a !== void 0 ? _a : err === null || err === void 0 ? void 0 : err.status) !== null && _b !== void 0 ? _b : '';
    const codeStr = typeof code === 'number' ? String(code) : String(code || '').toUpperCase();
    return (codeStr === '6' ||
        codeStr === 'ALREADY_EXISTS' ||
        /ALREADY[-_ ]?EXISTS/i.test(String((err === null || err === void 0 ? void 0 : err.message) || '')));
}
//# sourceMappingURL=draftWorker.js.map