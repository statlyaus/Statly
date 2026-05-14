#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import {
  buildCanonicalPlayerMatchWarehouseRow,
  type CanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from '../src/lib/warehouse/canonicalPlayerMatchRow';

type AdminDb = Awaited<typeof import('../src/lib/firebaseAdmin')>['adminDb'];

type Args = {
  season: number;
  rounds: number[];
  json: boolean;
};

type RejectedRow = {
  docId: string;
  error: string;
};

type VerificationOutput = {
  ok: boolean;
  status: 'pass' | 'fail';
  season: number;
  rounds: number[];
  counts: {
    firestoreDocuments: number;
    firestoreCanonicalRows: number;
    rejectedFirestoreRows: number;
    acceptedCanonicalRows: number;
    rejectedCanonicalRows: number;
  };
  rejected: RejectedRow[];
  note: string;
};

const ROUND_ARGUMENT_ERROR =
  'Expected --rounds as comma-separated non-negative integers';
const INTEGER_TOKEN_PATTERN = /^(0|[1-9]\d*)$/;

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);

  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseRounds(roundsRaw: string | null): number[] {
  if (roundsRaw == null) return [];
  if (roundsRaw.trim() === '') throw new Error(ROUND_ARGUMENT_ERROR);

  const rounds = roundsRaw.split(',').map((token) => {
    const trimmed = token.trim();
    if (!INTEGER_TOKEN_PATTERN.test(trimmed)) {
      throw new Error(ROUND_ARGUMENT_ERROR);
    }

    const round = Number(trimmed);
    if (!Number.isSafeInteger(round)) {
      throw new Error(ROUND_ARGUMENT_ERROR);
    }

    return round;
  });

  return [...new Set(rounds)].sort((a, b) => a - b);
}

function parseArgs(argv: string[]): Args {
  const seasonRaw = readArg(argv, '--season');
  if (seasonRaw == null || !INTEGER_TOKEN_PATTERN.test(seasonRaw.trim())) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  const season = Number(seasonRaw.trim());
  if (!Number.isSafeInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  return {
    season,
    rounds: parseRounds(readArg(argv, '--rounds')),
    json: argv.includes('--json'),
  };
}

async function loadFirestoreDocs(
  adminDb: AdminDb,
  args: Args
): Promise<QueryDocumentSnapshot[]> {
  const docsById = new Map<string, QueryDocumentSnapshot>();

  const queries: Query[] =
    args.rounds.length > 0
      ? args.rounds.map((round) =>
          adminDb
            .collection('player_match_stats')
            .where('season', '==', args.season)
            .where('round_number', '==', round)
        )
      : [
          adminDb
            .collection('player_match_stats')
            .where('season', '==', args.season),
        ];

  for (const query of queries) {
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      docsById.set(doc.id, doc);
    }
  }

  return [...docsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function compareWarehouseRows(
  a: CanonicalPlayerMatchWarehouseRow,
  b: CanonicalPlayerMatchWarehouseRow
): number {
  return (
    a.season - b.season ||
    a.roundNumber - b.roundNumber ||
    a.matchId.localeCompare(b.matchId) ||
    a.playerId.localeCompare(b.playerId) ||
    a.firestoreDocId.localeCompare(b.firestoreDocId)
  );
}

async function verifyFirestoreCanonicalExportability(
  adminDb: AdminDb,
  args: Args
): Promise<VerificationOutput> {
  const docs = await loadFirestoreDocs(adminDb, args);
  const acceptedRows: CanonicalPlayerMatchWarehouseRow[] = [];
  const rejected: RejectedRow[] = [];

  for (const doc of docs) {
    const data = {
      ...doc.data(),
      id: doc.id,
    } as FirestoreCanonicalPlayerMatchDocument;

    try {
      acceptedRows.push(buildCanonicalPlayerMatchWarehouseRow(data));
    } catch (error) {
      rejected.push({
        docId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  acceptedRows.sort(compareWarehouseRows);
  rejected.sort(
    (a, b) => a.docId.localeCompare(b.docId) || a.error.localeCompare(b.error)
  );

  const ok = rejected.length === 0;

  return {
    ok,
    status: ok ? 'pass' : 'fail',
    season: args.season,
    rounds: args.rounds,
    counts: {
      firestoreDocuments: docs.length,
      firestoreCanonicalRows: acceptedRows.length,
      rejectedFirestoreRows: rejected.length,
      acceptedCanonicalRows: acceptedRows.length,
      rejectedCanonicalRows: rejected.length,
    },
    rejected,
    note:
      'This verifier proves Firestore canonical exportability. Future extension should compare warehouse rows after real MotherDuck loads, including counts, keys, values, presence, and provenance.',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { adminDb } = await import('../src/lib/firebaseAdmin');
  let exitCode = 1;

  try {
    const output = await verifyFirestoreCanonicalExportability(adminDb, args);
    console.log(JSON.stringify(output, null, 2));
    exitCode = output.ok ? 0 : 1;
  } finally {
    await adminDb.terminate().catch(() => undefined);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
