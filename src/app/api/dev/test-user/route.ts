import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  DEVELOPMENT_AUTH_DISPLAY_NAME,
  DEVELOPMENT_AUTH_EMAIL,
  DEVELOPMENT_AUTH_USER_ID,
  resolveLocalDevelopmentAuthPhrase,
} from '@/lib/devAuth';
import { logger } from '@/lib/logger';
import {
  developmentToolsNotFoundResponse,
  isDevelopmentToolsEnabled,
} from '@/server/developmentTools';

export async function POST(_request: NextRequest) {
  if (!isDevelopmentToolsEnabled()) {
    return developmentToolsNotFoundResponse();
  }

  try {
    const { adminAuth } = await import('@/lib/firebaseAdmin');
    const localDevelopmentAuthPhrase = resolveLocalDevelopmentAuthPhrase();

    const testUser = {
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      password: localDevelopmentAuthPhrase,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      emailVerified: true,
    };

    // Try to get existing user or create new one
    let user;
    try {
      user = await adminAuth.getUser(testUser.uid);
      user = await adminAuth.updateUser(testUser.uid, {
        email: testUser.email,
        password: testUser.password,
        displayName: testUser.displayName,
        emailVerified: testUser.emailVerified,
        disabled: false,
      });
      logger.info('Test user already exists', { uid: testUser.uid });
    } catch (_error) {
      // User doesn't exist, create it
      user = await adminAuth.createUser(testUser);
      logger.info('Created test user', { uid: testUser.uid });
    }

    let customToken: string | null = null;
    try {
      customToken = await adminAuth.createCustomToken(testUser.uid);
    } catch (error) {
      logger.warn('Could not create local custom token; use Auth emulator email login instead', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return successResponse({
      message: 'Test user ready',
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      },
      credentials: {
        email: DEVELOPMENT_AUTH_EMAIL,
        password: localDevelopmentAuthPhrase,
      },
      customToken,
    });
  } catch (error) {
    logger.error('Failed to create test user', error);
    return errorResponse('Failed to create test user', 500);
  }
}
