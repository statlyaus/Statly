import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const createLeagueSchema = z.object({
  name: z.string().min(1),
});

router.post('/', async (req, res) => {
  const parsed = createLeagueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const league = await prisma.league.create({ data: parsed.data });
  res.json(league);
});

const leagueParams = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

router.get('/:id', async (req, res) => {
  const parsed = leagueParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const league = await prisma.league.findUnique({ where: { id: parsed.data.id } });
  if (!league) {
    return res.status(404).json({ error: 'League not found' });
  }
  res.json(league);
});

export default router;
