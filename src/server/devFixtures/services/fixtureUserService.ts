import { prisma } from '@/lib/prisma';
import {
  nestedUserCredentialCreate,
  USER_CREDENTIAL_FIREBASE_MANAGED,
} from '@/lib/userCredentialConstants';

export async function ensureFixtureUser(input: {
  userId: string;
  email: string;
  displayName: string;
}) {
  return prisma.user.upsert({
    where: { id: input.userId },
    create: {
      id: input.userId,
      email: input.email,
      displayName: input.displayName,
      timeZone: 'Australia/Melbourne',
      credential: nestedUserCredentialCreate(USER_CREDENTIAL_FIREBASE_MANAGED),
    },
    update: {
      email: input.email,
      displayName: input.displayName,
      timeZone: 'Australia/Melbourne',
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  });
}

export async function ensureFixtureOwnerUser(ownerUserId: string) {
  return ensureFixtureUser({
    userId: ownerUserId,
    email: process.env.BYPASS_EMAIL || process.env.NEXT_PUBLIC_BYPASS_EMAIL || 'tester@statly.dev',
    displayName:
      process.env.BYPASS_NAME || process.env.NEXT_PUBLIC_BYPASS_NAME || 'Statly Dev Tester',
  });
}
