import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: daily at 09:27 UTC, after the players job. Refreshes the season's
// regular-season schedule (new NBA Cup games, postponements, start times).
export default async () => {
  await triggerCronEndpoint('/api/cron/nba?job=schedule', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '27 9 * * *' };
