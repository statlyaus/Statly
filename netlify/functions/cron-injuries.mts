import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: every 6 hours in UTC. The route stores a new snapshot only when the
// Footywire list changed, otherwise it confirms the current one, which keeps it inside the read
// model's 48 hour freshness window even if a run or two fails.
export default async () => {
  await triggerCronEndpoint('/api/cron/injuries', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '0 */6 * * *' };
