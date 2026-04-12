import type { Prisma } from '@prisma/client';

/**
 * Central placeholders for UserCredential.passwordHash.
 * Real password verification should read UserCredential explicitly, never default User includes.
 */
export const USER_CREDENTIAL_FIREBASE_MANAGED = 'firebase_auth_managed';
export const USER_CREDENTIAL_DEV_PLACEHOLDER = 'DEV_PLACEHOLDER';
export const USER_CREDENTIAL_DRAFT_DEMO = 'draft_hash';
export const USER_CREDENTIAL_ADMIN_DEMO = 'admin_hash';
export const USER_CREDENTIAL_DUMMY_BOT = 'dummy_hash';

/** Nested create fragment for `UserCreateInput.credential`. */
export function nestedUserCredentialCreate(
  passwordHash: string
): Prisma.UserCredentialCreateNestedOneWithoutUserInput {
  return { create: { passwordHash } };
}
