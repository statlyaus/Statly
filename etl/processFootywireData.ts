#!/usr/bin/env node
import '../shared/env/loadEnv';

import { createHash } from 'crypto';
import * as readline from 'readline';
import * as admin from './firebaseAdmin';
import { z } from 'zod';
import { prisma } from '../shared/db/prisma';
import {
  recordUnresolvedPlayerStatRow,
  resolvePlayerIdentity,
} from '../shared/player-identity/playerIdentityResolver';
import {
  FOOTYWIRE_CANONICAL_STAT_FIELDS,
  buildFootywireCanonicalAvailability,
  buildFootywireCanonicalProvenance,
  buildFootywireCanonicalRawMatchContract,
  hasFootywireCanonicalRawMatchContract,
  rankFootywireCanonicalSource,
  type FootywireCanonicalRawMatchContract,
  type FootywireCanonicalStatField,
  type FootywireCanonicalStats,
} from '../src/lib/stats/footywireCanonicalContract';
import { getAflTeamAbbreviation } from '../shared/player-identity/teamNames';

// Lightweight structured logger wrapper (replace with '@/lib/logger' if available)
type Logger = {
  info: (message?: any, ...optionalParams: any[]) => void;
  warn: (message?: any, ...optionalParams: any[]) => void;
  error: (message?: any, ...optionalParams: any[]) => void;
  performanceWarn?: (message?: any, ...optionalParams: any[]) => void;
  time?: (label?: string) => void;
  timeEnd?: (label?: string) => void;
};
const logger: Logger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  performanceWarn: (...args) => console.warn(...args),
  time: (label?: string) => console.time(label),
  timeEnd: (label?: string) => console.timeEnd(label),
};

function getTeamAbbr(team: string): string {
  return getAflTeamAbbreviation(team);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');
}

function computeChecksum(data: unknown): string {
  return createHash('md5').update(JSON.stringify(data)).digest('hex');
}

// ---- Firebase Admin initialization (lazy) ----
function initAdmin(): void {
  if (admin.apps.length) return;
  try {
    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;

    if (!serviceAccountBase64) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
    }

    const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: String(serviceAccount.private_key).replace(/\\n/g, '\n'),
      }),
      projectId: serviceAccount.project_id,
    });

    logger.info(`🔥 Firebase Admin initialized for project: ${serviceAccount.project_id}`);
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin:', error);
    throw error;
  }
}

function getDb(): FirebaseFirestore.Firestore {
  initAdmin();
  return admin.firestore();
}

// ---- Types ----
interface PlayerRow {
  season: number;
  round: number;
  team: string;
  opposition?: string;
  player_name: string;
  source_name?: string;
  source_provenance?: Record<string, string>;
  source_priority?: string[];
  raw_source_rows?: Record<string, unknown>;
  kicks?: number;
  handballs?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  behinds?: number;
  hit_outs?: number;
  clearances?: number;
  inside_50s?: number;
  rebound_50s?: number;
  clangers?: number;
  contested_possessions?: number;
  uncontested_possessions?: number;
  frees_for?: number;
  frees_against?: number;
  one_percenters?: number;
  goal_assists?: number;
  turnovers?: number;
  intercepts?: number;
  metres_gained?: number;
  contested_marks?: number;
  effective_disposals?: number;
  score_involvements?: number;
  minutes?: number;
  tog_pct?: number;
  disposal_efficiency?: number;
}

interface ProcessedStats extends FootywireCanonicalStats {
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hit_outs: number;
  clearances: number;
  inside_50s: number;
  rebound_50s: number;
  clangers: number;
  contested_possessions: number;
  uncontested_possessions: number;
  frees_for: number;
  frees_against: number;
  one_percenters: number;
  goal_assists: number;
  turnovers: number;
  intercepts: number;
  metres_gained: number;
  contested_marks: number;
  effective_disposals: number;
  score_involvements: number;
  minutes: number;
  tog_pct: number;
  disposal_efficiency: number;
}

type CanonicalRawMatchContract = FootywireCanonicalRawMatchContract;

function hasCanonicalPersistedMatchIdentity(
  value: Record<string, unknown> | undefined,
  matchIdentity: CanonicalMatchIdentity
): boolean {
  if (!value) return false;

  const persistedMatchUid =
    readString(value.match_uid) ?? readString(value.matchUid) ?? readString(value.match_id);
  if (persistedMatchUid !== matchIdentity.matchUid) return false;

  if (!matchIdentity.matchedExistingMatch) {
    return true;
  }

  return (
    readString(value.home_team) === matchIdentity.homeTeam &&
    readString(value.away_team) === matchIdentity.awayTeam &&
    readString(value.match_home_team) === matchIdentity.homeTeam &&
    readString(value.match_away_team) === matchIdentity.awayTeam
  );
}

function readNumberOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCanonicalMatchDate(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type CanonicalMatchMetadata = {
  matchDate: string | null;
  startTimeUtc: string | null;
  venue: string | null;
  result: string | null;
  attendance: number | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
};

function hasCanonicalPersistedMatchMetadata(
  value: Record<string, unknown> | undefined,
  matchIdentity: CanonicalMatchIdentity
): boolean {
  if (!value) return false;

  const persistedMatchDate =
    normalizeCanonicalMatchDate(value.match_date) ??
    normalizeCanonicalMatchDate(value.date) ??
    normalizeCanonicalMatchDate(
      typeof value.canonical_match_metadata === 'object' && value.canonical_match_metadata
        ? (value.canonical_match_metadata as Record<string, unknown>).match_date
        : undefined
    );

  return (
    persistedMatchDate === matchIdentity.metadata.matchDate &&
    readString(value.start_time_utc) === matchIdentity.metadata.startTimeUtc &&
    readString(value.venue) === matchIdentity.metadata.venue &&
    readString(value.result) === matchIdentity.metadata.result &&
    readNumberOrNull(value.attendance) === matchIdentity.metadata.attendance &&
    readNumberOrNull(value.home_score) === matchIdentity.metadata.homeScore &&
    readNumberOrNull(value.away_score) === matchIdentity.metadata.awayScore &&
    readString(value.status) === matchIdentity.metadata.status
  );
}

type MatchStatus = 'scheduled' | 'in_progress' | 'final' | 'unknown';
type CanonicalMatchIdentity = {
  matchUid: string;
  playerDocId: string;
  legacyPlayerDocId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  matchedExistingMatch: boolean;
  metadata: CanonicalMatchMetadata;
};
type ProcessResult =
  | 'written'
  | 'observed_resolved'
  | 'observed_quarantined_ambiguous'
  | 'observed_quarantined_unresolved'
  | 'quarantined_ambiguous'
  | 'quarantined_unresolved'
  | 'skipped_status'
  | 'skipped_unchanged';

const PlayerRowSchema = z
  .object({
    season: z.coerce.number(),
    round: z.coerce.number(),
    team: z.string(),
    opposition: z.string().optional(),
    player_name: z.string().min(1),
    kicks: z.coerce.number().optional(),
    handballs: z.coerce.number().optional(),
    disposals: z.coerce.number().optional(),
    marks: z.coerce.number().optional(),
    tackles: z.coerce.number().optional(),
    goals: z.coerce.number().optional(),
    behinds: z.coerce.number().optional(),
    hit_outs: z.coerce.number().optional(),
    clearances: z.coerce.number().optional(),
    inside_50s: z.coerce.number().optional(),
    rebound_50s: z.coerce.number().optional(),
    clangers: z.coerce.number().optional(),
    contested_possessions: z.coerce.number().optional(),
    uncontested_possessions: z.coerce.number().optional(),
    frees_for: z.coerce.number().optional(),
    frees_against: z.coerce.number().optional(),
    one_percenters: z.coerce.number().optional(),
    goal_assists: z.coerce.number().optional(),
    turnovers: z.coerce.number().optional(),
    intercepts: z.coerce.number().optional(),
    metres_gained: z.coerce.number().optional(),
    contested_marks: z.coerce.number().optional(),
    effective_disposals: z.coerce.number().optional(),
    score_involvements: z.coerce.number().optional(),
    minutes: z.coerce.number().optional(),
    tog_pct: z.coerce.number().optional(),
    disposal_efficiency: z.coerce.number().optional(),
  })
  .passthrough();

function n(v: unknown): number {
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

function hasSourceValue(v: unknown): boolean {
  if (v == null) return false;
  const num = Number(v);
  return Number.isFinite(num);
}

function stripUndefinedForFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(stripUndefinedForFirestore);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      stripUndefinedForFirestore(entry),
    ])
  );
}

type CanonicalFieldValue = {
  value: unknown;
  hasValue: boolean;
  source: string | null;
};

function normalizeSourceName(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'legacy_top_level';
}

function sourceRowsByPriority(row: PlayerRow): Array<[string, Record<string, unknown>]> {
  const rawSourceRows =
    row.raw_source_rows && typeof row.raw_source_rows === 'object'
      ? (row.raw_source_rows as Record<string, unknown>)
      : {};
  const entries = Object.entries(rawSourceRows).flatMap(([source, value]) =>
    value && typeof value === 'object'
      ? ([[normalizeSourceName(source), value as Record<string, unknown>]] as Array<
          [string, Record<string, unknown>]
        >)
      : []
  );

  return entries.sort(
    (a, b) => rankFootywireCanonicalSource(a[0]) - rankFootywireCanonicalSource(b[0])
  );
}

function resolveCanonicalFieldValues(
  row: PlayerRow
): Record<FootywireCanonicalStatField, CanonicalFieldValue> {
  const sources = sourceRowsByPriority(row);
  const resolved = {} as Record<FootywireCanonicalStatField, CanonicalFieldValue>;

  for (const field of FOOTYWIRE_CANONICAL_STAT_FIELDS) {
    let selected: CanonicalFieldValue | null = null;

    for (const [source, sourceRow] of sources) {
      const value = sourceRow[field];
      if (!hasSourceValue(value)) continue;
      selected = {
        value,
        hasValue: true,
        source,
      };
      break;
    }

    if (!selected && hasSourceValue(row[field])) {
      selected = {
        value: row[field],
        hasValue: true,
        source: row.source_provenance?.[field] ?? row.source_name ?? null,
      };
    }

    resolved[field] = selected ?? {
      value: row[field],
      hasValue: false,
      source: row.source_provenance?.[field] ?? null,
    };
  }

  return resolved;
}

function buildProcessedStatsFromCanonicalFieldValues(
  values: Record<FootywireCanonicalStatField, CanonicalFieldValue>
): ProcessedStats {
  return {
    kicks: n(values.kicks.value),
    handballs: n(values.handballs.value),
    disposals: n(values.disposals.value),
    marks: n(values.marks.value),
    tackles: n(values.tackles.value),
    goals: n(values.goals.value),
    behinds: n(values.behinds.value),
    hit_outs: n(values.hit_outs.value),
    clearances: n(values.clearances.value),
    inside_50s: n(values.inside_50s.value),
    rebound_50s: n(values.rebound_50s.value),
    clangers: n(values.clangers.value),
    contested_possessions: n(values.contested_possessions.value),
    uncontested_possessions: n(values.uncontested_possessions.value),
    frees_for: n(values.frees_for.value),
    frees_against: n(values.frees_against.value),
    one_percenters: n(values.one_percenters.value),
    goal_assists: n(values.goal_assists.value),
    turnovers: n(values.turnovers.value),
    intercepts: n(values.intercepts.value),
    metres_gained: n(values.metres_gained.value),
    contested_marks: n(values.contested_marks.value),
    effective_disposals: n(values.effective_disposals.value),
    score_involvements: n(values.score_involvements.value),
    minutes: n(values.minutes.value),
    tog_pct: n(values.tog_pct.value),
    disposal_efficiency: n(values.disposal_efficiency.value),
  };
}

function buildCanonicalRawMatchContract(params: {
  row: PlayerRow;
  stats: ProcessedStats;
  dataSource: string;
  fieldValues?: Record<FootywireCanonicalStatField, CanonicalFieldValue>;
}): CanonicalRawMatchContract {
  const fieldValues = params.fieldValues ?? resolveCanonicalFieldValues(params.row);
  const sourcePriority = Array.from(
    new Set([
      ...sourceRowsByPriority(params.row).map(([source]) => source),
      ...(params.row.source_priority ?? []).map(normalizeSourceName),
    ])
  ).sort((a, b) => rankFootywireCanonicalSource(a) - rankFootywireCanonicalSource(b));

  return buildFootywireCanonicalRawMatchContract({
    stats: params.stats,
    availability: buildFootywireCanonicalAvailability(
      (field: FootywireCanonicalStatField) => fieldValues[field].hasValue
    ),
    provenance: buildFootywireCanonicalProvenance(
      (field: FootywireCanonicalStatField) => fieldValues[field].source
    ),
    sourceName: params.row.source_name ?? params.dataSource,
    sourcePriority,
    rawSourceRows: params.row.raw_source_rows ?? null,
  });
}

const roundMatchCache = new Map<string, Array<Record<string, unknown>>>();

function clearRoundMatchCache(): void {
  roundMatchCache.clear();
}

function buildDerivedMatchUid(row: PlayerRow): string {
  const teamAbbr = getTeamAbbr(row.team);
  const oppAbbr = row.opposition ? getTeamAbbr(row.opposition) : 'UNK';
  return `${row.season}-R${row.round}-${teamAbbr}-${oppAbbr}`;
}

function roundCacheKey(season: number, round: number): string {
  return `${season}:${round}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveCanonicalOpponent(row: PlayerRow, matchIdentity: CanonicalMatchIdentity): string {
  const team = row.team.trim().toLowerCase();
  const homeTeam = matchIdentity.homeTeam?.trim().toLowerCase() ?? null;
  const awayTeam = matchIdentity.awayTeam?.trim().toLowerCase() ?? null;

  if (team && homeTeam && awayTeam) {
    if (team === homeTeam) return matchIdentity.awayTeam ?? row.opposition ?? 'Unknown';
    if (team === awayTeam) return matchIdentity.homeTeam ?? row.opposition ?? 'Unknown';
  }

  return row.opposition || 'Unknown';
}

async function loadRoundMatches(
  season: number,
  round: number
): Promise<Array<Record<string, unknown>>> {
  const cacheKey = roundCacheKey(season, round);
  const cached = roundMatchCache.get(cacheKey);
  if (cached) return cached;

  const byRoundNumber = await getDb()
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  const docs = !byRoundNumber.empty
    ? byRoundNumber.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    : (
        await getDb()
          .collection('matches')
          .where('season', '==', season)
          .where('round', '==', round)
          .get()
      ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  roundMatchCache.set(cacheKey, docs);
  return docs;
}

async function resolveCanonicalMatchIdentity(row: PlayerRow): Promise<CanonicalMatchIdentity> {
  const derivedMatchUid = buildDerivedMatchUid(row);
  const playerUid = `ply_${slugify(row.player_name)}`;
  const derivedPlayerDocId = `${derivedMatchUid}_${playerUid}`;
  const teamAbbr = getTeamAbbr(row.team);
  const roundMatches = await loadRoundMatches(row.season, row.round);
  const oppositionAbbr = row.opposition ? getTeamAbbr(row.opposition) : null;

  const matchesForTeam = roundMatches.filter((candidate) => {
    const homeTeam = readString(candidate.home_team);
    const awayTeam = readString(candidate.away_team);
    if (!homeTeam || !awayTeam) return false;

    const homeAbbr = getTeamAbbr(homeTeam);
    const awayAbbr = getTeamAbbr(awayTeam);
    return homeAbbr === teamAbbr || awayAbbr === teamAbbr;
  });

  const matchedByOpponent =
    oppositionAbbr == null
      ? null
      : (matchesForTeam.find((candidate) => {
          const homeTeam = readString(candidate.home_team);
          const awayTeam = readString(candidate.away_team);
          if (!homeTeam || !awayTeam) return false;

          const homeAbbr = getTeamAbbr(homeTeam);
          const awayAbbr = getTeamAbbr(awayTeam);
          return (
            (homeAbbr === teamAbbr && awayAbbr === oppositionAbbr) ||
            (homeAbbr === oppositionAbbr && awayAbbr === teamAbbr)
          );
        }) ?? null);

  const matched = matchedByOpponent ?? (matchesForTeam.length === 1 ? matchesForTeam[0] : null);

  const canonicalMatchUid =
    readString(matched?.match_uid) ??
    readString(matched?.matchUid) ??
    readString(matched?.match_id) ??
    readString(matched?.id) ??
    derivedMatchUid;
  const canonicalPlayerDocId = `${canonicalMatchUid}_${playerUid}`;

  return {
    matchUid: canonicalMatchUid,
    playerDocId: canonicalPlayerDocId,
    legacyPlayerDocId: derivedPlayerDocId,
    homeTeam: readString(matched?.home_team),
    awayTeam: readString(matched?.away_team),
    matchedExistingMatch: matched != null,
    metadata: {
      matchDate:
        normalizeCanonicalMatchDate(matched?.match_date) ??
        normalizeCanonicalMatchDate(matched?.date) ??
        normalizeCanonicalMatchDate(matched?.start_time_utc),
      startTimeUtc: readString(matched?.start_time_utc),
      venue: readString(matched?.venue),
      result: readString(matched?.result),
      attendance: readNumberOrNull(matched?.attendance),
      homeScore: readNumberOrNull(matched?.home_score),
      awayScore: readNumberOrNull(matched?.away_score),
      status: readString(matched?.status),
    },
  };
}

async function checkMatchStatus(matchUid: string): Promise<MatchStatus> {
  try {
    const matchDoc = await getDb().collection('matches').doc(matchUid).get();
    const status =
      (matchDoc.exists ? (matchDoc.data()?.status as MatchStatus | undefined) : undefined) ??
      'unknown';
    return status;
  } catch (error) {
    logger.error(`Error checking match status for ${matchUid}:`, error);
    return 'unknown';
  }
}

async function processPlayerRow(
  row: PlayerRow,
  writer?: FirebaseFirestore.BulkWriter
): Promise<ProcessResult> {
  const observeOnly =
    process.env.OBSERVE_ONLY === 'true' || process.env.ETL_OBSERVE_MODE === 'true';
  const matchIdentity = await resolveCanonicalMatchIdentity(row);
  const matchUid = matchIdentity.matchUid;
  const docId = matchIdentity.playerDocId;

  // Check if we're in backfill mode (skip match status validation for historical data)
  const isBackfillMode = process.env.BACKFILL_MODE === 'true';
  const logBackfill = process.env.BACKFILL_LOGS === 'true';

  // Configurable gating of allowed statuses (default to in_progress)
  const allowedStatuses = new Set(
    (process.env.ALLOWED_MATCH_STATUSES ?? 'in_progress')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  // Check if match is still in progress before processing (skip in backfill mode)
  if (!isBackfillMode) {
    const matchStatus = await checkMatchStatus(matchUid);
    if (!allowedStatuses.has(matchStatus)) {
      if (!isBackfillMode || logBackfill) {
        logger.info(`Skipping ${docId} - match status: ${matchStatus}`);
      }
      return 'skipped_status';
    }
  }

  const fieldValues = resolveCanonicalFieldValues(row);
  const stats = buildProcessedStatsFromCanonicalFieldValues(fieldValues);

  const dataSource = process.env.DATA_SOURCE || 'footywire_fitzroy';
  const canonical = buildCanonicalRawMatchContract({
    row,
    stats,
    dataSource,
    fieldValues,
  });
  const canonicalOpponent = resolveCanonicalOpponent(row, matchIdentity);
  const resolution = await resolvePlayerIdentity(prisma, {
    playerName: row.player_name,
    team: row.team,
    season: row.season,
    round: row.round,
    source: dataSource,
    sourceDocumentId: docId,
    sourceMatchId: matchUid,
    rawPayload: {
      player_name: row.player_name,
      team: row.team,
      season: row.season,
      round: row.round,
      match_id: matchUid,
      player_uid: `ply_${slugify(row.player_name)}`,
      row,
      canonical_stats: canonical,
      source_provenance: row.source_provenance,
      source_priority: row.source_priority,
      raw_source_rows: row.raw_source_rows,
      canonical_match_identity: matchIdentity,
    },
  });

  if (resolution.outcome !== 'resolved') {
    if (!observeOnly) {
      await recordUnresolvedPlayerStatRow(
        prisma,
        {
          playerName: row.player_name,
          team: row.team,
          season: row.season,
          round: row.round,
          source: dataSource,
          sourceDocumentId: docId,
          sourceMatchId: matchUid,
          rawPayload: {
            player_name: row.player_name,
            team: row.team,
            season: row.season,
            round: row.round,
            match_id: matchUid,
            player_uid: `ply_${slugify(row.player_name)}`,
            stats,
            canonical_stats: canonical,
            raw_row: row,
            source_provenance: row.source_provenance,
            source_priority: row.source_priority,
            raw_source_rows: row.raw_source_rows,
            canonical_match_identity: matchIdentity,
          },
        },
        resolution
      );
    }

    logger.warn(
      `${observeOnly ? 'Observed' : 'Quarantined'} ${docId} - ${row.player_name} (${row.team}) identity ${resolution.outcome}`,
      resolution.candidates.length > 0 ? { candidates: resolution.candidates } : undefined
    );
    if (observeOnly) {
      return resolution.outcome === 'ambiguous'
        ? 'observed_quarantined_ambiguous'
        : 'observed_quarantined_unresolved';
    }
    return resolution.outcome === 'ambiguous' ? 'quarantined_ambiguous' : 'quarantined_unresolved';
  }

  if (observeOnly) {
    logger.info(`Observed ${docId} - would write canonical player ${resolution.playerId}`);
    return 'observed_resolved';
  }

  // Compute checksum and inspect the canonical Firestore row only after identity
  // resolution succeeds, so unresolved rows stay Prisma-first.
  const rawChecksum = computeChecksum(row);
  const docRef = getDb().collection('player_match_stats').doc(docId);
  const existingDoc = await docRef.get();

  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (
      existingData?.raw_checksum === rawChecksum &&
      hasFootywireCanonicalRawMatchContract(existingData?.canonical_stats) &&
      hasCanonicalPersistedMatchIdentity(
        existingData as Record<string, unknown> | undefined,
        matchIdentity
      ) &&
      hasCanonicalPersistedMatchMetadata(
        existingData as Record<string, unknown> | undefined,
        matchIdentity
      )
    ) {
      if (!isBackfillMode || logBackfill) {
        logger.info(`Skipping ${docId} - no changes detected`);
      }
      return 'skipped_unchanged';
    }
  }

  const sanitizedRow = stripUndefinedForFirestore(row) as PlayerRow;
  const sanitizedCanonical = stripUndefinedForFirestore(canonical) as CanonicalRawMatchContract;
  const sanitizedRawSourceRows = stripUndefinedForFirestore(row.raw_source_rows) as
    | Record<string, unknown>
    | null
    | undefined;

  // Prepare document for upsert
  const documentData = {
    match_id: matchUid,
    matchUid,
    match_uid: matchUid,
    player_id: resolution.playerId,
    playerId: resolution.playerId,
    player_uid: `ply_${slugify(row.player_name)}`,
    season: row.season,
    round: row.round,
    round_number: row.round,
    team: row.team,
    team_abbr: getTeamAbbr(row.team),
    home_team: matchIdentity.homeTeam,
    away_team: matchIdentity.awayTeam,
    match_home_team: matchIdentity.homeTeam,
    match_away_team: matchIdentity.awayTeam,
    match_date: matchIdentity.metadata.matchDate,
    date: matchIdentity.metadata.matchDate,
    start_time_utc: matchIdentity.metadata.startTimeUtc,
    venue: matchIdentity.metadata.venue,
    result: matchIdentity.metadata.result,
    attendance: matchIdentity.metadata.attendance,
    home_score: matchIdentity.metadata.homeScore,
    away_score: matchIdentity.metadata.awayScore,
    status: matchIdentity.metadata.status,
    opposition: canonicalOpponent,
    opposition_abbr: canonicalOpponent ? getTeamAbbr(canonicalOpponent) : 'UNK',
    player_name: row.player_name,
    stats,
    canonical_stats: sanitizedCanonical,
    raw_row: sanitizedRow, // Store original data
    source_provenance: row.source_provenance ?? null,
    source_priority: row.source_priority ?? null,
    raw_source_rows: sanitizedRawSourceRows ?? null,
    raw_checksum: rawChecksum,
    canonical_match_identity: {
      matched_existing_match: matchIdentity.matchedExistingMatch,
      legacy_player_doc_id:
        matchIdentity.legacyPlayerDocId !== matchIdentity.playerDocId
          ? matchIdentity.legacyPlayerDocId
          : null,
    },
    canonical_match_metadata: {
      match_date: matchIdentity.metadata.matchDate,
      start_time_utc: matchIdentity.metadata.startTimeUtc,
      venue: matchIdentity.metadata.venue,
      result: matchIdentity.metadata.result,
      attendance: matchIdentity.metadata.attendance,
      home_score: matchIdentity.metadata.homeScore,
      away_score: matchIdentity.metadata.awayScore,
      status: matchIdentity.metadata.status,
    },
    last_seen_at: new Date().toISOString(),
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
    data_source: dataSource,
  } as const;

  // Upsert document
  try {
    if (writer) {
      await writer.set(docRef, documentData, { merge: true });
      if (matchIdentity.legacyPlayerDocId !== docId) {
        writer.delete(
          getDb().collection('player_match_stats').doc(matchIdentity.legacyPlayerDocId)
        );
      }
    } else {
      await docRef.set(documentData, { merge: true });
      if (matchIdentity.legacyPlayerDocId !== docId) {
        await getDb()
          .collection('player_match_stats')
          .doc(matchIdentity.legacyPlayerDocId)
          .delete()
          .catch(() => undefined);
      }
    }
    if (!isBackfillMode || logBackfill) {
      logger.info(`✓ Updated ${docId} - ${row.player_name} (${row.team})`);
    }
    return 'written';
  } catch (error) {
    logger.error(`✗ Failed to update ${docId}:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  logger.info('Starting Footywire ETL processor...');
  logger.info('Reading NDJSON from STDIN...');

  const rl = readline.createInterface({
    input: process.stdin,
  });

  let processedCount = 0;
  let errorCount = 0;
  let observedResolvedCount = 0;
  let observedQuarantinedAmbiguousCount = 0;
  let observedQuarantinedUnresolvedCount = 0;
  let quarantinedAmbiguousCount = 0;
  let quarantinedUnresolvedCount = 0;
  let skippedStatusCount = 0;
  let skippedUnchangedCount = 0;
  let shuttingDown = false;

  const observeOnly =
    process.env.OBSERVE_ONLY === 'true' || process.env.ETL_OBSERVE_MODE === 'true';
  const writer = observeOnly ? undefined : getDb().bulkWriter();

  process.on('SIGINT', () => {
    if (!shuttingDown) logger.info('\nReceived SIGINT, shutting down gracefully...');
    shuttingDown = true;
    rl.close();
  });

  process.on('SIGTERM', () => {
    if (!shuttingDown) logger.info('\nReceived SIGTERM, shutting down gracefully...');
    shuttingDown = true;
    rl.close();
  });

  try {
    for await (const line of rl) {
      if (shuttingDown) break;
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        const row: PlayerRow = PlayerRowSchema.parse(parsed);
        const result = await processPlayerRow(row, writer);
        if (result === 'written') processedCount++;
        if (result === 'observed_resolved') observedResolvedCount++;
        if (result === 'observed_quarantined_ambiguous') observedQuarantinedAmbiguousCount++;
        if (result === 'observed_quarantined_unresolved') observedQuarantinedUnresolvedCount++;
        if (result === 'quarantined_ambiguous') quarantinedAmbiguousCount++;
        if (result === 'quarantined_unresolved') quarantinedUnresolvedCount++;
        if (result === 'skipped_status') skippedStatusCount++;
        if (result === 'skipped_unchanged') skippedUnchangedCount++;
      } catch (error) {
        logger.error(`Error processing line: ${line}`, error);
        errorCount++;
      }
    }
  } finally {
    // Ensure writer flushes remaining operations
    try {
      await writer?.close();
    } catch (err) {
      logger.error('Error closing BulkWriter:', err);
      errorCount++;
    }
  }

  logger.info(
    `\nETL Complete: ${processedCount} written, ${observedResolvedCount} observed_resolved, ${observedQuarantinedAmbiguousCount} observed_quarantined_ambiguous, ${observedQuarantinedUnresolvedCount} observed_quarantined_unresolved, ${quarantinedAmbiguousCount} quarantined_ambiguous, ${quarantinedUnresolvedCount} quarantined_unresolved, ${skippedStatusCount} skipped_status, ${skippedUnchangedCount} skipped_unchanged, ${errorCount} errors`
  );

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Unhandled error in main()', err);
    process.exitCode = 1;
  });
}

export {
  processPlayerRow,
  checkMatchStatus,
  buildCanonicalRawMatchContract,
  clearRoundMatchCache,
  hasFootywireCanonicalRawMatchContract as hasCanonicalRawMatchContract,
};
