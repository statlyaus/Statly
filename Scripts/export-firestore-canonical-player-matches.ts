#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { createHash } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { adminDb } from '../src/lib/firebaseAdmin';
import {
  buildCanonicalPlayerMatchWarehouseRow,
  type CanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from '../src/lib/warehouse/canonicalPlayerMatchRow';

type Args = {
  season: number;
  rounds: number[];
  outDir: string;
};

type RejectedRow = {
  docId: string;
  error: string;
};

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);

  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseRounds(roundsRaw: string | null): number[] {
  if (roundsRaw == null) return [];
  if (roundsRaw.trim() === '') {
    throw new Error('Expected --rounds as comma-separated non-negative integers');
  }

  const tokens = roundsRaw.split(',');
  const rounds = tokens.map((token) => {
    const trimmed = token.trim();
    if (trimmed === '') {
      throw new Error(
        'Expected --rounds as comma-separated non-negative integers'
      );
    }

    const round = Number(trimmed);
    if (!Number.isInteger(round) || round < 0) {
      throw new Error(
        'Expected --rounds as comma-separated non-negative integers'
      );
    }

    return round;
  });

  return [...new Set(rounds)].sort((a, b) => a - b);
}

function parseArgs(argv: string[]): Args {
  const season = Number(readArg(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  return {
    season,
    rounds: parseRounds(readArg(argv, '--rounds')),
    outDir: readArg(argv, '--out-dir') ?? 'tmp/warehouse-export',
  };
}

async function loadFirestoreDocs(
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

  return [...docsById.values()];
}

function sortWarehouseRows(
  rows: CanonicalPlayerMatchWarehouseRow[]
): CanonicalPlayerMatchWarehouseRow[] {
  return rows.sort((a, b) => {
    return (
      a.season - b.season ||
      a.roundNumber - b.roundNumber ||
      a.matchId.localeCompare(b.matchId) ||
      a.playerId.localeCompare(b.playerId) ||
      a.firestoreDocId.localeCompare(b.firestoreDocId)
    );
  });
}

async function exportPlayerMatches(args: Args): Promise<number> {
  mkdirSync(args.outDir, { recursive: true });

  const roundSuffix =
    args.rounds.length > 0 ? `r${args.rounds.join('-')}` : 'all-rounds';
  const loadId = `firestore-player-match-${args.season}-${roundSuffix}-${Date.now()}`;
  const ndjsonPath = path.join(args.outDir, `${loadId}.ndjson`);
  const manifestPath = path.join(args.outDir, `${loadId}.manifest.json`);

  const docs = await loadFirestoreDocs(args);
  const rows: CanonicalPlayerMatchWarehouseRow[] = [];
  const rejected: RejectedRow[] = [];

  for (const doc of docs) {
    const data = {
      ...doc.data(),
      id: doc.id,
    } as FirestoreCanonicalPlayerMatchDocument;

    try {
      rows.push(buildCanonicalPlayerMatchWarehouseRow(data));
    } catch (error) {
      rejected.push({
        docId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  sortWarehouseRows(rows);
  rejected.sort((a, b) => a.docId.localeCompare(b.docId));
  await pipeline(
    Readable.from(rows.map((row) => `${JSON.stringify(row)}\n`)),
    createWriteStream(ndjsonPath, { encoding: 'utf8' })
  );

  const artifactSha256 = createHash('sha256')
    .update(readFileSync(ndjsonPath))
    .digest('hex');
  const manifest = {
    loadId,
    sourceSystem: 'firestore',
    sourceCollection: 'player_match_stats',
    season: args.season,
    rounds: args.rounds,
    ndjsonPath,
    artifactSha256,
    exportedRows: rows.length,
    rejectedRows: rejected.length,
    rejected,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { ok: rejected.length === 0, manifestPath, ...manifest },
      null,
      2
    )
  );

  return rejected.length === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  let exitCode = 1;

  try {
    exitCode = await exportPlayerMatches(parseArgs(process.argv.slice(2)));
  } catch (error) {
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
  } finally {
    await adminDb.terminate().catch(() => undefined);
  }

  process.exit(exitCode);
}

void main();
