import { createHash } from 'crypto';

/**
 * The placeholder email stored on a lazily created Prisma `User` whose identity is a Firebase UID.
 * Kept free of Firebase and Firestore imports so services that only need the email (such as fantasy
 * basketball) don't load the Firestore bridge.
 */
export function buildExternalUserEmail(userId: string): string {
  const digest = createHash('sha1').update(userId).digest('hex').slice(0, 20);
  return `firebase_${digest}@statly.local`;
}
