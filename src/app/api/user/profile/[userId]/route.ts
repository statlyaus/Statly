/**
 * User Profile API Routes
 * Next.js API endpoints for user profile management
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { userProfileService } from '@/services/userProfileService';
import { logger } from '@/lib/logger';
import type { UserIdParams } from '@/types/api';

/**
 * GET /api/user/profile/[userId]
 * Retrieve user profile with all league memberships
 */
export async function GET(
  request: NextRequest,
  { params }: UserIdParams
) {
  try {
    const { userId } = await params;
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    logger.info('API: Getting user profile', { userId });

    const profile = await userProfileService.getUserProfile(userId);
    
    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to get user profile', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile/[userId]
 * Update user profile
 */
export async function PUT(
  request: NextRequest,
  { params }: UserIdParams
) {
  try {
    const { userId } = await params;
    const updates = await request.json();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    logger.info('API: Updating user profile', { userId, updateKeys: Object.keys(updates) });

    const updatedProfile = await userProfileService.updateUserProfile(userId, updates);

    return NextResponse.json({ profile: updatedProfile }, { status: 200 });
  } catch (error) {
    logger.error('API: Failed to update user profile', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
