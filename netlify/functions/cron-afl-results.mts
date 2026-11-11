import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: hourly at :35 UTC. The route raises a Sentry error for every AFL game
// whose result is still missing 6 hours after its scheduled end; it writes nothing.
export default async () => {
  await triggerCronEndpoint('/api/cron/afl-results', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '35 * * * *' };
