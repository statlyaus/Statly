#!/usr/bin/env tsx

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GOOGLE_CLOUD_PROJECT ??= 'statly-4cbed';
process.env.GCLOUD_PROJECT ??= process.env.GOOGLE_CLOUD_PROJECT;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.GOOGLE_CLOUD_PROJECT;

async function main() {
  const { adminAuth, adminDb } = await import('../../src/lib/firebaseAdmin');
  const { prisma } = await import('../../src/lib/prisma');
  const {
    DEVELOPMENT_AUTH_DISPLAY_NAME,
    DEVELOPMENT_AUTH_EMAIL,
    DEVELOPMENT_AUTH_USER_ID,
    resolveLocalDevelopmentAuthPhrase,
  } = await import('../../src/lib/devAuth');
  const localAuthPhrase = resolveLocalDevelopmentAuthPhrase();

  try {
    await adminAuth.getUser(DEVELOPMENT_AUTH_USER_ID);
    await adminAuth.updateUser(DEVELOPMENT_AUTH_USER_ID, {
      email: DEVELOPMENT_AUTH_EMAIL,
      password: localAuthPhrase,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[local-seed] Updated Auth emulator user ${DEVELOPMENT_AUTH_USER_ID}`);
  } catch {
    await adminAuth.createUser({
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      password: localAuthPhrase,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[local-seed] Created Auth emulator user ${DEVELOPMENT_AUTH_USER_ID}`);
  }

  await prisma.user.upsert({
    where: { id: DEVELOPMENT_AUTH_USER_ID },
    update: {
      email: DEVELOPMENT_AUTH_EMAIL,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      timeZone: 'Australia/Melbourne',
    },
    create: {
      id: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      passwordHash: 'local_emulator_user',
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      timeZone: 'Australia/Melbourne',
    },
  });
  console.log(`[local-seed] Upserted Prisma user ${DEVELOPMENT_AUTH_USER_ID}`);

  await adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID).set(
    {
      uid: DEVELOPMENT_AUTH_USER_ID,
      email: DEVELOPMENT_AUTH_EMAIL,
      displayName: DEVELOPMENT_AUTH_DISPLAY_NAME,
      localStack: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log(`[local-seed] Upserted Firestore user ${DEVELOPMENT_AUTH_USER_ID}`);

  console.log(`[local-seed] Local login ready: ${DEVELOPMENT_AUTH_EMAIL} / ${localAuthPhrase}`);
}

main().catch((error) => {
  console.error('[local-seed] Failed to seed local stack', error);
  process.exit(1);
});
