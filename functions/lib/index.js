"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshPlayerSeasonStats = exports.reconcilePendingBidTotals = exports.backfillOwnershipPercent = exports.onPlayerOwnershipWrite = exports.onUserWatchlistUpdate = exports.onTeamRosterUpdate = exports.processWaivers = exports.onTradeUpdate = exports.onDraftPickMade = exports.processDraftPicks = void 0;
// Main entry point for Firebase Functions
var draftWorker_1 = require("./draftWorker");
Object.defineProperty(exports, "processDraftPicks", { enumerable: true, get: function () { return draftWorker_1.processDraftPicks; } });
Object.defineProperty(exports, "onDraftPickMade", { enumerable: true, get: function () { return draftWorker_1.onDraftPickMade; } });
Object.defineProperty(exports, "onTradeUpdate", { enumerable: true, get: function () { return draftWorker_1.onTradeUpdate; } });
Object.defineProperty(exports, "processWaivers", { enumerable: true, get: function () { return draftWorker_1.processWaivers; } });
Object.defineProperty(exports, "onTeamRosterUpdate", { enumerable: true, get: function () { return draftWorker_1.onTeamRosterUpdate; } });
Object.defineProperty(exports, "onUserWatchlistUpdate", { enumerable: true, get: function () { return draftWorker_1.onUserWatchlistUpdate; } });
Object.defineProperty(exports, "onPlayerOwnershipWrite", { enumerable: true, get: function () { return draftWorker_1.onPlayerOwnershipWrite; } });
Object.defineProperty(exports, "backfillOwnershipPercent", { enumerable: true, get: function () { return draftWorker_1.backfillOwnershipPercent; } });
// Export reconciliation HTTP function
var reconcilePendingBidTotals_1 = require("./reconcilePendingBidTotals");
Object.defineProperty(exports, "reconcilePendingBidTotals", { enumerable: true, get: function () { return reconcilePendingBidTotals_1.reconcilePendingBidTotals; } });
// Export scheduled stats aggregation
var playerStatsAggregator_1 = require("./playerStatsAggregator");
Object.defineProperty(exports, "refreshPlayerSeasonStats", { enumerable: true, get: function () { return playerStatsAggregator_1.refreshPlayerSeasonStats; } });
//# sourceMappingURL=index.js.map