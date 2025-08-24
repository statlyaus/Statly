// Best-effort: mark as server-only in Next.js; ignore if package is unavailable in non-Next runtimes.
void import('server-only').catch(() => undefined);

// Hybrid Admin initializer: prefers base64 service account, falls back to ADC
import { getApps, initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function resolveCredential() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64 && b64.trim().length > 0) {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return cert(parsed);
  }
  return applicationDefault();
}

const app: App =
  getApps()[0] ??
  initializeApp({
    credential: resolveCredential(),
  });

export const db = getFirestore(app);
// Back-compat exports used around the codebase
export const adminDb = db;
export const adminAuth = getAuth(app);
