import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminAuth } from '@/lib/firebaseAdmin';

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
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await adminAuth.verifyIdToken(token);

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error processing trade offer:', err);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
