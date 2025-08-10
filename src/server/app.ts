import express from 'express';
import { generateSnakeDraftOrder } from '../lib/snakeDraft';

const app = express();
app.use(express.json());

app.post('/api/draft/order', (req, res) => {
  const { teams, rosterSize } = req.body ?? {};
  if (
    !Number.isInteger(teams) ||
    teams <= 0 ||
    !Number.isInteger(rosterSize) ||
    rosterSize <= 0
  ) {
    return res
      .status(400)
      .json({ error: 'teams and rosterSize must be positive integers' });
  }
  const order = generateSnakeDraftOrder(teams, rosterSize);
  return res.json({ order });
});

export default app;
