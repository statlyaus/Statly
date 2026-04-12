import type { Prisma } from '@prisma/client';

/**
 * Safe fields for API and cross-service responses.
 * Password material lives on `UserCredential` only — never select it on public paths.
 */
export const prismaUserPublicSelect = {
  id: true,
  email: true,
  displayName: true,
  timeZone: true,
} as const satisfies Prisma.UserSelect;

export type PrismaUserPublic = Prisma.UserGetPayload<{
  select: typeof prismaUserPublicSelect;
}>;
