import { triggerCronEndpoint } from '../../src/server/cron/triggerCronEndpoint';

// Netlify scheduled function: once a day at 17:30 UTC (early morning in Melbourne), deletes draft-room
// queue and watchlist activity rows older than LOBBY_ACTIVITY_RETENTION_DAYS (default 30). Picks live in
// the Pick table and are never touched. Returns at once in trades-only mode, like every cron.
export default async () => {
  await triggerCronEndpoint('/api/cron/prune-lobby', {
    baseUrl: process.env.URL,
    secret: process.env.CRON_SECRET,
  });
};

export const config = { schedule: '30 17 * * *' };
