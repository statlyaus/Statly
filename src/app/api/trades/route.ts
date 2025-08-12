import { z } from 'zod';
import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';

const playerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const bodySchema = z.object({
  incoming: z.array(playerSchema),
  outgoing: z.array(playerSchema),
});

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return commonErrors.unauthorized();
    }
    await adminAuth.verifyIdToken(token);

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid payload', { errors: parsed.error.flatten().fieldErrors });
    }

    return successResponse({ message: 'Trade offer processed successfully' });
  } catch (err) {
    logger.error('Error processing trade offer', err);
    return commonErrors.internalServerError('Server error');
  }
}
