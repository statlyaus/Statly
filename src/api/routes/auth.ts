import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../prisma';

const router = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/register', async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.create({ data: parsed.data });
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET ?? 'secret',
    { expiresIn: '7d' }
  );
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ user });
});

router.post('/login', async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.password !== parsed.data.password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET ?? 'secret',
    { expiresIn: '7d' }
  );
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.status(200).json({ success: true });
});

export default router;
