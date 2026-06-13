#!/usr/bin/env tsx

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GOOGLE_CLOUD_PROJECT ??= 'statly-4cbed';
process.env.GCLOUD_PROJECT ??= process.env.GOOGLE_CLOUD_PROJECT;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.GOOGLE_CLOUD_PROJECT;

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SOCKET_HEALTH_URL = process.env.SOCKET_HEALTH_URL ?? 'http://localhost:3002/health';
const AUTH_EMULATOR_URL =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

async function assertFetchOk(label: string, input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} failed with ${response.status} ${response.statusText}: ${body}`);
  }
  console.log(`[local-smoke] ${label}: ${response.status}`);
  return response;
}

async function assertAuthLogin(email: string, password: string): Promise<void> {
  const response = await assertFetchOk(
    'Firebase Auth emulator sign-in',
    `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  const payload = asRecord(await response.json());
  if (payload.email !== email || typeof payload.idToken !== 'string') {
    throw new Error('Firebase Auth emulator sign-in did not return the seeded user token');
  }
}

async function main() {
  const { adminDb } = await import('../../src/lib/firebaseAdmin');
  const {
    DEVELOPMENT_AUTH_EMAIL,
    DEVELOPMENT_AUTH_USER_ID,
    resolveLocalDevelopmentAuthPhrase,
  } = await import('../../src/lib/devAuth');
  const localAuthPhrase = resolveLocalDevelopmentAuthPhrase();

  await assertFetchOk('Next app', `${BASE_URL}/`);

  const healthResponse = await assertFetchOk('Socket.IO health', SOCKET_HEALTH_URL);
  const health = asRecord(await healthResponse.json());
  if (health.status !== 'healthy') {
    throw new Error(`Socket.IO health returned unexpected status: ${String(health.status)}`);
  }

  await assertAuthLogin(DEVELOPMENT_AUTH_EMAIL, localAuthPhrase);

  const userDoc = await adminDb.collection('users').doc(DEVELOPMENT_AUTH_USER_ID).get();
  if (!userDoc.exists) {
    throw new Error(`Firestore emulator missing seeded user ${DEVELOPMENT_AUTH_USER_ID}`);
  }
  console.log(`[local-smoke] Firestore seeded user: ${DEVELOPMENT_AUTH_USER_ID}`);

  const draftResponse = await assertFetchOk('Create full local test draft', `${BASE_URL}/api/create-test-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const draftPayload = asRecord(await draftResponse.json());
  const data = asRecord(draftPayload.data);
  const draft = asRecord(data.draft);
  if (draft.teamCount !== 12 || typeof draft.id !== 'string' || typeof draft.url !== 'string') {
    throw new Error('Local test draft response did not contain a full 12-team draft');
  }

  console.log(`[local-smoke] Draft ready: ${draft.url}`);
}

main().catch((error) => {
  console.error('[local-smoke] Failed', error);
  process.exit(1);
});
