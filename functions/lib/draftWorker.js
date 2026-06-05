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
exports.backfillOwnershipPercent = exports.onPlayerOwnershipWrite = exports.onUserWatchlistUpdate = exports.onTeamRosterUpdate = exports.processWaivers = exports.onTradeUpdate = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const node_crypto_1 = __importDefault(require("node:crypto"));
// Initialize Firebase Admin
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const REGION = 'australia-southeast1';
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
 * Team-specific roster write listener.
 * Keeps ownership and availability indexes in sync with canonical league rosters.
 */
exports.onTeamRosterUpdate = functions
    .region(REGION)
    .runWith({ failurePolicy: true, timeoutSeconds: 120, memory: '256MB' })
    .firestore.document('leagues/{leagueId}/rosters/{teamId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c;
    const { leagueId, teamId } = context.params;
    const beforeData = change.before.exists ? ((_a = change.before.data()) !== null && _a !== void 0 ? _a : {}) : {};
    const afterData = change.after.exists ? ((_b = change.after.data()) !== null && _b !== void 0 ? _b : {}) : {};
    functions.logger.info(`Team roster written: ${teamId} in league ${leagueId}`);
    try {
        const oldPlayerIds = getRosterPlayerIds(beforeData);
        const newPlayerIds = getRosterPlayerIds(afterData);
        const addedPlayers = newPlayerIds.filter((id) => !oldPlayerIds.includes(id));
        const removedPlayers = oldPlayerIds.filter((id) => !newPlayerIds.includes(id));
        const userId = (_c = stringOrUndefined(afterData.userId)) !== null && _c !== void 0 ? _c : stringOrUndefined(beforeData.userId);
        await syncRosterOwnershipForLeague(leagueId, teamId, userId, addedPlayers, removedPlayers);
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
async function notifyLeagueTradePartner(leagueId) {
    // Implement league-scoped trade proposal notification
    functions.logger.info(`Notifying trade partner in league ${leagueId}`);
}
async function notifyLeagueTradeRejection(leagueId) {
    // Implement league-scoped trade rejection notification
    functions.logger.info(`Notifying trade rejection in league ${leagueId}`);
}
// Team-specific notification functions
async function notifyTeamRosterChanges(leagueId, teamId, addedPlayers, removedPlayers) {
    // Implement team-scoped roster change notifications
    functions.logger.info(`Notifying team ${teamId} in league ${leagueId} of roster changes: +${addedPlayers.length}, -${removedPlayers.length}`);
}
async function syncRosterOwnershipForLeague(leagueId, teamId, userId, addedPlayers, removedPlayers) {
    if (addedPlayers.length === 0 && removedPlayers.length === 0) {
        return;
    }
    const batch = db.batch();
    const now = firestore_1.Timestamp.now();
    for (const playerId of addedPlayers) {
        const ownershipRef = db
            .collection('leagues')
            .doc(leagueId)
            .collection('playerOwnerships')
            .doc(playerId);
        batch.set(ownershipRef, Object.assign(Object.assign({ leagueId,
            playerId,
            teamId }, (userId ? { userId } : {})), { acquiredAt: now, updatedAt: now }), { merge: true });
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
function getRosterPlayerIds(data) {
    if (!Array.isArray(data.playerIds)) {
        return [];
    }
    return [...new Set(data.playerIds.map((id) => String(id)).filter(Boolean))];
}
function stringOrUndefined(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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
function safeEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(aBuf, bBuf);
}
function getHeaderString(req, name) {
    var _a;
    const value = (_a = req.headers[name]) !== null && _a !== void 0 ? _a : req.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
}
function getBearerToken(req) {
    var _a;
    const authHeader = (_a = getHeaderString(req, 'authorization')) !== null && _a !== void 0 ? _a : getHeaderString(req, 'Authorization');
    return (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) ? authHeader.slice('Bearer '.length) : undefined;
}
function hasAdminClaim(decoded) {
    const claims = decoded;
    return claims.admin === true || (Array.isArray(claims.roles) && claims.roles.includes('admin'));
}
async function authorizeBackfillOwnershipRequest(req) {
    const internalSecret = process.env.INTERNAL_TASK_SECRET || '';
    const providedSecret = getHeaderString(req, 'x-internal-secret');
    if (providedSecret && internalSecret && safeEquals(providedSecret, internalSecret)) {
        return true;
    }
    const bearer = getBearerToken(req);
    if (!bearer) {
        return false;
    }
    try {
        const decoded = await (0, auth_1.getAuth)().verifyIdToken(bearer);
        return hasAdminClaim(decoded);
    }
    catch (_a) {
        return false;
    }
}
function getBackfillLeagueId(req) {
    const queryLeagueId = req.query.leagueId;
    const body = req.body;
    const bodyLeagueId = body === null || body === void 0 ? void 0 : body.leagueId;
    if (typeof queryLeagueId === 'string')
        return queryLeagueId;
    if (typeof bodyLeagueId === 'string')
        return bodyLeagueId;
    return undefined;
}
async function loadOwnershipCounts(leagueId) {
    const ownershipSnap = await db
        .collection('leagues')
        .doc(leagueId)
        .collection('playerOwnerships')
        .select('owners', 'teamId')
        .get();
    const ownershipMap = new Map();
    ownershipSnap.forEach((doc) => {
        const data = doc.data();
        const ownersCount = Array.isArray(data.owners) ? data.owners.length : 1;
        ownershipMap.set(doc.id, ownersCount);
    });
    return ownershipMap;
}
async function updateAvailablePlayerOwnership(leagueId, ownershipMap, safeTeams) {
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
    return indexSnap.size;
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : 'Internal error';
}
exports.backfillOwnershipPercent = functions
    .region(REGION)
    .https.onRequest(async (req, res) => {
    try {
        if (!(await authorizeBackfillOwnershipRequest(req))) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const leagueId = getBackfillLeagueId(req);
        if (!leagueId) {
            res.status(400).json({ error: 'leagueId is required' });
            return;
        }
        const teamCount = await getLeagueTeamCount(leagueId);
        const safeTeams = teamCount > 0 ? teamCount : 1;
        const ownershipMap = await loadOwnershipCounts(leagueId);
        const updated = await updateAvailablePlayerOwnership(leagueId, ownershipMap, safeTeams);
        res.status(200).json({ updated, teamCount: safeTeams });
    }
    catch (error) {
        res.status(500).json({ error: getErrorMessage(error) });
    }
});
//# sourceMappingURL=draftWorker.js.map