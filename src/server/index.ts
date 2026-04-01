import { logger } from '@/lib/logger';

import app from './app';
import { registerTradeRoutes } from './routes/trades';

registerTradeRoutes(app);

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info('Legacy Express API server listening', {
    port,
    environment: process.env.NODE_ENV,
    note: 'Next.js route handlers are the primary application API surface.',
  });
});
