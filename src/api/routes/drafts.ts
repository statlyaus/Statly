import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const createDraftSchema = z.object({
  leagueId: z.number(),
});

router.post('/', async (req, res) => {
  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const draft = await prisma.draft.create({ data: parsed.data });
  res.json(draft);
});

const draftParams = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

router.get('/:id', async (req, res) => {
  const parsed = draftParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const draft = await prisma.draft.findUnique({ where: { id: parsed.data.id } });
  if (!draft) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.json(draft);
});

export default router;
