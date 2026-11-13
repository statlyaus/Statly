import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: every 5 minutes, so a Bloodsucker window closes (and its roster is
// auto-filled) and a bite past its deadline is auto-executed within 5 minutes (NFR-3). The route
// checks in with the `cron-bloodsucker` Sentry Crons monitor.
export default async () => {
  await triggerCronEndpoint('/api/cron/bloodsucker', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '*/5 * * * *' };
