import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { adminDb } from '@/lib/firebaseAdmin';
import {
  buildMatchLogEntityKey,
  buildMatchLogStageSnapshot,
  type MatchLogStageSnapshot,
} from '@/lib/matchLogs';
import { prisma } from '@/lib/prisma';
import {
  FOOTYWIRE_CANONICAL_FIELD_BY_STAT_KEY,
  FOOTYWIRE_CANONICAL_STAT_FIELDS,
} from '@/lib/stats/footywireCanonicalContract';
import { type CanonicalStatKey } from '@/lib/stats/statColumns';
import {
  loadPlayerIdentityDirectory,
  resolvePlayerIdentityFromDirectory,
} from '@/server/playerIdentityResolver';
import { getAflTeamAbbreviation } from '@shared/player-identity/teamNames';
import { processPlayerRow } from '../../etl/processFootywireData';

type IngestResult = Awaited<ReturnType<typeof processPlayerRow>>;

export type ImportAdvancedFootywireRoundsOptions = {
  season: number;
  rounds: number[];
  dryRun?: boolean;
  dataSource?: string;
};

export type ImportAdvancedFootywireRoundsResult = {
  season: number;
  rounds: number[];
  dryRun: boolean;
  fetchedRows: number;
  sourceDiagnostics: Array<{
    round: number;
    source: string;
    rows: number;
  }>;
  written: number;
  skippedStatus: number;
  skippedUnchanged: number;
  quarantinedAmbiguous: number;
  quarantinedUnresolved: number;
  observedResolved: number;
  observedQuarantinedAmbiguous: number;
  observedQuarantinedUnresolved: number;
};

export type MergedIngestReconciliationRow = {
  entityKey: string;
  matchId: string;
  season: number;
  roundNumber: number;
  playerId: string | null;
  playerName: string;
  team: string;
  opponent: string;
  stage: MatchLogStageSnapshot;
  rawRow: SourceRow;
};

export type MergedIngestProgressEvent =
  | { event: 'round_fetch_start'; season: number; round: number; dataSource: string }
  | { event: 'round_fetch_end'; season: number; round: number; rows: number; elapsedMs: number }
  | { event: 'round_fetch_error'; season: number; round: number; error: string; elapsedMs: number };

type SourceDiagnostic = {
  source: string;
  rows: number;
};

type PlayerIdentityPrismaLike = Parameters<typeof loadPlayerIdentityDirectory>[0];
type MergedPlayerIdentityDirectory = Awaited<ReturnType<typeof loadPlayerIdentityDirectory>>;

type SourceRow = {
  season: number;
  round: number;
  team: string;
  opposition?: string;
  player_name: string;
  source_name?: string;
  source_provenance?: Record<string, string>;
  source_priority?: string[];
  raw_source_rows?: Record<string, unknown>;
  [key: string]: unknown;
};

const MERGE_FIELDS = [
  'season',
  'round',
  'team',
  'opposition',
  'player_name',
  ...FOOTYWIRE_CANONICAL_STAT_FIELDS,
] as const;

const DEFAULT_SOURCE_PRECEDENCE = ['footywire_match', 'fryzigg', 'afltables'] as const;

function resolveEtlRoot(): string {
  return path.resolve(process.cwd(), 'etl');
}

function toEnvValue(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function readRFetchTimeoutMs(): number {
  const raw = process.env.STATLY_R_FETCH_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90000;
}

function createTempOutfile(season: number, round: number): string {
  return path.join(os.tmpdir(), `statly-footywire-${season}-r${round}-${Date.now()}.ndjson`);
}

function createMetaOutfile(outfile: string): string {
  return `${outfile}.meta.json`;
}

function readLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runRFetch(params: {
  season: number;
  round: number;
  outfile: string;
  dryRun: boolean;
  footywireMatchIds: string[];
  dataSource?: string;
  timeoutMs?: number;
}): Promise<{ rows: SourceRow[]; diagnostics: SourceDiagnostic[] }> {
  const cwd = resolveEtlRoot();
  const args = ['fetch_fw_round.R', String(params.season), String(params.round), params.outfile];
  const env = {
    ...process.env,
    SEASON: String(params.season),
    ROUND: String(params.round),
    OUTFILE: params.outfile,
    FOOTYWIRE_MATCH_IDS: params.footywireMatchIds.join(','),
    DATA_SOURCE:
      toEnvValue(params.dataSource) ??
      toEnvValue(process.env.DATA_SOURCE) ??
      'fryzigg',
    BACKFILL_MODE: 'true',
    ALLOWED_MATCH_STATUSES: process.env.ALLOWED_MATCH_STATUSES ?? 'scheduled,in_progress,final,unknown',
    OBSERVE_ONLY: params.dryRun ? 'true' : process.env.OBSERVE_ONLY ?? 'false',
    ETL_OBSERVE_MODE: params.dryRun ? 'true' : process.env.ETL_OBSERVE_MODE ?? 'false',
  };
  const timeoutMs = params.timeoutMs ?? readRFetchTimeoutMs();

  await new Promise<void>((resolve, reject) => {
    const child = spawn('Rscript', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(
        new Error(
          `Rscript fetch timed out after ${timeoutMs}ms for season ${params.season} round ${params.round}`
        )
      );
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Rscript exited with code ${code}`));
    });
  });

  const raw = await fs.readFile(params.outfile, 'utf8');
  let diagnostics: SourceDiagnostic[] = [];
  const metaOutfile = createMetaOutfile(params.outfile);
  try {
    const metaRaw = await fs.readFile(metaOutfile, 'utf8');
    const meta = JSON.parse(metaRaw) as { sources?: Array<{ source?: string; rows?: number }> };
    if (Array.isArray(meta.sources)) {
      diagnostics = meta.sources
        .map((entry) => ({
          source: typeof entry.source === 'string' ? entry.source : 'unknown',
          rows: typeof entry.rows === 'number' ? entry.rows : 0,
        }))
        .filter((entry) => entry.source.length > 0);
    }
  } catch {
    // Preserve backward compatibility if the producer did not emit a meta file.
  }

  return {
    rows: readLines(raw).map((line) => JSON.parse(line) as SourceRow),
    diagnostics,
  };
}

async function getFootywireMatchIds(season: number, round: number): Promise<string[]> {
  const snap = await adminDb
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  return snap.docs
    .map((doc) => {
      const data = doc.data() as {
        provider_ids?: { footywire_match_mid?: string | number };
      };
      const mid = data.provider_ids?.footywire_match_mid;
      return typeof mid === 'number' ? String(mid) : typeof mid === 'string' ? mid.trim() : '';
    })
    .filter((value) => value.length > 0);
}

function normalizeSourceName(value: string | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase();
}

function sourceRank(sourceName: string): number {
  const index = DEFAULT_SOURCE_PRECEDENCE.indexOf(sourceName as (typeof DEFAULT_SOURCE_PRECEDENCE)[number]);
  return index === -1 ? DEFAULT_SOURCE_PRECEDENCE.length : index;
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getTeamAbbr(team: string | undefined): string {
  return getAflTeamAbbreviation(readString(team));
}

function buildMergeKey(row: SourceRow): string {
  return [
    row.season,
    row.round,
    normalizeKeyPart(row.team),
    normalizeKeyPart(row.opposition),
    normalizeKeyPart(row.player_name),
  ].join('|');
}

function buildMergedReconciliationEntityKey(row: SourceRow): string {
  return buildMatchLogEntityKey({
    season: Number(row.season ?? 0),
    roundNumber: Number(row.round ?? 0),
    matchId: typeof row.match_id === 'string' ? row.match_id : null,
    playerName: String(row.player_name ?? ''),
    opponent: String(row.opposition ?? ''),
  });
}

const roundMatchCache = new Map<string, Array<Record<string, unknown>>>();

function roundCacheKey(season: number, round: number): string {
  return `${season}:${round}`;
}

async function loadRoundMatches(season: number, round: number): Promise<Array<Record<string, unknown>>> {
  const cacheKey = roundCacheKey(season, round);
  const cached = roundMatchCache.get(cacheKey);
  if (cached) return cached;

  const byRoundNumber = await adminDb
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  const docs =
    !byRoundNumber.empty
      ? byRoundNumber.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      : (
          await adminDb
            .collection('matches')
            .where('season', '==', season)
            .where('round', '==', round)
            .get()
        ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  roundMatchCache.set(cacheKey, docs);
  return docs;
}

async function resolveCanonicalMatchContext(row: SourceRow): Promise<{
  matchId: string | null;
  opponent: string;
}> {
  const season = Number(row.season ?? 0);
  const round = Number(row.round ?? 0);
  if (!season || !Number.isFinite(round)) {
    return {
      matchId: null,
      opponent: String(row.opposition ?? ''),
    };
  }

  const teamAbbr = getTeamAbbr(typeof row.team === 'string' ? row.team : undefined);
  const oppositionAbbr = getTeamAbbr(typeof row.opposition === 'string' ? row.opposition : undefined);
  const roundMatches = await loadRoundMatches(season, round);

  const matchesForTeam = roundMatches.filter((candidate) => {
    const homeTeam = readString(candidate.home_team);
    const awayTeam = readString(candidate.away_team);
    if (!homeTeam || !awayTeam) return false;
    return getTeamAbbr(homeTeam) === teamAbbr || getTeamAbbr(awayTeam) === teamAbbr;
  });

  const matchedByOpponent =
    oppositionAbbr === 'UNK'
      ? null
      : matchesForTeam.find((candidate) => {
          const homeTeam = readString(candidate.home_team);
          const awayTeam = readString(candidate.away_team);
          if (!homeTeam || !awayTeam) return false;
          const homeAbbr = getTeamAbbr(homeTeam);
          const awayAbbr = getTeamAbbr(awayTeam);
          return (
            (homeAbbr === teamAbbr && awayAbbr === oppositionAbbr) ||
            (homeAbbr === oppositionAbbr && awayAbbr === teamAbbr)
          );
        }) ?? null;

  const matched = matchedByOpponent ?? (matchesForTeam.length === 1 ? matchesForTeam[0] : null);
  const homeTeam = readString(matched?.home_team);
  const awayTeam = readString(matched?.away_team);
  const normalizedTeam = readString(row.team)?.toLowerCase() ?? '';
  const canonicalOpponent =
    homeTeam && awayTeam
      ? normalizedTeam === homeTeam.toLowerCase()
        ? awayTeam
        : normalizedTeam === awayTeam.toLowerCase()
          ? homeTeam
          : String(row.opposition ?? '')
      : String(row.opposition ?? '');

  return {
    matchId:
      readString(matched?.match_uid) ??
      readString(matched?.matchUid) ??
      readString(matched?.match_id) ??
      readString(matched?.id),
    opponent: canonicalOpponent,
  };
}

function hasConcreteValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0 && value.trim().toUpperCase() !== 'NA';
  return true;
}

function mergeRows(rows: SourceRow[]): SourceRow[] {
  const groups = new Map<string, SourceRow[]>();

  for (const row of rows) {
    const key = buildMergeKey(row);
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  const mergedRows: SourceRow[] = [];

  for (const groupRows of groups.values()) {
    const sortedRows = groupRows
      .slice()
      .sort((a, b) => sourceRank(normalizeSourceName(a.source_name)) - sourceRank(normalizeSourceName(b.source_name)));

    const merged: SourceRow = {
      season: Number(sortedRows[0]?.season ?? 0),
      round: Number(sortedRows[0]?.round ?? 0),
      team: String(sortedRows[0]?.team ?? ''),
      opposition: sortedRows[0]?.opposition ? String(sortedRows[0].opposition) : undefined,
      player_name: String(sortedRows[0]?.player_name ?? ''),
      source_priority: sortedRows.map((row) => normalizeSourceName(row.source_name)),
      source_provenance: {},
      raw_source_rows: {},
    };

    for (const row of sortedRows) {
      const sourceName = normalizeSourceName(row.source_name);
      (merged.raw_source_rows as Record<string, unknown>)[sourceName] = row;
    }

    for (const field of MERGE_FIELDS) {
      for (const row of sortedRows) {
        const value = row[field];
        if (!hasConcreteValue(value)) continue;
        merged[field] = value as never;
        (merged.source_provenance as Record<string, string>)[field] = normalizeSourceName(
          row.source_name
        );
        break;
      }
    }

    mergedRows.push(merged);
  }

  return mergedRows;
}

function buildMergedStageSnapshot(row: SourceRow): MatchLogStageSnapshot {
  const canonicalStats: Partial<Record<CanonicalStatKey, number | null>> = {};
  const availability: Partial<Record<CanonicalStatKey, boolean>> = {};
  const provenance: Partial<Record<CanonicalStatKey, string | null>> = {};

  for (const canonicalKey of Object.keys(
    FOOTYWIRE_CANONICAL_FIELD_BY_STAT_KEY
  ) as CanonicalStatKey[]) {
    const persistedField = FOOTYWIRE_CANONICAL_FIELD_BY_STAT_KEY[canonicalKey];
    const rawValue = row[persistedField];
    canonicalStats[canonicalKey] =
      typeof rawValue === 'number' ? rawValue : rawValue == null ? null : Number(rawValue);
    availability[canonicalKey] = hasConcreteValue(rawValue);
    provenance[canonicalKey] =
      row.source_provenance && typeof row.source_provenance[persistedField] === 'string'
        ? row.source_provenance[persistedField]
        : row.source_provenance && typeof row.source_provenance[canonicalKey] === 'string'
          ? row.source_provenance[canonicalKey]
          : row.source_name ?? null;
  }

  return buildMatchLogStageSnapshot(canonicalStats, {
    availability,
    provenance,
  });
}

export async function resolveMergedReconciliationPlayerId(
  row: SourceRow,
  directory: MergedPlayerIdentityDirectory
): Promise<string | null> {
  const resolution = resolvePlayerIdentityFromDirectory(directory, {
    playerName: String(row.player_name ?? ''),
    team: typeof row.team === 'string' ? row.team : null,
    season: typeof row.season === 'number' ? row.season : Number(row.season),
    round: typeof row.round === 'number' ? row.round : Number(row.round),
    source: 'fitzroy_merged_reconciliation',
    sourceDocumentId: buildMergedReconciliationEntityKey(row),
    sourceMatchId: typeof row.match_id === 'string' ? row.match_id : null,
    rawPayload: row as Record<string, unknown>,
  });

  return resolution.outcome === 'resolved' ? resolution.playerId : null;
}

export function buildMergedIngestProgressEventForTest(
  event: MergedIngestProgressEvent
): MergedIngestProgressEvent {
  return event;
}

export async function fetchMergedIngestRowsForRounds(options: {
  season: number;
  rounds: number[];
  dryRun?: boolean;
  prismaClient?: PlayerIdentityPrismaLike;
  dataSource?: string;
  rFetchTimeoutMs?: number;
  onProgress?: (event: MergedIngestProgressEvent) => void;
}): Promise<{
  rows: MergedIngestReconciliationRow[];
  sourceDiagnostics: ImportAdvancedFootywireRoundsResult['sourceDiagnostics'];
}> {
  const rounds = [...new Set(options.rounds)].sort((a, b) => a - b);
  const mergedRows: MergedIngestReconciliationRow[] = [];
  const sourceDiagnostics: ImportAdvancedFootywireRoundsResult['sourceDiagnostics'] = [];
  const prismaClient = options.prismaClient ?? prisma;
  const playerIdentityDirectory = await loadPlayerIdentityDirectory(prismaClient, options.season);

  for (const round of rounds) {
    const outfile = createTempOutfile(options.season, round);
    const metaOutfile = createMetaOutfile(outfile);
    const startedAt = Date.now();
    const dataSource = options.dataSource ?? process.env.DATA_SOURCE ?? 'fryzigg';

    try {
      options.onProgress?.({
        event: 'round_fetch_start',
        season: options.season,
        round,
        dataSource,
      });
      const footywireMatchIds = await getFootywireMatchIds(options.season, round);
      const { rows, diagnostics } = await runRFetch({
        season: options.season,
        round,
        outfile,
        dryRun: options.dryRun ?? true,
        footywireMatchIds,
        dataSource: options.dataSource,
        timeoutMs: options.rFetchTimeoutMs,
      });
      options.onProgress?.({
        event: 'round_fetch_end',
        season: options.season,
        round,
        rows: rows.length,
        elapsedMs: Date.now() - startedAt,
      });

      for (const diagnostic of diagnostics) {
        sourceDiagnostics.push({ round, source: diagnostic.source, rows: diagnostic.rows });
      }

      for (const row of mergeRows(rows)) {
        const canonicalMatch = await resolveCanonicalMatchContext(row);
        const canonicalPlayerId = await resolveMergedReconciliationPlayerId(
          row,
          playerIdentityDirectory
        );
        mergedRows.push({
          entityKey: buildMatchLogEntityKey({
            season: Number(row.season ?? options.season),
            roundNumber: Number(row.round ?? round),
            matchId: canonicalMatch.matchId,
            playerId: canonicalPlayerId,
            playerName: String(row.player_name ?? ''),
            opponent: canonicalMatch.opponent,
          }),
          matchId:
            canonicalMatch.matchId ??
            buildMergedReconciliationEntityKey(row),
          season: Number(row.season ?? options.season),
          roundNumber: Number(row.round ?? round),
          playerId: canonicalPlayerId,
          playerName: String(row.player_name ?? ''),
          team: String(row.team ?? ''),
          opponent: canonicalMatch.opponent,
          stage: buildMergedStageSnapshot(row),
          rawRow: {
            ...row,
            player_id: canonicalPlayerId ?? row.player_id,
            playerId: canonicalPlayerId ?? row.playerId,
            match_id: canonicalMatch.matchId ?? row.match_id,
            opposition: canonicalMatch.opponent || row.opposition,
          },
        });
      }
    } catch (error) {
      options.onProgress?.({
        event: 'round_fetch_error',
        season: options.season,
        round,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      await fs.rm(outfile, { force: true }).catch(() => undefined);
      await fs.rm(metaOutfile, { force: true }).catch(() => undefined);
    }
  }

  return {
    rows: mergedRows,
    sourceDiagnostics,
  };
}

function incrementCount(
  counts: Omit<
    ImportAdvancedFootywireRoundsResult,
    'season' | 'rounds' | 'dryRun' | 'fetchedRows' | 'sourceDiagnostics'
  >,
  result: IngestResult
): void {
  switch (result) {
    case 'written':
      counts.written += 1;
      return;
    case 'skipped_status':
      counts.skippedStatus += 1;
      return;
    case 'skipped_unchanged':
      counts.skippedUnchanged += 1;
      return;
    case 'quarantined_ambiguous':
      counts.quarantinedAmbiguous += 1;
      return;
    case 'quarantined_unresolved':
      counts.quarantinedUnresolved += 1;
      return;
    case 'observed_resolved':
      counts.observedResolved += 1;
      return;
    case 'observed_quarantined_ambiguous':
      counts.observedQuarantinedAmbiguous += 1;
      return;
    case 'observed_quarantined_unresolved':
      counts.observedQuarantinedUnresolved += 1;
      return;
  }
}

async function withEtlProcessingEnv<T>(
  options: { dryRun: boolean; dataSource: string },
  fn: () => Promise<T>
): Promise<T> {
  const previous = {
    BACKFILL_MODE: process.env.BACKFILL_MODE,
    ALLOWED_MATCH_STATUSES: process.env.ALLOWED_MATCH_STATUSES,
    OBSERVE_ONLY: process.env.OBSERVE_ONLY,
    ETL_OBSERVE_MODE: process.env.ETL_OBSERVE_MODE,
    DATA_SOURCE: process.env.DATA_SOURCE,
  };

  process.env.BACKFILL_MODE = 'true';
  process.env.ALLOWED_MATCH_STATUSES =
    process.env.ALLOWED_MATCH_STATUSES ?? 'scheduled,in_progress,final,unknown';
  process.env.OBSERVE_ONLY = options.dryRun ? 'true' : 'false';
  process.env.ETL_OBSERVE_MODE = options.dryRun ? 'true' : 'false';
  process.env.DATA_SOURCE = options.dataSource;

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function importAdvancedFootywireRounds(
  options: ImportAdvancedFootywireRoundsOptions
): Promise<ImportAdvancedFootywireRoundsResult> {
  const rounds = [...new Set(options.rounds)].sort((a, b) => a - b);
  const counts = {
    written: 0,
    skippedStatus: 0,
    skippedUnchanged: 0,
    quarantinedAmbiguous: 0,
    quarantinedUnresolved: 0,
    observedResolved: 0,
    observedQuarantinedAmbiguous: 0,
    observedQuarantinedUnresolved: 0,
  };
  let fetchedRows = 0;
  const sourceDiagnostics: ImportAdvancedFootywireRoundsResult['sourceDiagnostics'] = [];

  const merged = await fetchMergedIngestRowsForRounds(options);
  fetchedRows = merged.rows.length;
  sourceDiagnostics.push(...merged.sourceDiagnostics);

  await withEtlProcessingEnv(
    {
      dryRun: options.dryRun ?? false,
      dataSource: 'fitzroy_merged',
    },
    async () => {
      for (const row of merged.rows) {
        const result = await processPlayerRow(row.rawRow as Parameters<typeof processPlayerRow>[0]);
        incrementCount(counts, result);
      }
    }
  );

  return {
    season: options.season,
    rounds,
    dryRun: options.dryRun ?? false,
    fetchedRows,
    sourceDiagnostics,
    ...counts,
  };
}
