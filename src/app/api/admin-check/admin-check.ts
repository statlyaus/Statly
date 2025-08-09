import { adminDb } from '@/lib/firebaseAdmin';

type HealthDoc = {
  ok?: boolean;
  ts?: number;
};

export type AdminCheckResult = {
  ok: boolean;
  env: {
    hasBase64: boolean;
    hasTriplet: boolean;
    FIREBASE_PROJECT_ID: boolean;
    FIREBASE_CLIENT_EMAIL: boolean;
    FIREBASE_PRIVATE_KEY: boolean;
  };
  firestoreOk?: boolean;
  error?: string;
};

export async function adminCheck(): Promise<AdminCheckResult> {
  // --- env checks (no anys) ---
  const hasBase64 = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim());
  const hasTriplet =
    Boolean(process.env.FIREBASE_PROJECT_ID) &&
    Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
    Boolean(process.env.FIREBASE_PRIVATE_KEY);

  // --- typed collection instead of `any` ---
  const col = adminDb.collection('__healthcheck') as FirebaseFirestore.CollectionReference<HealthDoc>;

  try {
    // read
    const snap = await col.limit(1).get();
    let firestoreOk = false;

    if (!snap.empty) {
      const d = snap.docs[0];
      const data = d.data(); // HealthDoc
      firestoreOk = typeof data?.ok === 'boolean' ? data.ok! : true;
    } else {
      // write a heartbeat doc if none exists
      await col.doc('heartbeat').set({ ok: true, ts: Date.now() });
      firestoreOk = true;
    }

    return {
      ok: firestoreOk,
      env: {
        hasBase64,
        hasTriplet,
        FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
        FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
        FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      },
      firestoreOk,
    };
  } catch (err: unknown) {
    // use `unknown`, then narrow
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';

    return {
      ok: false,
      env: {
        hasBase64,
        hasTriplet,
        FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
        FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
        FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      },
      error: message,
    };
  }
}