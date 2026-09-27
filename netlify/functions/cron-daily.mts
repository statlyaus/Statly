import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: runs the daily job at 23:00 UTC.
export default async () => {
  await triggerCronEndpoint('/api/cron/daily', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '0 23 * * *' };
