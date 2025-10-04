import { config as loadEnv } from 'dotenv';
import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { getServiceAccountFromEnv } from '@/lib/serviceAccount';
import { getBypassUserDetails } from '@/lib/authBypass';

loadEnv({ path: '.env.local', override: false });
loadEnv();

function getProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    undefined
  );
}

function ensureAdminAuth() {
  if (getApps().length === 0) {
    try {
      const sa = getServiceAccountFromEnv();
      const privateKey = (sa.privateKey ?? '').replace(/\\n/g, '\n');
      initializeApp({
        credential: cert({
          projectId: sa.projectId,
          clientEmail: sa.clientEmail,
          privateKey,
        }),
        projectId: sa.projectId,
      });
    } catch (error) {
      // Fallback to ADC (useful for gcloud auth application-default login)
      initializeApp({
        credential: applicationDefault(),
        projectId: getProjectId(),
      });
    }
  }
  return getAuth();
}

const adminAuth = ensureAdminAuth();

interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
  password?: string;
  isBot?: boolean;
}

const REAL_USER_PASSWORD = 'StatlyTest!123';

const primaryDevUser = getBypassUserDetails();

const seedUsers: SeedUser[] = [
  {
    uid: primaryDevUser.uid,
    email: primaryDevUser.email,
    displayName: primaryDevUser.displayName,
    password: REAL_USER_PASSWORD,
  },
  ...Array.from({ length: 11 }).map((_, index) => {
    const padded = (index + 1).toString().padStart(2, '0');
    return {
      uid: `statly-bot-${padded}`,
      email: `bot${padded}@statly.dev`,
      displayName: `Statly Bot ${padded}`,
      isBot: true,
    } satisfies SeedUser;
  }),
];

async function ensureUser(user: SeedUser) {
  const { uid, email, displayName, password, isBot } = user;
  let existingClaims: Record<string, unknown> | undefined;

  try {
    const existing = await adminAuth.getUser(uid);
    existingClaims = existing.customClaims ?? undefined;

    const updatePayload: Parameters<typeof adminAuth.updateUser>[1] = {
      email,
      displayName,
      emailVerified: true,
      disabled: false,
    };

    if (password) {
      updatePayload.password = password;
    }

    await adminAuth.updateUser(uid, updatePayload);
    return { uid, created: false, claims: existingClaims };
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }
  }

  const createPayload: Parameters<typeof adminAuth.createUser>[0] = {
    uid,
    email,
    displayName,
    emailVerified: true,
    disabled: false,
  };

  if (password) {
    createPayload.password = password;
  }

  await adminAuth.createUser(createPayload);
  return { uid, created: true, claims: existingClaims };
}

async function applyClaims(
  uid: string,
  baseClaims: Record<string, unknown> | undefined,
  isBot: boolean | undefined
) {
  const nextClaims = { ...(baseClaims ?? {}) };

  if (typeof isBot !== 'undefined') {
    nextClaims.isBot = isBot;
  }

  if (Object.keys(nextClaims).length === 0) {
    await adminAuth.setCustomUserClaims(uid, null);
    return;
  }

  await adminAuth.setCustomUserClaims(uid, nextClaims);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.warn('Aborting: refusing to seed auth users in production.');
    process.exit(1);
  }

  const results = [] as { uid: string; created: boolean; isBot?: boolean }[];

  for (const user of seedUsers) {
    const { created, claims, uid } = await ensureUser(user);
    await applyClaims(uid, claims, user.isBot);
    results.push({ uid, created, isBot: user.isBot ?? false });
  }

  const realUser = seedUsers[0];

  console.log('Firebase Auth seeding complete.');
  console.table(
    results.map(({ uid, created, isBot }) => ({
      uid,
      created,
      isBot,
    }))
  );

  console.log(`\nPrimary test account: ${realUser.email} / ${REAL_USER_PASSWORD}`);
  console.log('Bot accounts created with isBot=true custom claim.');
}

main().catch((error) => {
  console.error('Failed to seed Firebase Auth users.', error);
  process.exit(1);
});
