import express from 'express';
import { generateSnakeDraftOrder } from '../lib/snakeDraft';
import { draftQueue, scheduleDraftStart } from '../api/queues/draftQueue';

const app = express();
app.use(express.json());

app.post('/api/draft/order', (req, res) => {
  const { teams, rosterSize, benchSize } = req.body ?? {};
  if (
    !Number.isInteger(teams) ||
    teams <= 0 ||
    !Number.isInteger(rosterSize) ||
    rosterSize <= 0 ||
    (benchSize !== undefined && (!Number.isInteger(benchSize) || benchSize < 0))
  ) {
    return res.status(400).json({
      error:
        'teams and rosterSize must be positive integers, benchSize (if provided) must be a non-negative integer',
    });
  }
  const order = generateSnakeDraftOrder(teams, rosterSize, benchSize);
  return res.json({ order });
});

app.post('/api/draft/:leagueId/schedule', async (req, res) => {
  const { leagueId } = req.params;
  const { startAt, pickClock } = req.body ?? {};
  if (!startAt) {
    return res.status(400).json({ error: 'startAt is required' });
  }
  const startDate = new Date(startAt);
  if (Number.isNaN(startDate.getTime())) {
    return res.status(400).json({ error: 'startAt must be a valid date' });
  }
  const pickClockMs = typeof pickClock === 'number' ? pickClock : Number(pickClock) || 0;
  await scheduleDraftStart(leagueId, startDate, pickClockMs);
  return res.json({ scheduled: true });
});

app.post('/api/draft/pause', async (_req, res) => {
  await draftQueue.pause();
  return res.json({ status: 'paused' });
});

app.post('/api/draft/resume', async (_req, res) => {
  await draftQueue.resume();
  return res.json({ status: 'resumed' });
});

export default app;
