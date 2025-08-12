import express from 'express';
import { generateSnakeDraftOrder } from '../lib/snakeDraft';
import { emitPickMade, emitClock, emitQueueUpdated } from '../api/realtime';

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
    return res
      .status(400)
      .json({ error: 'teams and rosterSize must be positive integers, benchSize (if provided) must be a non-negative integer' });
  }
  const order = generateSnakeDraftOrder(teams, rosterSize, benchSize);
  return res.json({ order });
});

app.post('/api/draft/:id/pick', (req, res) => {
  emitPickMade(req.params.id, req.body);
  res.json({ status: 'ok' });
});

app.post('/api/draft/:id/clock', (req, res) => {
  emitClock(req.params.id, req.body);
  res.json({ status: 'ok' });
});

app.post('/api/draft/:id/queue', (req, res) => {
  emitQueueUpdated(req.params.id, req.body);
  res.json({ status: 'ok' });
});

export default app;
