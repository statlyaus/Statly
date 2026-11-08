#!/usr/bin/env node
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import * as readline from 'readline';

import { ingestFixtureRows, type FixtureMatch, type FixtureSourceRow } from './fixtureIngest';

// Reads fetch_fw_fixture.R's NDJSON from stdin and upserts Firestore `matches`. Every row is
// parsed and checked before the first write; any failure exits non-zero with nothing written.

function firestore() {
  if (getApps().length === 0) {
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (!encoded) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
    }
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
      projectId: serviceAccount.project_id,
    });
  }
  return getFirestore();
}

async function main(): Promise<void> {
  const rows: FixtureSourceRow[] = [];
  const lines = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    if (line.trim()) rows.push(JSON.parse(line) as FixtureSourceRow);
  }

  const db = firestore();
  const round = process.env.FIXTURE_ROUND ? Number(process.env.FIXTURE_ROUND) : undefined;
  const result = await ingestFixtureRows(rows, {
    now: new Date(),
    round,
    readStored: async (season) => {
      const snapshot = await db.collection('matches').where('season', '==', season).get();
      return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
    },
    write: async (matches: FixtureMatch[]) => {
      // Firestore batches hold at most 500 writes.
      for (let start = 0; start < matches.length; start += 400) {
        const batch = db.batch();
        for (const match of matches.slice(start, start + 400)) {
          batch.set(
            db.collection('matches').doc(match.match_uid),
            { ...match, last_updated: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        await batch.commit();
      }
    },
  });

  console.log(`Fixture ingest: ${result.matches} matches, ${result.written} written`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fixture ingest failed:', error);
    process.exitCode = 1;
  });
}
