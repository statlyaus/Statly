import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

export async function POST(_request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return errorResponse('Test accounts only available in development', 403);
  }

  try {
    const { adminAuth } = await import('@/lib/firebaseAdmin');

    // Test user credentials
    const testUser = {
      uid: 'test-user-dev',
      email: 'test@statly.dev',
      displayName: 'Test User',
      emailVerified: true,
    };

    // Try to get existing user or create new one
    let user;
    try {
      user = await adminAuth.getUser(testUser.uid);
      logger.info('Test user already exists', { uid: testUser.uid });
    } catch (_error) {
      // User doesn't exist, create it
      user = await adminAuth.createUser(testUser);
      logger.info('Created test user', { uid: testUser.uid });
    }

    // Create a custom token for immediate login
    const customToken = await adminAuth.createCustomToken(testUser.uid);

    return successResponse({
      message: 'Test user ready',
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      },
      customToken,
    });
  } catch (error) {
    logger.error('Failed to create test user', error);
    return errorResponse('Failed to create test user', 500);
  }
}
