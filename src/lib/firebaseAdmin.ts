// Hybrid Admin initializer: prefers base64 service account, falls back to ADC
import { getApps, initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let serviceAccountProjectId: string | undefined;
let credentialSource: 'base64' | 'adc' = 'adc';

function resolveCredential() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const usingB64 = !!(b64 && b64.trim().length > 0);
  try {
    if (usingB64) {
      const json = Buffer.from(b64, 'base64').toString('utf8');
      const parsed = JSON.parse(json);
      if (typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      if (!parsed.project_id) {
        console.warn('[firebaseAdmin] Service account JSON is missing project_id field');
      }
      serviceAccountProjectId = parsed.project_id;
      credentialSource = 'base64';
      console.log(
        '[firebaseAdmin] Using service account credential from env (base64). Project:',
        serviceAccountProjectId || 'unknown'
      );
      return cert(parsed);
    }
  } catch (err) {
    console.warn(
      '[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, falling back to ADC.',
      err
    );
  }
  credentialSource = 'adc';
  console.log('[firebaseAdmin] Using application default credentials (ADC).');
  return applicationDefault();
}

const credential = resolveCredential();
const projectId =
  serviceAccountProjectId ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

// Validate projectId before initializing the Admin SDK
if (!projectId) {
  console.warn(
    '[firebaseAdmin] No Firebase projectId resolved. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 with project_id, or set GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / NEXT_PUBLIC_FIREBASE_PROJECT_ID.'
  );
  // If strict guarantees are required, uncomment to fail fast:
  // throw new Error('[firebaseAdmin] Missing Firebase projectId. Aborting firebase-admin initialization.');
}

const app: App =
  getApps()[0] ??
  initializeApp({
    credential,
    ...(projectId ? { projectId } : {}),
  });

const db = getFirestore(app);

try {
  const opts = (app as unknown as { options?: { projectId?: string } })?.options;
  const debugProject =
    opts?.projectId ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_CONFIG;
  console.log(
    '[firebaseAdmin] Firestore initialized. Project:',
    debugProject ? String(debugProject) : 'unknown',
    '| Credential:',
    credentialSource
  );
} catch (e) {
  console.warn('[firebaseAdmin] Could not log project debug info:', e);
}

// Back-compat exports used around the codebase
export const adminDb = db;
export const adminAuth = getAuth(app);
// Backwards-compatible alias for legacy imports expecting { db }
export { db };
