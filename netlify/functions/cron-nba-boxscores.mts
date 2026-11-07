import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: every 30 minutes (UTC). Each run reads yesterday's and today's NBA
// scoreboards and ingests at most 8 final box scores, so a night's games land within about an hour.
export default async () => {
  await triggerCronEndpoint('/api/cron/nba?job=boxscores', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '7,37 * * * *' };
