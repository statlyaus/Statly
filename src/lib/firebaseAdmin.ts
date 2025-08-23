// Best-effort: mark as server-only in Next.js; ignore if package is unavailable in non-Next runtimes.
void import('server-only').catch(() => undefined);
import admin from 'firebase-admin';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

if (!admin.apps.length) {
  const decoded = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf-8');

  let saJson: unknown;
  try {
    saJson = JSON.parse(decoded);
  } catch (err) {
    logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON_BASE64', {
      envVar: 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
      error: err instanceof Error ? err.message : String(err),
      decodedPrefix: decoded.slice(0, 120),
      decodedLength: decoded.length,
    });
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: JSON parse failed');
  }

  const obj = saJson as Record<string, unknown>;
  const project_id = typeof obj.project_id === 'string' ? obj.project_id : '';
  const client_email = typeof obj.client_email === 'string' ? obj.client_email : '';
  const private_key = typeof obj.private_key === 'string' ? obj.private_key : '';

  const missing: string[] = [];
  if (!project_id) missing.push('project_id');
  if (!client_email) missing.push('client_email');
  if (!private_key) missing.push('private_key');

  if (missing.length) {
    logger.error('Service account JSON missing required keys', {
      envVar: 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
      missing,
      decodedPrefix: decoded.slice(0, 120),
      decodedLength: decoded.length,
    });
    throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: missing ${missing.join(', ')}`);
  }

  // Ensure private key newlines are correctly formatted when coming from env/base64
  const privateKey = private_key.includes('\\n') ? private_key.replace(/\\n/g, '\n') : private_key;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: project_id,
      clientEmail: client_email,
      privateKey,
    }),
    projectId: project_id,
  });
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
