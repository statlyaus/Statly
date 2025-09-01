 
import { Queue } from 'bullmq';
import { URL } from 'node:url';

function redisConnFromEnv() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const dbStr = url.pathname.replace('/', '');
  return {
    host: url.hostname,
    port: Number(url.port || '6379'),
    username: url.username || undefined,
    password: url.password || undefined,
    db: dbStr ? Number(dbStr) : 0,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

async function main() {
  const q = new Queue('web-vitals', { connection: redisConnFromEnv() });

  const job = await q.add('sample', {
    sessionId: 'dev-session',
    name: 'LCP',
    value: Math.round(Math.random() * 2500) / 100,
    rating: 'good',
    url: 'http://localhost:3000/',
    ua: 'dev-cli',
    at: new Date().toISOString(),
  });

  console.log('[producer] enqueued', { id: job.id });
  await q.close();
}

main().catch((e) => {
  console.error('[producer] error', e);
  process.exit(1);
});
