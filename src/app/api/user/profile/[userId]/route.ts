/**
 * User Profile API Routes
 * Next.js API endpoints for user profile management
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { userProfileService } from '@/services/userProfileService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

const updatesSchema = z.record(z.string(), z.unknown());

/**
 * GET /api/user/profile/[userId]
 * Retrieve user profile with all league memberships
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    const { userId } = parsedParams.data;

    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    logger.info('API: Getting user profile', { userId });

    const profile = await userProfileService.getUserProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    return NextResponse.json({ profile }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to get user profile', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/user/profile/[userId]
 * Update user profile
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }
    const { userId } = parsedParams.data;

    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = updatesSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    }
    const updates = parsedBody.data;

    logger.info('API: Updating user profile', { userId, updateKeys: Object.keys(updates) });

    const updatedProfile = await userProfileService.updateUserProfile(userId, updates);

    return NextResponse.json({ profile: updatedProfile }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to update user profile', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
