import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: hourly (UTC). Replaces the NBA injury report as a whole list; a
// rejected feed keeps the previous one.
export default async () => {
  await triggerCronEndpoint('/api/cron/nba?job=injuries', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '17 * * * *' };
