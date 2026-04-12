import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import {
  draftCompletedFunction,
  draftRepairFunction,
} from '@/server/inngest/functions/draftCompleted';
import { tradeVetoWindowSweepFunction } from '@/server/inngest/functions/tradeVetoWindowSweep';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [draftCompletedFunction, draftRepairFunction, tradeVetoWindowSweepFunction],
});
