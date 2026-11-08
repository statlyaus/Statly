import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: daily at 08:47 UTC (early morning US Eastern, after the night's games).
// Refreshes NBA teams and rosters before the schedule job runs.
export default async () => {
  await triggerCronEndpoint('/api/cron/nba?job=players', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '47 8 * * *' };
