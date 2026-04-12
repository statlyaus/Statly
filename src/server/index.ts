import { logger } from '@/lib/logger';

import app from './app';

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info('Legacy Express API server listening', {
    port,
    environment: process.env.NODE_ENV,
    note: 'Draft queue helpers only; season trades and other app APIs live on Next.js route handlers.',
  });
});
