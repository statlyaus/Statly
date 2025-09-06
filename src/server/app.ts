import express from 'express';
import { generateSnakeDraftOrder } from '../lib/snakeDraft';
import { draftQueue, scheduleDraftStart } from './queue/draftQueue';

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

app.post('/api/draft/:leagueId/schedule', (req, res) => {
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

  // Handle the promise properly
  scheduleDraftStart(leagueId, startDate, pickClockMs)
    .then(() => {
      res.json({ scheduled: true });
    })
    .catch((error) => {
      console.error('Failed to schedule draft:', error);
      res.status(500).json({ error: 'Failed to schedule draft' });
    });
});

app.post('/api/draft/pause', (_req, res) => {
  draftQueue
    .pause()
    .then(() => {
      res.json({ status: 'paused' });
    })
    .catch((error) => {
      console.error('Failed to pause draft:', error);
      res.status(500).json({ error: 'Failed to pause draft' });
    });
});

app.post('/api/draft/resume', (_req, res) => {
  draftQueue
    .resume()
    .then(() => {
      res.json({ status: 'resumed' });
    })
    .catch((error) => {
      console.error('Failed to resume draft:', error);
      res.status(500).json({ error: 'Failed to resume draft' });
    });
});

export default app;
