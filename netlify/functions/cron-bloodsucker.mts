import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: every 5 minutes, so a Bloodsucker window closes and its roster is
// auto-filled within 5 minutes of the close time (NFR-3).
export default async () => {
  await triggerCronEndpoint('/api/cron/bloodsucker', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '*/5 * * * *' };
