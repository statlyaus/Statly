import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const createQueueSchema = z.object({
  userId: z.number(),
  player: z.string().min(1),
});

router.post('/', async (req, res) => {
  const parsed = createQueueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const queue = await prisma.queue.create({ data: parsed.data });
  res.json(queue);
});

const queueParams = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

router.get('/:id', async (req, res) => {
  const parsed = queueParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const queue = await prisma.queue.findUnique({ where: { id: parsed.data.id } });
  if (!queue) {
    return res.status(404).json({ error: 'Queue not found' });
  }
  res.json(queue);
});

export default router;
