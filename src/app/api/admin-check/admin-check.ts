import { adminDb } from '@/lib/firebaseAdmin';

type HealthDoc = { ok?: boolean; ts?: number };

export type AdminCheckResult = {
  ok: boolean;
  env: {
    hasBase64: boolean;
  };
  firestoreOk?: boolean;
  error?: string;
};

export async function adminCheck(): Promise<AdminCheckResult> {
  // Snapshot env booleans once
  const envFlags = {
    hasBase64: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim()),
  };

  // Typed converter (avoids `as` casts)
  const converter = {
    toFirestore: (d: HealthDoc) => d,
    fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot): HealthDoc =>
      snap.data() as HealthDoc,
  };
  const col = adminDb.collection('__healthcheck').withConverter(converter);

  try {
    const snap = await col.limit(1).get();
    let firestoreOk = false;

    if (!snap.empty) {
      const data = snap.docs[0].data();
      firestoreOk = typeof data.ok === 'boolean' ? data.ok : true;
    } else if (process.env.NODE_ENV !== 'production') {
      // Seed a heartbeat doc in non‑prod if collection is empty
      await col.doc('heartbeat').set({ ok: true, ts: Date.now() });
      firestoreOk = true;
    }

    return { ok: firestoreOk, env: envFlags, firestoreOk };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
    return { ok: false, env: envFlags, error: message };
  }
}