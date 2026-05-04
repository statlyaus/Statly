# Round 0 Identity Gap Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only diagnostic command that explains why 2026 round 0 Firestore `player_match_stats` rows do not materialize into player read models.

**Architecture:** Add a focused diagnostic module under `src/server/diagnostics/` with pure classification logic and injectable data dependencies. Add a thin `Scripts/diagnose-player-identity-gaps.ts` CLI that wires Firestore, Prisma, and file output without mutating either store. Keep existing read-model and identity code unchanged.

**Tech Stack:** TypeScript, tsx scripts, Prisma Client, Firebase Admin Firestore, Vitest, Node `fs/promises`.

---

## File Structure

- Create `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
  - Owns types, argument-independent row classification, summary aggregation, export formatting, and the injected diagnostic runner.
  - No global `prisma` or `adminDb` imports. Dependencies are passed in.
- Create `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`
  - Unit tests for classification, grouping, summary counts, and read-only dependency usage.
- Create `Scripts/diagnose-player-identity-gaps.ts`
  - CLI wrapper. Parses args, loads env, wires `adminDb`, `prisma`, and `loadPlayerIdentityDirectory`, prints JSON or human report, optionally writes JSONL/CSV.
- Modify `package.json`
  - Add `diagnose:player-identity-gaps` script.

## Task 1: Pure Diagnostic Classification Module

**Files:**
- Create: `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- Create: `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`

- [ ] **Step 1: Write failing tests for identity classification**

Create `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  classifyIdentityGapRows,
  type DiagnosticFirestoreRow,
  type DiagnosticPlayerDirectory,
  type DiagnosticUnresolvedRow,
} from './playerIdentityGapDiagnosis';

const baseRow = (overrides: Partial<DiagnosticFirestoreRow>): DiagnosticFirestoreRow => ({
  docId: 'doc-1',
  data: {
    season: 2026,
    round_number: 0,
    match_id: '2026-R0-GWS-BUL',
    player_name: 'Joseph Fonti',
    team: 'GWS',
    opponent: 'Western Bulldogs',
    source: 'footywire_match',
    updated_at: '2026-03-05T10:30:00.000Z',
    canonical_stats: { schema_version: 1 },
    raw_row: { player_name: 'Joseph Fonti' },
  },
  ...overrides,
});

const directory = (): DiagnosticPlayerDirectory => ({
  playersById: new Map([
    ['joseph_fonti', { id: 'joseph_fonti', name: 'Joseph Fonti', club: 'GWS', position: 'DEF' }],
    ['other_player', { id: 'other_player', name: 'Other Player', club: 'GWS', position: 'MID' }],
  ]),
  canonicalByKey: new Map(),
  aliasByKey: new Map(),
});

describe('classifyIdentityGapRows', () => {
  it('classifies rows with valid persisted canonical player ids as ok', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            player_id: 'joseph_fonti',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      doc_id: 'doc-1',
      classification: 'canonical_player_id_ok',
      stored_player_id: 'joseph_fonti',
      resolved_player_id: 'joseph_fonti',
    });
    expect(result.summary.classificationCounts.canonical_player_id_ok).toBe(1);
  });

  it('classifies missing player_id rows as resolvable when the resolver finds one player', () => {
    const resolveIdentity = vi.fn().mockReturnValue({
      outcome: 'resolved',
      playerId: 'joseph_fonti',
      playerName: 'Joseph Fonti',
      matchedBy: 'player',
      candidates: ['joseph_fonti'],
    });

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity,
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'missing_player_id_resolvable',
      resolved_player_id: 'joseph_fonti',
      resolved_player_name: 'Joseph Fonti',
      candidate_player_ids: ['joseph_fonti'],
    });
    expect(result.rows[0].secondary_flags).toContain('resolver_matched_by_player');
    expect(resolveIdentity).toHaveBeenCalledTimes(1);
  });

  it('classifies missing player_id rows as ambiguous_or_quarantined when unresolved queue has evidence', () => {
    const unresolvedRows: DiagnosticUnresolvedRow[] = [
      {
        source: 'footywire_match',
        sourceDocumentId: 'doc-1',
        season: 2026,
        round: 0,
        playerName: 'Joseph Fonti',
        normalizedPlayerName: 'joseph fonti',
        team: 'GWS',
        normalizedTeam: 'gws',
        status: 'REVIEWED',
        candidatePlayerIdsJson: JSON.stringify(['joseph_fonti', 'other_player']),
      },
    ];

    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [baseRow({})],
      directory: directory(),
      unresolvedRows,
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'ambiguous',
        candidates: ['joseph_fonti', 'other_player'],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'ambiguous_or_quarantined',
      unresolved_queue_statuses: ['REVIEWED'],
      candidate_player_ids: ['joseph_fonti', 'other_player'],
    });
    expect(result.rows[0].secondary_flags).toContain('has_unresolved_queue_match');
  });

  it('classifies rows with persisted player_id missing from Prisma separately', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          data: {
            ...baseRow({}).data,
            player_id: 'missing_prisma_player',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      classification: 'player_id_not_in_prisma',
      stored_player_id: 'missing_prisma_player',
      resolved_player_id: null,
    });
  });

  it('classifies rows outside requested round or missing round as match_context_issue', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({
          docId: 'doc-no-round',
          data: {
            season: 2026,
            player_name: 'Joseph Fonti',
            team: 'GWS',
            player_id: 'joseph_fonti',
          },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn(),
      limit: 25,
    });

    expect(result.rows[0]).toMatchObject({
      doc_id: 'doc-no-round',
      classification: 'match_context_issue',
      round: null,
    });
    expect(result.rows[0].secondary_flags).toContain('missing_round');
  });

  it('keeps classification counts aligned with firestoreRowCount', () => {
    const result = classifyIdentityGapRows({
      season: 2026,
      rounds: [0],
      rows: [
        baseRow({ docId: 'doc-1' }),
        baseRow({
          docId: 'doc-2',
          data: { ...baseRow({}).data, player_id: 'joseph_fonti' },
        }),
      ],
      directory: directory(),
      unresolvedRows: [],
      resolveIdentity: vi.fn().mockReturnValue({
        outcome: 'unresolved',
        candidates: [],
        diagnostics: {
          playerName: 'Joseph Fonti',
          normalizedPlayerNames: ['joseph fonti'],
          normalizedTeam: 'gws',
        },
      }),
      limit: 25,
    });

    const classifiedTotal = Object.values(result.summary.classificationCounts).reduce(
      (sum, value) => sum + value,
      0
    );
    expect(result.summary.firestoreRowCount).toBe(2);
    expect(classifiedTotal).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: FAIL because `src/server/diagnostics/playerIdentityGapDiagnosis.ts` does not exist.

- [ ] **Step 3: Implement diagnostic types and classifier**

Create `src/server/diagnostics/playerIdentityGapDiagnosis.ts` with:

```ts
import { normalizeLookupPart, normalizeTeamLookup } from '@shared/player-identity/playerMatchStats';
import type {
  PlayerIdentityInput,
  PlayerIdentityResolution,
  PlayerIdentityDirectory,
} from '@shared/player-identity/playerIdentityResolver';

export type IdentityGapClassification =
  | 'canonical_player_id_ok'
  | 'missing_player_id_resolvable'
  | 'missing_player_id_unresolved'
  | 'player_id_not_in_prisma'
  | 'ambiguous_or_quarantined'
  | 'match_context_issue';

export type DiagnosticFirestoreRow = {
  docId: string;
  data: Record<string, unknown>;
};

export type DiagnosticPlayer = {
  id: string;
  name: string;
  club: string;
  position: string | null;
};

export type DiagnosticPlayerDirectory = PlayerIdentityDirectory;

export type DiagnosticUnresolvedRow = {
  source: string;
  sourceDocumentId: string;
  season: number;
  round: number | null;
  playerName: string;
  normalizedPlayerName: string;
  team: string | null;
  normalizedTeam: string | null;
  status: string;
  candidatePlayerIdsJson: string | null;
};

export type IdentityGapDiagnosticRow = {
  doc_id: string;
  season: number | null;
  round: number | null;
  match_id: string | null;
  storage_match_id: string | null;
  player_name: string | null;
  team: string | null;
  opponent: string | null;
  stored_player_id: string | null;
  classification: IdentityGapClassification;
  secondary_flags: string[];
  resolved_player_id: string | null;
  resolved_player_name: string | null;
  candidate_player_ids: string[];
  unresolved_queue_statuses: string[];
  source: string | null;
  has_canonical_stats: boolean;
  has_raw_row: boolean;
  updated_at: string | null;
};

export type IdentityGapDiagnosticSummary = {
  ok: true;
  season: number;
  rounds: number[];
  firestoreRowCount: number;
  classificationCounts: Record<IdentityGapClassification, number>;
  assertionCounts: {
    rowsWithRound: number;
    rowsWithMatchContext: number;
    rowsWithStoredPlayerId: number;
    rowsWithStoredPlayerIdInPrisma: number;
    rowsResolverResolved: number;
    rowsWithUnresolvedQueueEvidence: number;
  };
  topGroups: Array<{
    classification: IdentityGapClassification;
    playerName: string | null;
    team: string | null;
    matchId: string | null;
    source: string | null;
    count: number;
    sampleDocumentIds: string[];
  }>;
  sampleRows: IdentityGapDiagnosticRow[];
  supportingVerifierCommand: string;
  generatedAt: string;
};

export type IdentityGapDiagnosticResult = {
  summary: IdentityGapDiagnosticSummary;
  rows: IdentityGapDiagnosticRow[];
};

export type ClassifyIdentityGapRowsInput = {
  season: number;
  rounds: number[];
  rows: DiagnosticFirestoreRow[];
  directory: DiagnosticPlayerDirectory;
  unresolvedRows: DiagnosticUnresolvedRow[];
  resolveIdentity(input: PlayerIdentityInput): PlayerIdentityResolution;
  limit: number;
  generatedAt?: Date;
};

const CLASSIFICATIONS: IdentityGapClassification[] = [
  'canonical_player_id_ok',
  'missing_player_id_resolvable',
  'missing_player_id_unresolved',
  'player_id_not_in_prisma',
  'ambiguous_or_quarantined',
  'match_context_issue',
];

function emptyClassificationCounts(): Record<IdentityGapClassification, number> {
  return Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0])) as Record<
    IdentityGapClassification,
    number
  >;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStoredPlayerId(data: Record<string, unknown>): string | null {
  return readString(data.player_id) ?? readString(data.playerId);
}

function readRound(data: Record<string, unknown>): number | null {
  return readNumber(data.round_number ?? data.round ?? data.match_round);
}

function readSeason(data: Record<string, unknown>, fallbackSeason: number): number | null {
  return readNumber(data.season ?? data.year) ?? fallbackSeason;
}

function readMatchId(data: Record<string, unknown>): string | null {
  return (
    readString(data.match_id) ??
    readString(data.matchId) ??
    readString(data.match_uid) ??
    readString(data.matchUid)
  );
}

function readPlayerName(data: Record<string, unknown>): string | null {
  const rawRow = typeof data.raw_row === 'object' && data.raw_row ? data.raw_row as Record<string, unknown> : {};
  return readString(data.player_name) ?? readString(data.playerName) ?? readString(rawRow.player_name);
}

function readTeam(data: Record<string, unknown>): string | null {
  const rawRow = typeof data.raw_row === 'object' && data.raw_row ? data.raw_row as Record<string, unknown> : {};
  return readString(data.team) ?? readString(data.club) ?? readString(rawRow.team);
}

function readOpponent(data: Record<string, unknown>): string | null {
  const rawRow = typeof data.raw_row === 'object' && data.raw_row ? data.raw_row as Record<string, unknown> : {};
  return readString(data.opponent) ?? readString(rawRow.opponent);
}

function readSource(data: Record<string, unknown>): string | null {
  return readString(data.source) ?? readString(data.stat_source);
}

function readUpdatedAt(data: Record<string, unknown>): string | null {
  const value = data.updated_at ?? data.updatedAt ?? data.last_seen_at ?? data.lastSeenAt;
  if (value instanceof Date) return value.toISOString();
  return readString(value);
}

function hasCanonicalStats(data: Record<string, unknown>): boolean {
  return Boolean(data.canonical_stats && typeof data.canonical_stats === 'object');
}

function findUnresolvedEvidence(
  unresolvedRows: DiagnosticUnresolvedRow[],
  params: {
    docId: string;
    source: string | null;
    season: number | null;
    round: number | null;
    playerName: string | null;
    team: string | null;
  }
): DiagnosticUnresolvedRow[] {
  const normalizedName = params.playerName ? normalizeLookupPart(params.playerName) : '';
  const normalizedTeam = params.team ? normalizeTeamLookup(params.team) : '';
  return unresolvedRows.filter((row) => {
    if (row.sourceDocumentId === params.docId) return true;
    if (params.source && row.source !== params.source) return false;
    if (params.season != null && row.season !== params.season) return false;
    if (params.round != null && row.round != null && row.round !== params.round) return false;
    if (normalizedName && row.normalizedPlayerName !== normalizedName) return false;
    if (normalizedTeam && row.normalizedTeam && row.normalizedTeam !== normalizedTeam) return false;
    return Boolean(normalizedName);
  });
}

function readCandidateIds(
  resolution: PlayerIdentityResolution | null,
  unresolvedEvidence: DiagnosticUnresolvedRow[]
): string[] {
  const candidates = new Set<string>();
  resolution?.candidates.forEach((candidate) => candidates.add(candidate));
  for (const row of unresolvedEvidence) {
    if (!row.candidatePlayerIdsJson) continue;
    try {
      const parsed = JSON.parse(row.candidatePlayerIdsJson);
      if (Array.isArray(parsed)) {
        parsed.forEach((candidate) => {
          if (typeof candidate === 'string' && candidate.trim()) candidates.add(candidate.trim());
        });
      }
    } catch {
      candidates.add('invalid_candidate_json');
    }
  }
  return Array.from(candidates).sort();
}

function classifyRow(
  input: ClassifyIdentityGapRowsInput,
  row: DiagnosticFirestoreRow
): IdentityGapDiagnosticRow {
  const data = row.data;
  const season = readSeason(data, input.season);
  const round = readRound(data);
  const matchId = readMatchId(data);
  const storageMatchId = readString(data.storage_match_id) ?? matchId;
  const playerName = readPlayerName(data);
  const team = readTeam(data);
  const opponent = readOpponent(data);
  const source = readSource(data);
  const storedPlayerId = readStoredPlayerId(data);
  const secondaryFlags = new Set<string>();

  if (round == null) secondaryFlags.add('missing_round');
  if (!matchId && !storageMatchId) secondaryFlags.add('missing_match_context');
  if (hasCanonicalStats(data)) secondaryFlags.add('has_canonical_stats');
  if (data.raw_row && typeof data.raw_row === 'object') secondaryFlags.add('has_raw_row');

  const unresolvedEvidence = findUnresolvedEvidence(input.unresolvedRows, {
    docId: row.docId,
    source,
    season,
    round,
    playerName,
    team,
  });
  if (unresolvedEvidence.length > 0) secondaryFlags.add('has_unresolved_queue_match');

  let resolution: PlayerIdentityResolution | null = null;
  if (!storedPlayerId && playerName) {
    resolution = input.resolveIdentity({
      playerName,
      team,
      season,
      source,
      sourceDocumentId: row.docId,
      round,
      rawPayload: data,
    });
    if (resolution.outcome === 'resolved') {
      secondaryFlags.add(`resolver_matched_by_${resolution.matchedBy}`);
    }
  }

  let classification: IdentityGapClassification;
  let resolvedPlayerId: string | null = null;
  let resolvedPlayerName: string | null = null;

  if (round == null || !input.rounds.includes(round) || (!matchId && !storageMatchId)) {
    classification = 'match_context_issue';
  } else if (storedPlayerId && input.directory.playersById.has(storedPlayerId)) {
    const player = input.directory.playersById.get(storedPlayerId)!;
    classification = 'canonical_player_id_ok';
    resolvedPlayerId = player.id;
    resolvedPlayerName = player.name;
  } else if (storedPlayerId) {
    classification = 'player_id_not_in_prisma';
  } else if (unresolvedEvidence.length > 0 || resolution?.outcome === 'ambiguous') {
    classification = 'ambiguous_or_quarantined';
  } else if (resolution?.outcome === 'resolved') {
    classification = 'missing_player_id_resolvable';
    resolvedPlayerId = resolution.playerId;
    resolvedPlayerName = resolution.playerName;
  } else {
    classification = 'missing_player_id_unresolved';
  }

  return {
    doc_id: row.docId,
    season,
    round,
    match_id: matchId,
    storage_match_id: storageMatchId,
    player_name: playerName,
    team,
    opponent,
    stored_player_id: storedPlayerId,
    classification,
    secondary_flags: Array.from(secondaryFlags).sort(),
    resolved_player_id: resolvedPlayerId,
    resolved_player_name: resolvedPlayerName,
    candidate_player_ids: readCandidateIds(resolution, unresolvedEvidence),
    unresolved_queue_statuses: Array.from(new Set(unresolvedEvidence.map((entry) => entry.status))).sort(),
    source,
    has_canonical_stats: hasCanonicalStats(data),
    has_raw_row: Boolean(data.raw_row && typeof data.raw_row === 'object'),
    updated_at: readUpdatedAt(data),
  };
}

function buildTopGroups(rows: IdentityGapDiagnosticRow[], limit: number) {
  const groups = new Map<string, {
    classification: IdentityGapClassification;
    playerName: string | null;
    team: string | null;
    matchId: string | null;
    source: string | null;
    count: number;
    sampleDocumentIds: string[];
  }>();

  for (const row of rows) {
    const key = [
      row.classification,
      row.player_name ?? '',
      row.team ?? '',
      row.match_id ?? row.storage_match_id ?? '',
      row.source ?? '',
    ].join('|');
    const existing = groups.get(key) ?? {
      classification: row.classification,
      playerName: row.player_name,
      team: row.team,
      matchId: row.match_id ?? row.storage_match_id,
      source: row.source,
      count: 0,
      sampleDocumentIds: [],
    };
    existing.count += 1;
    if (existing.sampleDocumentIds.length < 5) existing.sampleDocumentIds.push(row.doc_id);
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .sort((left, right) => right.count - left.count || left.classification.localeCompare(right.classification))
    .slice(0, limit);
}

export function classifyIdentityGapRows(input: ClassifyIdentityGapRowsInput): IdentityGapDiagnosticResult {
  const rows = input.rows.map((row) => classifyRow(input, row));
  const classificationCounts = emptyClassificationCounts();
  for (const row of rows) {
    classificationCounts[row.classification] += 1;
  }

  const summary: IdentityGapDiagnosticSummary = {
    ok: true,
    season: input.season,
    rounds: input.rounds,
    firestoreRowCount: input.rows.length,
    classificationCounts,
    assertionCounts: {
      rowsWithRound: rows.filter((row) => row.round != null).length,
      rowsWithMatchContext: rows.filter((row) => row.match_id != null || row.storage_match_id != null).length,
      rowsWithStoredPlayerId: rows.filter((row) => row.stored_player_id != null).length,
      rowsWithStoredPlayerIdInPrisma: rows.filter((row) => row.classification === 'canonical_player_id_ok').length,
      rowsResolverResolved: rows.filter((row) => row.classification === 'missing_player_id_resolvable').length,
      rowsWithUnresolvedQueueEvidence: rows.filter((row) => row.unresolved_queue_statuses.length > 0).length,
    },
    topGroups: buildTopGroups(rows, input.limit),
    sampleRows: rows.slice(0, input.limit),
    supportingVerifierCommand: `npx tsx Scripts/verify-player-read-models.ts --season=${input.season} --rounds=${input.rounds.join(',')} --include-merged-live --json`,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
  };

  return { summary, rows };
}
```

- [ ] **Step 4: Run tests and fix formatting/type errors**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/server/diagnostics/playerIdentityGapDiagnosis.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
git commit -m "Add identity gap classifier"
```

Expected: commit includes only these two files.

## Task 2: Diagnostic Runner With Injected Stores

**Files:**
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- Modify: `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`

- [ ] **Step 1: Add failing test for injected data runner**

Append to `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`:

```ts
import { runIdentityGapDiagnosis } from './playerIdentityGapDiagnosis';

describe('runIdentityGapDiagnosis', () => {
  it('loads Firestore, directory, and unresolved rows through read-only injected dependencies', async () => {
    const firestoreRows = [
      baseRow({
        data: {
          ...baseRow({}).data,
          player_id: 'joseph_fonti',
        },
      }),
    ];
    const loadFirestoreRows = vi.fn().mockResolvedValue(firestoreRows);
    const loadDirectory = vi.fn().mockResolvedValue(directory());
    const loadUnresolvedRows = vi.fn().mockResolvedValue([]);
    const resolveIdentity = vi.fn();

    const result = await runIdentityGapDiagnosis({
      season: 2026,
      rounds: [0],
      limit: 25,
      loadFirestoreRows,
      loadDirectory,
      loadUnresolvedRows,
      resolveIdentity,
    });

    expect(loadFirestoreRows).toHaveBeenCalledWith({ season: 2026, rounds: [0] });
    expect(loadDirectory).toHaveBeenCalledWith({ season: 2026 });
    expect(loadUnresolvedRows).toHaveBeenCalledWith({ season: 2026, rounds: [0] });
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(result.summary.firestoreRowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: FAIL because `runIdentityGapDiagnosis` is not exported.

- [ ] **Step 3: Implement injected runner and output formatters**

Append to `src/server/diagnostics/playerIdentityGapDiagnosis.ts`:

```ts
export type IdentityGapDiagnosisDependencies = {
  loadFirestoreRows(params: { season: number; rounds: number[] }): Promise<DiagnosticFirestoreRow[]>;
  loadDirectory(params: { season: number }): Promise<DiagnosticPlayerDirectory>;
  loadUnresolvedRows(params: { season: number; rounds: number[] }): Promise<DiagnosticUnresolvedRow[]>;
  resolveIdentity(input: PlayerIdentityInput, directory: DiagnosticPlayerDirectory): PlayerIdentityResolution;
};

export type RunIdentityGapDiagnosisInput = {
  season: number;
  rounds: number[];
  limit: number;
} & IdentityGapDiagnosisDependencies;

export async function runIdentityGapDiagnosis(
  input: RunIdentityGapDiagnosisInput
): Promise<IdentityGapDiagnosticResult> {
  const [rows, directory, unresolvedRows] = await Promise.all([
    input.loadFirestoreRows({ season: input.season, rounds: input.rounds }),
    input.loadDirectory({ season: input.season }),
    input.loadUnresolvedRows({ season: input.season, rounds: input.rounds }),
  ]);

  return classifyIdentityGapRows({
    season: input.season,
    rounds: input.rounds,
    rows,
    directory,
    unresolvedRows,
    limit: input.limit,
    resolveIdentity: (identityInput) => input.resolveIdentity(identityInput, directory),
  });
}

export function formatIdentityGapHumanReport(result: IdentityGapDiagnosticResult): string {
  const lines: string[] = [];
  lines.push(`Identity gap diagnosis: season ${result.summary.season}, rounds ${result.summary.rounds.join(',')}`);
  lines.push(`Firestore rows: ${result.summary.firestoreRowCount}`);
  lines.push('');
  lines.push('Classification counts:');
  for (const [classification, count] of Object.entries(result.summary.classificationCounts)) {
    lines.push(`- ${classification}: ${count}`);
  }
  lines.push('');
  lines.push('Top groups:');
  for (const group of result.summary.topGroups) {
    lines.push(
      `- ${group.classification} | ${group.playerName ?? 'unknown player'} | ${group.team ?? 'unknown team'} | ${group.matchId ?? 'unknown match'} | count=${group.count} | samples=${group.sampleDocumentIds.join(',')}`
    );
  }
  lines.push('');
  lines.push(`Supporting verifier: ${result.summary.supportingVerifierCommand}`);
  return `${lines.join('\n')}\n`;
}

export function formatIdentityGapJsonl(rows: IdentityGapDiagnosticRow[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const raw = Array.isArray(value) ? value.join(';') : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

export function formatIdentityGapCsv(rows: IdentityGapDiagnosticRow[]): string {
  const headers: Array<keyof IdentityGapDiagnosticRow> = [
    'doc_id',
    'season',
    'round',
    'match_id',
    'storage_match_id',
    'player_name',
    'team',
    'opponent',
    'stored_player_id',
    'classification',
    'secondary_flags',
    'resolved_player_id',
    'resolved_player_name',
    'candidate_player_ids',
    'unresolved_queue_statuses',
    'source',
    'has_canonical_stats',
    'has_raw_row',
    'updated_at',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/server/diagnostics/playerIdentityGapDiagnosis.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
git commit -m "Add identity gap diagnostic runner"
```

Expected: commit includes only the diagnostic module and its tests.

## Task 3: CLI Wrapper And Store Adapters

**Files:**
- Create: `Scripts/diagnose-player-identity-gaps.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the CLI script**

Create `Scripts/diagnose-player-identity-gaps.ts` with:

```ts
#!/usr/bin/env tsx

import '../src/lib/loadEnv';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { adminDb } from '../src/lib/firebaseAdmin';
import { prisma } from '../src/lib/prisma';
import {
  loadPlayerIdentityDirectory,
  resolvePlayerIdentityFromDirectory,
  type PlayerIdentityInput,
} from '../shared/player-identity/playerIdentityResolver';
import {
  formatIdentityGapCsv,
  formatIdentityGapHumanReport,
  formatIdentityGapJsonl,
  runIdentityGapDiagnosis,
  type DiagnosticFirestoreRow,
  type DiagnosticUnresolvedRow,
} from '../src/server/diagnostics/playerIdentityGapDiagnosis';

type CliArgs = {
  season: number;
  rounds: number[];
  limit: number;
  json: boolean;
  outputJsonl: string | null;
  outputCsv: string | null;
};

function readArgValue(argv: string[], name: string): string | undefined {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1];
  if (equalsValue != null) return equalsValue;
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function parseArgs(argv: string[]): CliArgs {
  const season = Number(readArgValue(argv, '--season'));
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    throw new Error('Expected --season between 2020 and 2035');
  }

  const roundsArg = readArgValue(argv, '--rounds');
  const rounds =
    roundsArg
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0) ?? [];
  if (rounds.length === 0) {
    throw new Error('Expected --rounds with at least one non-negative integer round');
  }

  const limitArg = readArgValue(argv, '--limit');
  const limit = limitArg ? Number(limitArg) : 25;

  return {
    season,
    rounds: [...new Set(rounds)].sort((left, right) => left - right),
    limit: Number.isInteger(limit) && limit > 0 ? limit : 25,
    json: argv.includes('--json'),
    outputJsonl: readArgValue(argv, '--output-jsonl') ?? null,
    outputCsv: readArgValue(argv, '--output-csv') ?? null,
  };
}

function readRound(data: Record<string, unknown>): number | null {
  const value = data.round_number ?? data.round ?? data.match_round;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function loadFirestoreRows(params: {
  season: number;
  rounds: number[];
}): Promise<DiagnosticFirestoreRow[]> {
  const docs: DiagnosticFirestoreRow[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const pageSize = 1000;

  while (true) {
    let query = adminDb
      .collection('player_match_stats')
      .where('season', '==', params.season)
      .orderBy('__name__')
      .limit(pageSize);

    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const round = readRound(data);
      if (round != null && params.rounds.includes(round)) {
        docs.push({ docId: doc.id, data });
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }

  return docs;
}

async function loadUnresolvedRows(params: {
  season: number;
  rounds: number[];
}): Promise<DiagnosticUnresolvedRow[]> {
  const rows = await prisma.unresolvedPlayerStatRow.findMany({
    where: {
      season: params.season,
      status: { in: ['NEW', 'REVIEWED'] },
    },
    select: {
      source: true,
      sourceDocumentId: true,
      season: true,
      round: true,
      playerName: true,
      normalizedPlayerName: true,
      team: true,
      normalizedTeam: true,
      status: true,
      candidatePlayerIdsJson: true,
    },
  });

  return rows.filter((row) => row.round == null || params.rounds.includes(row.round));
}

async function writeOutput(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runIdentityGapDiagnosis({
    season: args.season,
    rounds: args.rounds,
    limit: args.limit,
    loadFirestoreRows,
    loadDirectory: ({ season }) => loadPlayerIdentityDirectory(prisma, season),
    loadUnresolvedRows,
    resolveIdentity: (input: PlayerIdentityInput, directory) =>
      resolvePlayerIdentityFromDirectory(directory, input),
  });

  if (args.outputJsonl) {
    await writeOutput(args.outputJsonl, formatIdentityGapJsonl(result.rows));
  }
  if (args.outputCsv) {
    await writeOutput(args.outputCsv, formatIdentityGapCsv(result.rows));
  }

  if (args.json) {
    console.log(JSON.stringify(result.summary, null, 2));
  } else {
    console.log(formatIdentityGapHumanReport(result));
  }
}

main()
  .catch((error) => {
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
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([prisma.$disconnect(), adminDb.terminate()]);
  });
```

- [ ] **Step 2: Add npm script**

Modify `package.json` inside `scripts` to include:

```json
"diagnose:player-identity-gaps": "tsx Scripts/diagnose-player-identity-gaps.ts"
```

Place it next to the existing player read-model scripts:

```json
"build:player-read-models": "tsx Scripts/build-player-read-models.ts",
"diagnose:player-identity-gaps": "tsx Scripts/diagnose-player-identity-gaps.ts",
"verify:player-read-models": "tsx Scripts/verify-player-read-models.ts"
```

- [ ] **Step 3: Run TypeScript check for script/module**

Run:

```bash
npm run typecheck:app
```

Expected: PASS. If it fails due to unrelated existing repo errors, capture the first unrelated error and then run:

```bash
npx tsx Scripts/diagnose-player-identity-gaps.ts --season=2026 --rounds=0 --json
```

Expected: command starts and either prints a JSON summary or a Firestore credential/config error. It must not perform writes.

- [ ] **Step 4: Run the diagnostic for 2026 round 0**

Run:

```bash
npm run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0.jsonl --output-csv tmp/identity-gap-2026-r0.csv
```

Expected:

- stdout is JSON with `ok: true`.
- `classificationCounts` values sum to `firestoreRowCount`.
- `supportingVerifierCommand` contains `--season=2026 --rounds=0 --include-merged-live --json`.
- `tmp/identity-gap-2026-r0.jsonl` exists.
- `tmp/identity-gap-2026-r0.csv` exists.

- [ ] **Step 5: Run supporting verifier**

Run:

```bash
npx tsx Scripts/verify-player-read-models.ts --season=2026 --rounds=0 --include-merged-live --json
```

Expected: JSON output is produced. Persist the result only if needed for manual review; do not change application behavior based on it in this task.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add Scripts/diagnose-player-identity-gaps.ts package.json src/server/diagnostics/playerIdentityGapDiagnosis.ts src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
git commit -m "Add player identity gap diagnostic command"
```

Expected: commit includes the CLI, package script, and any necessary diagnostic module adjustments.

## Task 4: Documentation And Final Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md`

- [ ] **Step 1: Add command usage to the approved spec**

Append this section before `## Approval Gate`:

````md
## Implemented Command

The diagnostic command is:

```bash
npm run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0.jsonl --output-csv tmp/identity-gap-2026-r0.csv
```

The command is read-only for Firestore and Prisma. The only writes are local diagnostic artifacts when `--output-jsonl` or `--output-csv` are provided.
````

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npx vitest run src/server/diagnostics/playerIdentityGapDiagnosis.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the final diagnostic command**

Run:

```bash
npm run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0.jsonl --output-csv tmp/identity-gap-2026-r0.csv
```

Expected: PASS with JSON summary. Record these values for the final response:

- `firestoreRowCount`
- `classificationCounts`
- top three `topGroups`
- artifact paths

- [ ] **Step 4: Check for accidental mutations**

Run:

```bash
git status --short
```

Expected: only intended code/docs changes plus existing pre-existing dirty files. `tmp/identity-gap-2026-r0.jsonl` and `tmp/identity-gap-2026-r0.csv` should remain untracked local artifacts unless the user explicitly asks to commit them.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add docs/superpowers/specs/2026-05-05-round-0-identity-gap-diagnosis-design.md
git commit -m "Document identity gap diagnostic command"
```

Expected: commit includes only the spec documentation update.

## Final Review Checklist

- [ ] Diagnostic script is read-only for Firestore and Prisma.
- [ ] Classification counts sum to `firestoreRowCount`.
- [ ] Every scoped row receives exactly one primary classification.
- [ ] JSON summary and human report both work.
- [ ] JSONL and CSV exports write only when explicitly requested.
- [ ] Existing verifier command remains supporting evidence, not a replacement for row-level identity diagnosis.
- [ ] No repair, replay, backfill, or read-model fallback was introduced.

## Handoff Notes

The implementation is complete when the diagnostic command can explain the 2026 round 0 identity gap and produce local artifacts. It is not required to fix the identity gap. Any alias additions, replay, or Firestore backfill must be planned separately after reviewing the diagnostic evidence.
