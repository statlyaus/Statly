#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { prisma } from '../src/lib/prisma';
import { getServiceAccountFromEnv } from '../src/lib/serviceAccount';
import { replayUnresolvedPlayerStatRows } from '../src/server/playerIdentityReplay';

type Options = {
  season?: number;
  limit?: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Options {
  const seasonArg = argv.find((arg) => arg.startsWith('--season='))?.split('=')[1];
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? Number(limitArg) : undefined;

  return {
    season: seasonArg ? Number(seasonArg) : undefined,
    limit: Number.isFinite(limit) && limit && limit > 0 ? limit : undefined,
    dryRun: argv.includes('--dry-run'),
  };
}

function initializeAdminDb() {
  if (getApps().length === 0) {
    try {
      const serviceAccount = getServiceAccountFromEnv();
      initializeApp({
        credential: cert({
          projectId: serviceAccount.projectId,
          clientEmail: serviceAccount.clientEmail,
          privateKey: String(serviceAccount.privateKey).replace(/\\n/g, '\n'),
        }),
        projectId: serviceAccount.projectId,
      });
    } catch {
      initializeApp({
        credential: applicationDefault(),
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ??
          process.env.GCLOUD_PROJECT ??
          process.env.FIREBASE_PROJECT_ID ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
  }

  return getFirestore();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adminDb = options.dryRun ? null : initializeAdminDb();
  const result = await replayUnresolvedPlayerStatRows({
    prisma,
    firestore: adminDb,
    season: options.season,
    limit: options.limit,
    dryRun: options.dryRun,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: options.dryRun,
        ...result,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
