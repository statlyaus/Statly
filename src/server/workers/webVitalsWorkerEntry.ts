import { logger } from '../../lib/logger';
import { createWebVitalsWorker } from './webVitalsWorker';

async function main() {
  createWebVitalsWorker();
  logger.info('WebVitals worker entry started');
}

void main().catch((error) => {
  logger.error('WebVitals worker entry failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
