/**
 * Scheduled aggregation for player season stats.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import * as functions from 'firebase-functions/v1';

if (getApps().length === 0) {
  initializeApp();
}

const REGION = 'australia-southeast1';

const AGGREGATOR_MEMORY = (process.env.PLAYER_STATS_AGGREGATOR_MEMORY ||
  process.env.FUNCTIONS_MEMORY ||
  '1GB') as any; // '256MB' | '512MB' | '1GB' | '2GB'
const AGGREGATOR_TIMEOUT_SECONDS = parseInt(
  process.env.PLAYER_STATS_AGGREGATOR_TIMEOUT_SECONDS ||
    process.env.FUNCTIONS_TIMEOUT_SECONDS ||
    '540',
  10
);

export const refreshPlayerSeasonStats = functions
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
