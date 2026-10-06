import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: hourly in UTC. The route processes waivers only in the 6 am Melbourne
// hour, so the daily run follows daylight saving.
export default async () => {
  await triggerCronEndpoint('/api/cron/waivers', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '0 * * * *' };
