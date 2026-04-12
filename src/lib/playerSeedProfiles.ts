import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { normalizeAflPosition } from './playerSeedPosition';

export type SeedPlayerProfile = {
  name: string;
  team?: string;
  position: 'DEF' | 'MID' | 'FWD' | 'RUC';
};

function normalizeName(value: string): string {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function getServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<
      string,
      string
    >;
    return {
      projectId: parsed.project_id ?? parsed.projectId,
      clientEmail: parsed.client_email ?? parsed.clientEmail,
      privateKey: String(parsed.private_key ?? parsed.privateKey ?? '').replace(/\\n/g, '\n'),
    };
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

let cachedProfiles: Map<string, SeedPlayerProfile> | null = null;

export async function loadSupplementalSeedProfiles(): Promise<Map<string, SeedPlayerProfile>> {
  if (cachedProfiles) return cachedProfiles;

  const profiles = new Map<string, SeedPlayerProfile>();
  const sa = getServiceAccount();
  if (!sa && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    cachedProfiles = profiles;
    return profiles;
  }

  try {
    if (getApps().length === 0) {
      initializeApp(
        sa
          ? {
              credential: cert({
                projectId: sa.projectId,
                clientEmail: sa.clientEmail,
                privateKey: sa.privateKey,
              }),
              projectId: sa.projectId,
            }
          : { credential: applicationDefault() }
      );
    }

    const db = getFirestore();
    const snap = await db.collection('players').limit(5000).get();

    snap.forEach((doc) => {
      const data = doc.data() as {
        name?: string;
        full_name?: string;
        displayName?: string;
        team?: string;
        club?: string;
        current_team?: string;
        primaryPosition?: string;
        position?: string;
        positions?: string[];
      };

      const name = String(data.full_name ?? data.displayName ?? data.name ?? '').trim();
      if (!name) return;

      const position = normalizeAflPosition(
        data.primaryPosition ?? data.position ?? data.positions?.[0] ?? ''
      );
      if (!position) return;

      const key = normalizeName(name);
      if (!key) return;

      profiles.set(key, {
        name,
        team: String(data.current_team ?? data.team ?? data.club ?? '').trim() || undefined,
        position,
      });
    });
  } catch {
    // Best-effort enrichment only. Seeds continue without remote profiles.
  }

  cachedProfiles = profiles;
  return profiles;
}

export function buildSeedProfileKey(name: string): string {
  return normalizeName(name);
}
