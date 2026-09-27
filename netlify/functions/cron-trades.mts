import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: processes due league trades every 5 minutes (UTC).
export default async () => {
  await triggerCronEndpoint('/api/cron/trades', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '*/5 * * * *' };
