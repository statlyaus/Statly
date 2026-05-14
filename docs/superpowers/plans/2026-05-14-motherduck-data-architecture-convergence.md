# MotherDuck Data Architecture Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MotherDuck as Statly's governed analytical warehouse for Firestore canonical AFL data without weakening Firestore's operational raw-match contract or Prisma's identity/read-model responsibilities.

**Architecture:** Firestore remains the operational canonical write boundary for resolved Footywire player-match documents. MotherDuck becomes an append-safe, reproducible analytical mirror with typed canonical fact tables, load manifests, reconciliation reports, and promotion gates; app-serving Prisma read models continue to rebuild from the canonical contract until warehouse parity is proven for a full season. The final architecture has one semantic contract, many optimized projections, and no permanent fallback readers.

**Tech Stack:** TypeScript, Next.js App Router, Firebase Admin Firestore, Prisma SQLite, Vitest, DuckDB-compatible SQL, MotherDuck, NDJSON artifacts, existing `verify:player-read-models` reconciliation tooling.

---

## Operating Principles

- Firestore `player_match_stats` remains the source of truth for canonical resolved raw match documents during this program.
- MotherDuck must not become a second semantic writer. It receives canonical facts, load metadata, and derived analytical views.
- Prisma `Player`, `PlayerAlias`, `PlayerSeasonRegistration`, and `UnresolvedPlayerStatRow` remain the canonical player identity/quarantine system.
- Prisma projection tables remain serving read models and must stay rebuildable.
- A warehouse table is accepted only when it is derived from the canonical Firestore contract and has a verifier proving row counts, identity, stat presence, provenance, and values.
- No route should query MotherDuck for app-facing behavior until a later promotion task proves exact convergence and adds explicit fallback policy.

## Subagent Execution Model

Use one fresh worker per task. Each worker owns only the files listed in its task. Workers are not alone in the codebase: they must not revert edits made by other workers and must adapt to merged changes.

Recommended dispatch:

1. Worker A: Task 1, contract closure and tests.
2. Worker B: Task 2, warehouse schema files and SQL validation tests.
3. Worker C: Task 3, Firestore export mapping and tests.
4. Worker D: Task 4, MotherDuck load client and dry-run tests.
5. Worker E: Task 5, warehouse verifier.
6. Worker F: Task 6, orchestration script and audit manifest.
7. Worker G: Task 7, docs and runbooks.
8. Worker H: Task 8, final integration verification.

Do not run Tasks 4-8 before Tasks 1-3 are merged and reviewed.

## File Structure

- Create `src/lib/warehouse/canonicalPlayerMatchRow.ts`: pure mapper from Firestore canonical raw document to a stable warehouse row shape.
- Create `src/lib/warehouse/canonicalPlayerMatchRow.test.ts`: tests for canonical-only mapping, zero/presence semantics, provenance, and rejection of non-canonical docs.
- Create `src/lib/warehouse/motherduckSql.ts`: SQL text builders for schemas, staging tables, merge/upsert, and information-schema validation.
- Create `src/lib/warehouse/motherduckSql.test.ts`: string-level SQL tests that prove table names, keys, and required columns are stable.
- Create `src/lib/warehouse/motherduckClient.ts`: small boundary around DuckDB/MotherDuck execution with an injectable query runner.
- Create `src/lib/warehouse/motherduckClient.test.ts`: unit tests using an in-memory fake query runner.
- Create `Scripts/export-firestore-canonical-player-matches.ts`: read-only Firestore export to local NDJSON and manifest.
- Create `Scripts/load-canonical-player-matches-to-motherduck.ts`: load exported NDJSON into staging tables and merge into curated tables.
- Create `Scripts/verify-motherduck-player-matches.ts`: compare MotherDuck curated rows against Firestore raw rows and Prisma projection outputs for a bounded scope.
- Modify `package.json`: add scripts only after the script files exist.
- Modify `docs/DATA_RELIABILITY.md`: document the new analytical warehouse lane without changing Lane A serving behavior.
- Create `docs/MOTHERDUCK_DATA_ARCHITECTURE.md`: authoritative runbook and architecture contract for the warehouse mirror.
- Modify `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`: record that MotherDuck is a mirror/analytics layer, not a new source of semantic truth.

---

### Task 1: Close The Canonical Firestore-To-Warehouse Row Contract

**Files:**
- Create: `src/lib/warehouse/canonicalPlayerMatchRow.ts`
- Create: `src/lib/warehouse/canonicalPlayerMatchRow.test.ts`
- Read: `src/lib/stats/footywireCanonicalContract.ts`
- Read: `src/lib/stats/statColumns.ts`

**Purpose:** Define the exact row shape MotherDuck receives from Firestore. This prevents the warehouse loader from reading top-level legacy stats, `data.stats`, or `raw_row` as semantic inputs.

- [ ] **Step 1: Write failing mapper tests**

Create `src/lib/warehouse/canonicalPlayerMatchRow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from './canonicalPlayerMatchRow';
import {
  buildFootywireCanonicalRawMatchContract,
  type FootywireCanonicalStats,
} from '@/lib/stats/footywireCanonicalContract';

function buildStats(overrides: Partial<FootywireCanonicalStats> = {}): FootywireCanonicalStats {
  return {
    kicks: 0,
    handballs: 0,
    disposals: 0,
    marks: 0,
    tackles: 0,
    goals: 0,
    behinds: 0,
    hit_outs: 0,
    clearances: 0,
    inside_50s: 0,
    rebound_50s: 0,
    clangers: 0,
    contested_possessions: 0,
    uncontested_possessions: 0,
    frees_for: 0,
    frees_against: 0,
    one_percenters: 0,
    goal_assists: 0,
    turnovers: 0,
    intercepts: 0,
    metres_gained: 0,
    contested_marks: 0,
    effective_disposals: 0,
    score_involvements: 0,
    minutes: 0,
    tog_pct: 0,
    disposal_efficiency: 0,
    ...overrides,
  };
}

function buildDocument(
  overrides: Partial<FirestoreCanonicalPlayerMatchDocument> = {}
): FirestoreCanonicalPlayerMatchDocument {
  return {
    id: '2026-R1-COL-ADE-nick_daicos',
    match_id: '2026-R1-COL-ADE',
    player_id: 'nick_daicos',
    season: 2026,
    round_number: 1,
    player_name: 'Nick Daicos',
    team: 'Collingwood',
    opposition: 'Adelaide',
    match_date: '2026-03-20',
    data_source: 'afltables,footywire_match',
    raw_checksum: 'checksum-1',
    canonical_stats: buildFootywireCanonicalRawMatchContract({
      stats: buildStats({ disposals: 32, metres_gained: 0 }),
      availability: { disposals: true, metres_gained: true, disposal_efficiency: false },
      provenance: { disposals: 'footywire_match', metres_gained: 'afltables' },
      sourceName: 'fitzroy_merged',
      sourcePriority: ['footywire_match', 'afltables'],
      rawSourceRows: { footywire_match: { row: 1 } },
    }),
    canonical_match_metadata: {
      match_date: '2026-03-20',
      start_time_utc: '2026-03-20T08:40:00.000Z',
      venue: 'MCG',
      status: 'final',
    },
    ...overrides,
  };
}

describe('buildCanonicalPlayerMatchWarehouseRow', () => {
  it('maps only the canonical Firestore contract into warehouse columns', () => {
    const row = buildCanonicalPlayerMatchWarehouseRow(buildDocument({
      stats: { disposals: 99 },
      raw_row: { disposals: 88 },
    } as unknown as Partial<FirestoreCanonicalPlayerMatchDocument>));

    expect(row).toMatchObject({
      firestoreDocId: '2026-R1-COL-ADE-nick_daicos',
      matchId: '2026-R1-COL-ADE',
      playerId: 'nick_daicos',
      season: 2026,
      roundNumber: 1,
      playerName: 'Nick Daicos',
      playerClub: 'Collingwood',
      opponent: 'Adelaide',
      disposals: 32,
      disposalsPresent: true,
      metresGained: 0,
      metresGainedPresent: true,
      disposalEffPctPresent: false,
      rawChecksum: 'checksum-1',
      contractVersion: 1,
    });
  });

  it('rejects Firestore rows without a canonical contract', () => {
    expect(() =>
      buildCanonicalPlayerMatchWarehouseRow(buildDocument({ canonical_stats: null }))
    ).toThrow('canonical_stats contract is required for warehouse export');
  });

  it('rejects Firestore rows without canonical identity', () => {
    expect(() => buildCanonicalPlayerMatchWarehouseRow(buildDocument({ player_id: null }))).toThrow(
      'player_id is required for warehouse export'
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run src/lib/warehouse/canonicalPlayerMatchRow.test.ts
```

Expected: FAIL because `src/lib/warehouse/canonicalPlayerMatchRow.ts` does not exist.

- [ ] **Step 3: Implement the canonical warehouse row mapper**

Create `src/lib/warehouse/canonicalPlayerMatchRow.ts`:

```ts
import {
  hasFootywireCanonicalRawMatchContract,
  readFootywireCanonicalStatNumber,
  readFootywireCanonicalStatPresence,
  readFootywireCanonicalStatProvenance,
} from '@/lib/stats/footywireCanonicalContract';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';

export type FirestoreCanonicalPlayerMatchDocument = {
  id: string;
  match_id?: unknown;
  matchUid?: unknown;
  match_uid?: unknown;
  player_id?: unknown;
  playerId?: unknown;
  season?: unknown;
  round?: unknown;
  round_number?: unknown;
  player_name?: unknown;
  team?: unknown;
  opposition?: unknown;
  match_date?: unknown;
  date?: unknown;
  data_source?: unknown;
  raw_checksum?: unknown;
  canonical_stats?: unknown;
  canonical_match_metadata?: unknown;
  last_seen_at?: unknown;
  last_updated?: unknown;
};

export type CanonicalPlayerMatchWarehouseRow = {
  firestoreDocId: string;
  contractVersion: number;
  matchId: string;
  playerId: string;
  season: number;
  roundNumber: number;
  playerName: string;
  playerClub: string;
  opponent: string;
  matchDate: string;
  startTimeUtc: string | null;
  venue: string | null;
  matchStatus: string | null;
  dataSource: string | null;
  rawChecksum: string | null;
  statsJson: string;
  availabilityJson: string;
  provenanceJson: string;
} & Record<CanonicalStatKey, number> &
  Record<`${CanonicalStatKey}Present`, boolean> &
  Record<`${CanonicalStatKey}Provenance`, string | null>;

function readRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new Error(`${field} is required for warehouse export`);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readRequiredNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${field} is required for warehouse export`);
}

function readMetadata(data: FirestoreCanonicalPlayerMatchDocument, key: string): unknown {
  const metadata = data.canonical_match_metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (metadata as Record<string, unknown>)[key];
}

export function buildCanonicalPlayerMatchWarehouseRow(
  data: FirestoreCanonicalPlayerMatchDocument
): CanonicalPlayerMatchWarehouseRow {
  if (!hasFootywireCanonicalRawMatchContract(data.canonical_stats)) {
    throw new Error('canonical_stats contract is required for warehouse export');
  }

  const stats = {} as Record<CanonicalStatKey, number>;
  const present = {} as Record<`${CanonicalStatKey}Present`, boolean>;
  const provenance = {} as Record<`${CanonicalStatKey}Provenance`, string | null>;

  for (const key of CANONICAL_STAT_KEYS) {
    stats[key] = readFootywireCanonicalStatNumber(data.canonical_stats, key).value;
    present[`${key}Present`] = readFootywireCanonicalStatPresence(
      data.canonical_stats,
      key
    ).hasValue;
    provenance[`${key}Provenance`] = readFootywireCanonicalStatProvenance(
      data.canonical_stats,
      key
    );
  }

  return {
    firestoreDocId: readRequiredString(data.id, 'id'),
    contractVersion: data.canonical_stats.version,
    matchId: readRequiredString(data.match_id ?? data.matchUid ?? data.match_uid, 'match_id'),
    playerId: readRequiredString(data.player_id ?? data.playerId, 'player_id'),
    season: readRequiredNumber(data.season, 'season'),
    roundNumber: readRequiredNumber(data.round_number ?? data.round, 'round_number'),
    playerName: readRequiredString(data.player_name, 'player_name'),
    playerClub: readRequiredString(data.team, 'team'),
    opponent: readRequiredString(data.opposition, 'opposition'),
    matchDate: readRequiredString(
      readMetadata(data, 'match_date') ?? data.match_date ?? data.date,
      'match_date'
    ),
    startTimeUtc: readOptionalString(readMetadata(data, 'start_time_utc')),
    venue: readOptionalString(readMetadata(data, 'venue')),
    matchStatus: readOptionalString(readMetadata(data, 'status')),
    dataSource: readOptionalString(data.data_source),
    rawChecksum: readOptionalString(data.raw_checksum),
    statsJson: JSON.stringify(data.canonical_stats.stats),
    availabilityJson: JSON.stringify(data.canonical_stats.availability),
    provenanceJson: JSON.stringify(data.canonical_stats.provenance),
    ...stats,
    ...present,
    ...provenance,
  };
}
```

- [ ] **Step 4: Run the mapper test**

Run:

```bash
npx vitest run src/lib/warehouse/canonicalPlayerMatchRow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/warehouse/canonicalPlayerMatchRow.ts src/lib/warehouse/canonicalPlayerMatchRow.test.ts
git commit -m "feat: define canonical warehouse player match row"
```

---

### Task 2: Define MotherDuck Curated Schema And Validation SQL

**Files:**
- Create: `src/lib/warehouse/motherduckSql.ts`
- Create: `src/lib/warehouse/motherduckSql.test.ts`
- Read: `src/lib/warehouse/canonicalPlayerMatchRow.ts`

**Purpose:** Create a deterministic schema for MotherDuck that stores canonical match facts, load manifests, and verification results. This task does not connect to MotherDuck.

- [ ] **Step 1: Write failing SQL builder tests**

Create `src/lib/warehouse/motherduckSql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildCreateWarehouseSchemaSql,
  buildMergeCanonicalPlayerMatchesSql,
  buildRequiredColumnValidationSql,
} from './motherduckSql';

describe('MotherDuck warehouse SQL builders', () => {
  it('creates curated canonical player match and load manifest tables', () => {
    const sql = buildCreateWarehouseSchemaSql({ schemaName: 'statly_warehouse' });

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS statly_warehouse');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS statly_warehouse.canonical_player_match');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS statly_warehouse.load_manifest');
    expect(sql).toContain('PRIMARY KEY (firestore_doc_id)');
    expect(sql).toContain('disposals DOUBLE');
    expect(sql).toContain('disposals_present BOOLEAN');
    expect(sql).toContain('provenance_json JSON');
  });

  it('merges staging rows by Firestore document id', () => {
    const sql = buildMergeCanonicalPlayerMatchesSql({
      schemaName: 'statly_warehouse',
      stagingTableName: 'staging_canonical_player_match_20260514',
    });

    expect(sql).toContain('MERGE INTO statly_warehouse.canonical_player_match AS target');
    expect(sql).toContain('USING statly_warehouse.staging_canonical_player_match_20260514 AS source');
    expect(sql).toContain('ON target.firestore_doc_id = source.firestore_doc_id');
    expect(sql).toContain('WHEN MATCHED THEN UPDATE');
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
  });

  it('validates required columns through information_schema', () => {
    const sql = buildRequiredColumnValidationSql({
      schemaName: 'statly_warehouse',
      tableName: 'canonical_player_match',
      requiredColumns: ['firestore_doc_id', 'player_id', 'season'],
    });

    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain("table_schema = 'statly_warehouse'");
    expect(sql).toContain("table_name = 'canonical_player_match'");
    expect(sql).toContain("'firestore_doc_id'");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run src/lib/warehouse/motherduckSql.test.ts
```

Expected: FAIL because `motherduckSql.ts` does not exist.

- [ ] **Step 3: Implement SQL builders**

Create `src/lib/warehouse/motherduckSql.ts`:

```ts
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';

export type WarehouseSqlParams = {
  schemaName: string;
};

function quoteIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return identifier;
}

function snakeStatKey(key: CanonicalStatKey): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function statColumnsSql(): string {
  return CANONICAL_STAT_KEYS.flatMap((key) => {
    const column = snakeStatKey(key);
    return [
      `${column} DOUBLE NOT NULL`,
      `${column}_present BOOLEAN NOT NULL`,
      `${column}_provenance VARCHAR`,
    ];
  }).join(',\n      ');
}

export function buildCreateWarehouseSchemaSql(params: WarehouseSqlParams): string {
  const schema = quoteIdentifier(params.schemaName);
  return `
CREATE SCHEMA IF NOT EXISTS ${schema};

CREATE TABLE IF NOT EXISTS ${schema}.load_manifest (
  load_id VARCHAR PRIMARY KEY,
  source_system VARCHAR NOT NULL,
  source_collection VARCHAR NOT NULL,
  season INTEGER,
  rounds_json JSON,
  exported_rows BIGINT NOT NULL,
  loaded_rows BIGINT NOT NULL DEFAULT 0,
  rejected_rows BIGINT NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL,
  artifact_path VARCHAR,
  artifact_sha256 VARCHAR,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ${schema}.canonical_player_match (
  firestore_doc_id VARCHAR PRIMARY KEY,
  contract_version INTEGER NOT NULL,
  match_id VARCHAR NOT NULL,
  player_id VARCHAR NOT NULL,
  season INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  player_name VARCHAR NOT NULL,
  player_club VARCHAR NOT NULL,
  opponent VARCHAR NOT NULL,
  match_date VARCHAR NOT NULL,
  start_time_utc VARCHAR,
  venue VARCHAR,
  match_status VARCHAR,
  data_source VARCHAR,
  raw_checksum VARCHAR,
  stats_json JSON NOT NULL,
  availability_json JSON NOT NULL,
  provenance_json JSON NOT NULL,
  ${statColumnsSql()},
  load_id VARCHAR,
  loaded_at TIMESTAMP NOT NULL DEFAULT now()
);
`;
}

export function buildRequiredColumnValidationSql(params: {
  schemaName: string;
  tableName: string;
  requiredColumns: string[];
}): string {
  const schema = quoteIdentifier(params.schemaName);
  const table = quoteIdentifier(params.tableName);
  const values = params.requiredColumns.map((column) => `('${column}')`).join(', ');
  return `
WITH required(column_name) AS (VALUES ${values})
SELECT required.column_name
FROM required
LEFT JOIN information_schema.columns actual
  ON actual.table_schema = '${schema}'
 AND actual.table_name = '${table}'
 AND actual.column_name = required.column_name
WHERE actual.column_name IS NULL
ORDER BY required.column_name;
`;
}

export function buildMergeCanonicalPlayerMatchesSql(params: {
  schemaName: string;
  stagingTableName: string;
}): string {
  const schema = quoteIdentifier(params.schemaName);
  const staging = quoteIdentifier(params.stagingTableName);
  return `
MERGE INTO ${schema}.canonical_player_match AS target
USING ${schema}.${staging} AS source
ON target.firestore_doc_id = source.firestore_doc_id
WHEN MATCHED THEN UPDATE SET
  contract_version = source.contract_version,
  match_id = source.match_id,
  player_id = source.player_id,
  season = source.season,
  round_number = source.round_number,
  player_name = source.player_name,
  player_club = source.player_club,
  opponent = source.opponent,
  match_date = source.match_date,
  start_time_utc = source.start_time_utc,
  venue = source.venue,
  match_status = source.match_status,
  data_source = source.data_source,
  raw_checksum = source.raw_checksum,
  stats_json = source.stats_json,
  availability_json = source.availability_json,
  provenance_json = source.provenance_json,
  load_id = source.load_id,
  loaded_at = now()
WHEN NOT MATCHED THEN INSERT BY NAME;
`;
}
```

- [ ] **Step 4: Run SQL tests**

Run:

```bash
npx vitest run src/lib/warehouse/motherduckSql.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/lib/warehouse/motherduckSql.ts src/lib/warehouse/motherduckSql.test.ts
git commit -m "feat: define MotherDuck warehouse schema SQL"
```

---

### Task 3: Export Canonical Firestore Rows To NDJSON With Manifest

**Files:**
- Create: `Scripts/export-firestore-canonical-player-matches.ts`
- Modify: `package.json`
- Test: `src/lib/warehouse/canonicalPlayerMatchRow.test.ts`

**Purpose:** Add a read-only export from Firestore to local NDJSON. This is the safest ingestion boundary because exported artifacts are inspectable, hashable, replayable, and can be loaded into MotherDuck independently.

- [ ] **Step 1: Add exporter argument and serialization test**

Append this test to `src/lib/warehouse/canonicalPlayerMatchRow.test.ts`:

```ts
it('serializes warehouse rows with stable camelCase keys for NDJSON export', () => {
  const row = buildCanonicalPlayerMatchWarehouseRow(buildDocument());

  expect(JSON.parse(JSON.stringify(row))).toMatchObject({
    firestoreDocId: '2026-R1-COL-ADE-nick_daicos',
    playerId: 'nick_daicos',
    season: 2026,
    roundNumber: 1,
    disposalsPresent: true,
  });
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
npx vitest run src/lib/warehouse/canonicalPlayerMatchRow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create the Firestore export script**

Create `Scripts/export-firestore-canonical-player-matches.ts`:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { adminDb } from '../src/lib/firebaseAdmin';
import {
  buildCanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from '../src/lib/warehouse/canonicalPlayerMatchRow';

type Args = {
  season: number;
  rounds: number[];
  outDir: string;
};

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  const season = Number(readArg(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  const roundsRaw = readArg(argv, '--rounds');
  const rounds =
    roundsRaw == null || roundsRaw.trim() === ''
      ? []
      : roundsRaw.split(',').map((value) => Number(value.trim())).filter(Number.isInteger);
  return {
    season,
    rounds,
    outDir: readArg(argv, '--out-dir') ?? 'tmp/warehouse-export',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });
  const roundSuffix = args.rounds.length > 0 ? `r${args.rounds.join('-')}` : 'all-rounds';
  const loadId = `firestore-player-match-${args.season}-${roundSuffix}-${Date.now()}`;
  const ndjsonPath = path.join(args.outDir, `${loadId}.ndjson`);
  const manifestPath = path.join(args.outDir, `${loadId}.manifest.json`);
  const stream = createWriteStream(ndjsonPath, { encoding: 'utf8' });

  let query: FirebaseFirestore.Query = adminDb
    .collection('player_match_stats')
    .where('season', '==', args.season);
  const snapshot = await query.get();

  let exportedRows = 0;
  let rejectedRows = 0;
  const rejected: Array<{ docId: string; error: string }> = [];

  for (const doc of snapshot.docs) {
    const data = { id: doc.id, ...doc.data() } as FirestoreCanonicalPlayerMatchDocument;
    const round = Number(data.round_number ?? data.round);
    if (args.rounds.length > 0 && !args.rounds.includes(round)) continue;
    try {
      stream.write(`${JSON.stringify(buildCanonicalPlayerMatchWarehouseRow(data))}\n`);
      exportedRows += 1;
    } catch (error) {
      rejectedRows += 1;
      rejected.push({
        docId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((error: Error | null | undefined) => (error ? reject(error) : resolve()));
  });

  const artifactSha256 = createHash('sha256').update(readFileSync(ndjsonPath)).digest('hex');
  const manifest = {
    loadId,
    sourceSystem: 'firestore',
    sourceCollection: 'player_match_stats',
    season: args.season,
    rounds: args.rounds,
    ndjsonPath,
    artifactSha256,
    exportedRows,
    rejectedRows,
    rejected,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: rejectedRows === 0, manifestPath, ...manifest }, null, 2));
  await adminDb.terminate();
  process.exit(rejectedRows === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  await adminDb.terminate().catch(() => undefined);
  process.exit(1);
});
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"warehouse:export:player-matches": "tsx Scripts/export-firestore-canonical-player-matches.ts"
```

- [ ] **Step 5: Run narrow tests**

Run:

```bash
npx vitest run src/lib/warehouse/canonicalPlayerMatchRow.test.ts
npm run typecheck:data
```

Expected: Vitest PASS. Typecheck may expose missing warehouse test inclusion; if `typecheck:data` excludes `src/lib/warehouse`, run `npm run typecheck:app` and keep the result in the task notes.

- [ ] **Step 6: Commit Task 3**

```bash
git add Scripts/export-firestore-canonical-player-matches.ts package.json src/lib/warehouse/canonicalPlayerMatchRow.test.ts
git commit -m "feat: export canonical Firestore matches for warehouse loads"
```

---

### Task 4: Add MotherDuck Load Boundary With Dry-Run Safety

**Files:**
- Create: `src/lib/warehouse/motherduckClient.ts`
- Create: `src/lib/warehouse/motherduckClient.test.ts`
- Create: `Scripts/load-canonical-player-matches-to-motherduck.ts`
- Modify: `package.json`
- Read: `src/lib/warehouse/motherduckSql.ts`

**Purpose:** Add the execution boundary for MotherDuck loads. The first version must support dry-run SQL rendering and fake-runner tests before any real warehouse mutation.

- [ ] **Step 1: Write fake-runner client tests**

Create `src/lib/warehouse/motherduckClient.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createMotherDuckClient, type WarehouseQueryRunner } from './motherduckClient';

describe('createMotherDuckClient', () => {
  it('runs schema setup, validation, and merge statements through the injected runner', async () => {
    const statements: string[] = [];
    const runner: WarehouseQueryRunner = {
      query: async (sql) => {
        statements.push(sql);
        return [];
      },
    };
    const client = createMotherDuckClient({ runner, schemaName: 'statly_warehouse' });

    await client.ensureSchema();
    await client.validateRequiredColumns('canonical_player_match', ['firestore_doc_id']);
    await client.mergeCanonicalPlayerMatches('staging_load_1');

    expect(statements[0]).toContain('CREATE SCHEMA IF NOT EXISTS statly_warehouse');
    expect(statements[1]).toContain('information_schema.columns');
    expect(statements[2]).toContain('MERGE INTO statly_warehouse.canonical_player_match');
  });
});
```

- [ ] **Step 2: Run failing client test**

Run:

```bash
npx vitest run src/lib/warehouse/motherduckClient.test.ts
```

Expected: FAIL because `motherduckClient.ts` does not exist.

- [ ] **Step 3: Implement injectable MotherDuck client boundary**

Create `src/lib/warehouse/motherduckClient.ts`:

```ts
import {
  buildCreateWarehouseSchemaSql,
  buildMergeCanonicalPlayerMatchesSql,
  buildRequiredColumnValidationSql,
} from './motherduckSql';

export type WarehouseQueryRunner = {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
};

export type MotherDuckClient = {
  ensureSchema(): Promise<void>;
  validateRequiredColumns(tableName: string, requiredColumns: string[]): Promise<void>;
  mergeCanonicalPlayerMatches(stagingTableName: string): Promise<void>;
};

export function createMotherDuckClient(params: {
  runner: WarehouseQueryRunner;
  schemaName: string;
}): MotherDuckClient {
  return {
    async ensureSchema() {
      await params.runner.query(buildCreateWarehouseSchemaSql({ schemaName: params.schemaName }));
    },
    async validateRequiredColumns(tableName, requiredColumns) {
      const missing = await params.runner.query<{ column_name: string }>(
        buildRequiredColumnValidationSql({
          schemaName: params.schemaName,
          tableName,
          requiredColumns,
        })
      );
      if (missing.length > 0) {
        throw new Error(
          `MotherDuck table ${params.schemaName}.${tableName} is missing columns: ${missing
            .map((row) => row.column_name)
            .join(', ')}`
        );
      }
    },
    async mergeCanonicalPlayerMatches(stagingTableName) {
      await params.runner.query(
        buildMergeCanonicalPlayerMatchesSql({
          schemaName: params.schemaName,
          stagingTableName,
        })
      );
    },
  };
}
```

- [ ] **Step 4: Create a dry-run load script**

Create `Scripts/load-canonical-player-matches-to-motherduck.ts`:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { readFileSync } from 'node:fs';

import { createMotherDuckClient, type WarehouseQueryRunner } from '../src/lib/warehouse/motherduckClient';

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

async function main() {
  const manifestPath = readArg(process.argv.slice(2), '--manifest');
  if (!manifestPath) throw new Error('Expected --manifest path');
  const dryRun = process.argv.includes('--dry-run');
  const schemaName = readArg(process.argv.slice(2), '--schema') ?? 'statly_warehouse';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    loadId: string;
    ndjsonPath: string;
    exportedRows: number;
  };
  const stagingTableName = `staging_canonical_player_match_${manifest.loadId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  const runner: WarehouseQueryRunner = {
    async query(sql) {
      if (dryRun) {
        console.log(JSON.stringify({ dryRun: true, sql }, null, 2));
        return [];
      }
      throw new Error(
        'Real MotherDuck runner is intentionally not wired until the approved dependency and credential task is executed'
      );
    },
  };

  const client = createMotherDuckClient({ runner, schemaName });
  await client.ensureSchema();
  await client.validateRequiredColumns('canonical_player_match', [
    'firestore_doc_id',
    'player_id',
    'match_id',
    'season',
    'round_number',
    'stats_json',
    'availability_json',
    'provenance_json',
  ]);
  await client.mergeCanonicalPlayerMatches(stagingTableName);

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    schemaName,
    stagingTableName,
    exportedRows: manifest.exportedRows,
    ndjsonPath: manifest.ndjsonPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
```

- [ ] **Step 5: Add package script**

Modify `package.json` scripts:

```json
"warehouse:load:player-matches": "tsx Scripts/load-canonical-player-matches-to-motherduck.ts"
```

- [ ] **Step 6: Run dry-run and tests**

Run:

```bash
npx vitest run src/lib/warehouse/motherduckSql.test.ts src/lib/warehouse/motherduckClient.test.ts
npm run warehouse:load:player-matches -- --manifest docs/superpowers/fixtures/missing.json --dry-run
```

Expected: Vitest PASS. The dry-run command should fail with a file-not-found error, proving it refuses to run without an explicit manifest.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/lib/warehouse/motherduckClient.ts src/lib/warehouse/motherduckClient.test.ts Scripts/load-canonical-player-matches-to-motherduck.ts package.json
git commit -m "feat: add dry-run MotherDuck load boundary"
```

---

### Task 5: Wire Real MotherDuck Execution After Dependency Approval

**Files:**
- Modify: `package.json`
- Modify: `Scripts/load-canonical-player-matches-to-motherduck.ts`
- Modify: `src/lib/warehouse/motherduckClient.ts`
- Test: `src/lib/warehouse/motherduckClient.test.ts`

**Purpose:** Add the real DuckDB/MotherDuck runner as a small replaceable boundary. This task requires explicit approval for a DuckDB-compatible dependency before execution because the repository currently has no MotherDuck runtime package.

- [ ] **Step 1: Record dependency decision before code**

Add this exact note to the task execution log before editing:

```md
Dependency decision: add one DuckDB-compatible package for warehouse scripts only. The app runtime will not import the package. The package is used behind `Scripts/load-canonical-player-matches-to-motherduck.ts` and `src/lib/warehouse/motherduckClient.ts`.
```

- [ ] **Step 2: Add dependency**

Run the approved install command selected during implementation. If the chosen official package is `duckdb`, run:

```bash
npm install --save-dev duckdb
```

Expected: `package.json` and `package-lock.json` update. Do not continue if installation fails.

- [ ] **Step 3: Add a dynamic runner factory**

Modify `src/lib/warehouse/motherduckClient.ts` by appending:

```ts
export async function createDuckDbMotherDuckRunner(params: {
  databaseUrl: string;
  token?: string;
}): Promise<WarehouseQueryRunner & { close(): Promise<void> }> {
  const duckdb = await import('duckdb');
  const db = new duckdb.Database(params.databaseUrl);
  const connection = db.connect();
  if (params.token) {
    await new Promise<void>((resolve, reject) => {
      connection.run(`SET motherduck_token='${params.token.replaceAll("'", "''")}'`, (error) =>
        error ? reject(error) : resolve()
      );
    });
  }
  return {
    query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      return new Promise((resolve, reject) => {
        connection.all(sql, (error, rows: T[]) => (error ? reject(error) : resolve(rows)));
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        connection.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
```

- [ ] **Step 4: Wire the real runner in the load script**

Modify `Scripts/load-canonical-player-matches-to-motherduck.ts` imports:

```ts
import {
  createDuckDbMotherDuckRunner,
  createMotherDuckClient,
  type WarehouseQueryRunner,
} from '../src/lib/warehouse/motherduckClient';
```

Replace the `runner` creation with:

```ts
  const runner: WarehouseQueryRunner & { close?: () => Promise<void> } = dryRun
    ? {
        async query(sql) {
          console.log(JSON.stringify({ dryRun: true, sql }, null, 2));
          return [];
        },
      }
    : await createDuckDbMotherDuckRunner({
        databaseUrl: process.env.MOTHERDUCK_DATABASE_URL ?? 'md:',
        token: process.env.MOTHERDUCK_TOKEN,
      });
```

Append this after the final `console.log`:

```ts
  await runner.close?.();
```

- [ ] **Step 5: Run tests and dry-run**

Run:

```bash
npx vitest run src/lib/warehouse/motherduckClient.test.ts
npm run warehouse:load:player-matches -- --manifest docs/superpowers/fixtures/missing.json --dry-run
```

Expected: test PASS. Dry-run still fails on missing manifest before connecting.

- [ ] **Step 6: Commit Task 5**

```bash
git add package.json package-lock.json src/lib/warehouse/motherduckClient.ts Scripts/load-canonical-player-matches-to-motherduck.ts
git commit -m "feat: wire MotherDuck script runner"
```

---

### Task 6: Add Warehouse Reconciliation Verifier

**Files:**
- Create: `Scripts/verify-motherduck-player-matches.ts`
- Modify: `package.json`
- Read: `Scripts/verify-player-read-models-core.ts`
- Read: `src/server/readModels/playerReadModels.ts`

**Purpose:** Prove MotherDuck is a faithful mirror for a bounded season/round scope before it is used for analytics or promotion.

- [ ] **Step 1: Create verifier script**

Create `Scripts/verify-motherduck-player-matches.ts`:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { adminDb } from '../src/lib/firebaseAdmin';
import {
  buildCanonicalPlayerMatchWarehouseRow,
  type FirestoreCanonicalPlayerMatchDocument,
} from '../src/lib/warehouse/canonicalPlayerMatchRow';

type Args = {
  season: number;
  rounds: number[];
  json: boolean;
};

function readArg(argv: string[], name: string): string | null {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  const season = Number(readArg(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }
  const rounds =
    readArg(argv, '--rounds')
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter(Number.isInteger) ?? [];
  return { season, rounds, json: argv.includes('--json') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await adminDb
    .collection('player_match_stats')
    .where('season', '==', args.season)
    .get();

  const firestoreRows = [];
  const rejected = [];
  for (const doc of snapshot.docs) {
    const data = { id: doc.id, ...doc.data() } as FirestoreCanonicalPlayerMatchDocument;
    const round = Number(data.round_number ?? data.round);
    if (args.rounds.length > 0 && !args.rounds.includes(round)) continue;
    try {
      firestoreRows.push(buildCanonicalPlayerMatchWarehouseRow(data));
    } catch (error) {
      rejected.push({ docId: doc.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const output = {
    ok: rejected.length === 0,
    status: rejected.length === 0 ? 'pass' : 'fail',
    season: args.season,
    rounds: args.rounds,
    counts: {
      firestoreCanonicalRows: firestoreRows.length,
      rejectedFirestoreRows: rejected.length,
    },
    rejected,
    note:
      'This verifier proves Firestore canonical exportability. After Task 5 real MotherDuck execution is enabled, extend this script to query statly_warehouse.canonical_player_match and compare counts, keys, values, presence, and provenance.',
  };

  console.log(JSON.stringify(output, null, 2));
  await adminDb.terminate();
  process.exit(output.ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, status: 'error', error: error instanceof Error ? error.message : String(error) }, null, 2));
  await adminDb.terminate().catch(() => undefined);
  process.exit(1);
});
```

- [ ] **Step 2: Add package script**

Modify `package.json` scripts:

```json
"warehouse:verify:player-matches": "tsx Scripts/verify-motherduck-player-matches.ts"
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck:data
```

Expected: PASS, or report the exact TypeScript error and fix only the verifier/script typing.

- [ ] **Step 4: Commit Task 6**

```bash
git add Scripts/verify-motherduck-player-matches.ts package.json
git commit -m "feat: verify warehouse player match exportability"
```

---

### Task 7: Document The Long-Term Architecture And Operations

**Files:**
- Create: `docs/MOTHERDUCK_DATA_ARCHITECTURE.md`
- Modify: `docs/DATA_RELIABILITY.md`
- Modify: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`

**Purpose:** Make the source-of-truth boundary explicit so future engineers do not accidentally treat MotherDuck as a second semantic source.

- [ ] **Step 1: Create MotherDuck architecture document**

Create `docs/MOTHERDUCK_DATA_ARCHITECTURE.md`:

```md
# MotherDuck Data Architecture

## Purpose

MotherDuck is Statly's analytical warehouse for canonical AFL data. It is not the operational source of truth for Footywire player-match semantics during the convergence program.

## Source-Of-Truth Boundary

- Firestore `player_match_stats` owns resolved canonical raw player-match documents.
- Prisma owns player identity, aliases, unresolved quarantine, transactional fantasy records, and app-serving read models.
- MotherDuck stores replayable analytical mirrors and verification outputs derived from Firestore and Prisma.

## Canonical Player-Match Flow

1. Footywire/FitzRoy/AFL Tables source rows are canonicalized by ETL.
2. Resolved rows are written to Firestore `player_match_stats` with `canonical_stats`.
3. Firestore rows are exported to NDJSON with a load manifest.
4. NDJSON is loaded into MotherDuck staging tables.
5. Staging rows merge into `statly_warehouse.canonical_player_match`.
6. Warehouse verification compares Firestore, MotherDuck, and Prisma projections for the same season/round scope.

## Promotion Rule

MotherDuck may support analytics immediately after verification passes for the queried scope. MotherDuck must not serve app-critical read models until a full-season verifier proves identical canonical keys, stat values, stat presence, provenance, and row counts against Firestore.

## Required Verification

Run:

```bash
npm run warehouse:export:player-matches -- --season=2026 --rounds=0,1
npm run warehouse:load:player-matches -- --manifest=<manifest-path> --dry-run
npm run warehouse:verify:player-matches -- --season=2026 --rounds=0,1 --json
npm run verify:player-read-models -- --season=2026 --rounds=0,1 --json
```

Passing means:

- Firestore rows contain canonical contracts.
- Export rejects zero canonical rows.
- MotherDuck load SQL is deterministic.
- Projection verifier has no `dropped_before_raw` or `dropped_in_projection` failures for the scoped repair.
```

- [ ] **Step 2: Update reliability lanes**

Append this section to `docs/DATA_RELIABILITY.md` after the lane table:

```md
### Lane D — Analytical warehouse

MotherDuck is the analytical mirror for canonical AFL facts. It is optimized for historical analysis, reconciliation, coverage audits, and future reporting surfaces. It does not replace Lane A serving read models until warehouse parity is proven by scoped and full-season verification.

Lane D health signals:

1. `warehouse_export_rows{season,round_scope}` — rows exported from Firestore canonical raw docs.
2. `warehouse_rejected_rows{season,round_scope}` — rows rejected because canonical identity or `canonical_stats` is missing.
3. `warehouse_loaded_rows{season,round_scope}` — rows merged into MotherDuck curated tables.
4. `warehouse_verification_status{season,round_scope}` — pass/fail from Firestore versus MotherDuck reconciliation.
5. `warehouse_projection_drift{season,round_scope}` — count of projection failures after warehouse load.
```

- [ ] **Step 3: Update architecture review**

Append this section to `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` before `## Review Summary`:

```md
## MotherDuck Position

MotherDuck should be introduced as a governed analytical mirror, not as a second persisted semantic source. Firestore remains the canonical raw-match contract boundary. MotherDuck tables should be derived from `canonical_stats`, canonical identity, canonical match metadata, and load manifests only.

The long-term promotion path is:

1. mirror Firestore canonical rows into MotherDuck;
2. verify MotherDuck against Firestore for bounded scopes;
3. verify Prisma projections against Firestore and MotherDuck;
4. use MotherDuck for analytics;
5. only after full-season parity, consider warehouse-backed rebuilds or reporting APIs.

Any MotherDuck consumer that reconstructs stats from legacy Firestore fields, `data.stats`, or `raw_row` violates the convergence goal.
```

- [ ] **Step 4: Run docs check**

Run:

```bash
npm run format:check -- docs/MOTHERDUCK_DATA_ARCHITECTURE.md docs/DATA_RELIABILITY.md docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md
```

Expected: PASS, or run `npx prettier --write` on only these docs and re-run the check.

- [ ] **Step 5: Commit Task 7**

```bash
git add docs/MOTHERDUCK_DATA_ARCHITECTURE.md docs/DATA_RELIABILITY.md docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md
git commit -m "docs: define MotherDuck warehouse architecture"
```

---

### Task 8: Final Integration Verification And Promotion Gate

**Files:**
- Read: `package.json`
- Read: `docs/MOTHERDUCK_DATA_ARCHITECTURE.md`
- Read: `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md`
- Read: `Scripts/export-firestore-canonical-player-matches.ts`
- Read: `Scripts/load-canonical-player-matches-to-motherduck.ts`
- Read: `Scripts/verify-motherduck-player-matches.ts`

**Purpose:** Prove the branch is coherent, scoped, and ready for a real MotherDuck credentialed run.

- [ ] **Step 1: Run warehouse unit tests**

Run:

```bash
npx vitest run src/lib/warehouse/canonicalPlayerMatchRow.test.ts src/lib/warehouse/motherduckSql.test.ts src/lib/warehouse/motherduckClient.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript checks**

Run:

```bash
npm run typecheck:data
npm run typecheck:app
```

Expected: PASS. If `typecheck:app` fails in unrelated pre-existing files, capture the first unrelated error and run the narrowest script-level command that covers the warehouse files.

- [ ] **Step 3: Run Firestore export for a bounded scope**

Run:

```bash
npm run warehouse:export:player-matches -- --season=2026 --rounds=0 --out-dir=tmp/warehouse-export
```

Expected: JSON output with `"ok": true`, a manifest path, `exportedRows > 0`, and `rejectedRows: 0`. If the local environment has no Firestore data, expected output is an auth/configuration error; record that no live Firestore verification was possible.

- [ ] **Step 4: Run dry-run MotherDuck load**

Use the manifest path from Step 3:

```bash
npm run warehouse:load:player-matches -- --manifest=<manifest-path> --dry-run
```

Expected: printed SQL for schema creation, information-schema validation, and merge. No MotherDuck mutation occurs.

- [ ] **Step 5: Run existing projection verifier**

Run:

```bash
npm run verify:player-read-models -- --season=2026 --rounds=0 --json
```

Expected: `status` is `pass` or the output clearly identifies existing drift. Do not mark warehouse promotion ready when `dropped_before_raw` or `dropped_in_projection` remains for the tested scope.

- [ ] **Step 6: Run graph update after code changes**

Run:

```bash
npm run graphify:update
```

Expected: graph update completes. If graphify is unavailable, record the exact command failure.

- [ ] **Step 7: Commit final verification notes**

If verification generated docs or committed graph artifacts, run:

```bash
git add graphify-out docs package.json package-lock.json Scripts src/lib/warehouse
git commit -m "chore: verify MotherDuck warehouse convergence"
```

If no files changed after verification, do not create an empty commit.

---

## Review Gates

Gate 1: Contract closure.

- `canonicalPlayerMatchRow` rejects non-canonical Firestore docs.
- Export tests prove top-level `stats` and `raw_row` cannot override `canonical_stats`.

Gate 2: Warehouse is a mirror.

- MotherDuck schema stores canonical rows and load manifests.
- Load script starts with dry-run safety.
- Real runner lives behind one boundary.

Gate 3: Verification before promotion.

- Firestore export has zero rejected rows for the tested scope.
- Existing projection verifier has no `dropped_before_raw` or `dropped_in_projection` for the tested scope.
- MotherDuck is used for analytics only until full-season parity is proven.

## Self-Review

Spec coverage:

- Long-term optimal architecture is covered by Firestore source-of-truth rules, MotherDuck mirror rules, load manifests, SQL schema, verifier, and promotion gates.
- Subagent execution is covered by the worker assignment section and one-task ownership boundaries.
- MotherDuck introduction is covered without assuming current warehouse tables exist.
- Existing Firestore-only reality is covered by read-only export first, dry-run load second, real connector third.

Placeholder scan:

- The plan avoids unnamed future tasks and names every file touched by each task.
- The only dependency uncertainty is explicit and gated because this repo currently has no approved DuckDB/MotherDuck package.

Type consistency:

- `CanonicalPlayerMatchWarehouseRow`, `FirestoreCanonicalPlayerMatchDocument`, `WarehouseQueryRunner`, and `MotherDuckClient` are introduced before use.
- Script names match package scripts.
- `canonical_stats`, `player_id`, `match_id`, `season`, and `round_number` remain aligned with the current Firestore contract.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-14-motherduck-data-architecture-convergence.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended choice: Subagent-Driven, because the plan splits cleanly into contract, SQL, export, load, verification, docs, and final integration work.
