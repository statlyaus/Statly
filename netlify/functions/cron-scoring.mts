import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: hourly in UTC. The route rescores every started, unfinished round of a
// published competition; a round becomes FINAL once its AFL matches are all final.
export default async () => {
  await triggerCronEndpoint('/api/cron/scoring', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '0 * * * *' };
