/* eslint-disable no-console */
import { Queue } from 'bullmq';

import { getPublisherClient } from '@/server/realtime/scalableConnection';

async function main() {
  const queue = new Queue('web-vitals', {
    connection: getPublisherClient() as any,
  });

  const job = await queue.add('sample', {
    sessionId: 'dev-session',
    name: 'LCP',
    value: Math.round(Math.random() * 2500) / 100,
    rating: 'good',
    url: 'http://localhost:3000/',
    ua: 'dev-cli',
    at: new Date().toISOString(),
  });

  console.log('[producer] enqueued', { id: job.id });
  await queue.close();
}

main().catch((error) => {
  console.error('[producer] error', error);
  process.exit(1);
});
