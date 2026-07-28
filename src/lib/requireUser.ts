import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

/**
 * Resolve the authenticated user from the canonical server identity boundary.
 * Throws an error if the user cannot be verified.
 */
export async function requireUser(): Promise<string> {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) throw new Error('Authenticated user not found');
  return userId;
}
