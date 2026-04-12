'use strict';
/**
 * Scheduled aggregation for player season stats.
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.refreshPlayerSeasonStats = void 0;
const app_1 = require('firebase-admin/app');
const functions = __importStar(require('firebase-functions/v1'));
if ((0, app_1.getApps)().length === 0) {
  (0, app_1.initializeApp)();
}
const REGION = 'australia-southeast1';
const AGGREGATOR_MEMORY =
  process.env.PLAYER_STATS_AGGREGATOR_MEMORY || process.env.FUNCTIONS_MEMORY || '1GB'; // '256MB' | '512MB' | '1GB' | '2GB'
const AGGREGATOR_TIMEOUT_SECONDS = parseInt(
  process.env.PLAYER_STATS_AGGREGATOR_TIMEOUT_SECONDS ||
    process.env.FUNCTIONS_TIMEOUT_SECONDS ||
    '540',
  10
);
exports.refreshPlayerSeasonStats = functions
  .region(REGION)
  .runWith({
    timeoutSeconds: AGGREGATOR_TIMEOUT_SECONDS,
    memory: AGGREGATOR_MEMORY,
  })
  .pubsub.schedule('0 3 * * *')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    functions.logger.warn('playerStatsAggregator.disabled', {
      reason:
        'Writes to player_season_stats are retired in favor of Scripts/precompute-season-stats.ts.',
    });
    return null;
  });
//# sourceMappingURL=playerStatsAggregator.js.map
