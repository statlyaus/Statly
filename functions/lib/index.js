"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processWaivers = exports.onTradeUpdate = exports.onDraftPickMade = exports.processDraftPicks = void 0;
// Main entry point for Firebase Functions
var draftWorker_1 = require("./draftWorker");
Object.defineProperty(exports, "processDraftPicks", { enumerable: true, get: function () { return draftWorker_1.processDraftPicks; } });
Object.defineProperty(exports, "onDraftPickMade", { enumerable: true, get: function () { return draftWorker_1.onDraftPickMade; } });
Object.defineProperty(exports, "onTradeUpdate", { enumerable: true, get: function () { return draftWorker_1.onTradeUpdate; } });
Object.defineProperty(exports, "processWaivers", { enumerable: true, get: function () { return draftWorker_1.processWaivers; } });
//# sourceMappingURL=index.js.map