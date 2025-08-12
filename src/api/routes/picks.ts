import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const createPickSchema = z.object({
  draftId: z.number(),
  player: z.string().min(1),
});

router.post('/', async (req, res) => {
  const parsed = createPickSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const pick = await prisma.pick.create({ data: parsed.data });
  res.json(pick);
});

const pickParams = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

router.get('/:id', async (req, res) => {
  const parsed = pickParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const pick = await prisma.pick.findUnique({ where: { id: parsed.data.id } });
  if (!pick) {
    return res.status(404).json({ error: 'Pick not found' });
  }
  res.json(pick);
});

export default router;
