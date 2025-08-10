import express from 'express';
import { generateSnakeDraftOrder } from '../lib/snakeDraft';

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

export default app;
