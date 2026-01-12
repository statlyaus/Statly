import app from './app';

import '../api/workers/draftWorker';
import { logger } from '@/lib/logger';
import { registerTradeRoutes } from './routes/trades';

registerTradeRoutes(app);

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info(`API server listening on port ${port}`, { port, environment: process.env.NODE_ENV });
});
