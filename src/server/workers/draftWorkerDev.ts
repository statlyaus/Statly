import { logger } from '@/lib/logger';
import { workerPool } from '@/server/workers/workerPool';

async function main() {
  await workerPool.start();
  logger.info('Draft worker dev process started');
}

void main().catch((error) => {
  logger.error('Draft worker dev process failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
