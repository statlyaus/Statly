/**
 * User Profile API Routes
 * Next.js API endpoints for user profile management
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';

/**
 * Require the acting user to be the owner of the profile being addressed.
 *
 * A profile is private to its owner. The identifier in the path is never treated as proof of
 * identity, so a caller can only read or write their own profile.
 */
async function authorizeOwnProfile(
  request: NextRequest,
  routeUserId: string
): Promise<{ userId: string } | { response: NextResponse }> {
  const authenticatedUserId = await getAuthenticatedUserId(request);
  if (!authenticatedUserId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (authenticatedUserId !== routeUserId) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { userId: authenticatedUserId };
}

/**
 * GET /api/user/profile/[userId]
 * Retrieve the authenticated user's own profile with all league memberships
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const access = await authorizeOwnProfile(request, userId);
    if ('response' in access) return access.response;

    logger.info('API: Getting user profile', { userId: access.userId });

    const profile = await userProfileService.getUserProfile(access.userId);

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
 * Update the authenticated user's own profile
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const access = await authorizeOwnProfile(request, userId);
    if ('response' in access) return access.response;

    const updates = await request.json();

    logger.info('API: Updating user profile', {
      userId: access.userId,
      updateKeys: Object.keys(updates),
    });

    const updatedProfile = await userProfileService.updateUserProfile(access.userId, updates);

    return NextResponse.json({ profile: updatedProfile }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to update user profile', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
