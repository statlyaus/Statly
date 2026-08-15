import 'server-only';

import { createHash } from 'node:crypto';

import { Pool } from 'pg';

import {
  projectAflOutcomesDevelopmentWorkbookValues,
  type AflTradeDevelopmentWorkbookValueProjection,
} from '@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection';
import { loadLocalAflTradeStagedWorkbookOutcomes } from '@/server/aflTradeIntelligence/development/localStagedWorkbookOutcomeProjection';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  projectAflOutcomesDevelopmentWorkbookAcquisitions,
  type AflOutcomesDevelopmentAcquisitionCategory,
  type AflOutcomesDevelopmentAcquisitionItem,
  type AflOutcomesDevelopmentAcquisitionProjection,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';
import {
  loadAflOutcomesDevelopmentWorkbook,
  type LoadAflOutcomesDevelopmentWorkbookInput,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import {
  projectAflOutcomesDevelopmentWorkbookTrades,
  type AflOutcomesDevelopmentTradeProjection,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';
import {
  projectAflOutcomesDevelopmentWorkbookTradeGrades,
  type AflOutcomesDevelopmentTradeGradeEvidence,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeOutcomeProjection';

import type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeDetail,
  DraftTradeListItem,
} from './firestore';

export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_READ_ENABLED_ENV =
  'AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED' as const;

export interface DraftTradeReadRepository {
  listTradesByYear(
    year: number,
    options?: {
      clubSlug?: string;
      type?: 'player' | 'pick' | 'future_pick';
      q?: string;
    }
  ): Promise<DraftTradeListItem[]>;
  listYears(): Promise<number[]>;
  getById(tradeId: string): Promise<DraftTradeDetail | null>;
  listRefsByClub(clubSlug: string): Promise<DraftClubTradeRefItem[]>;
  listClubs(): Promise<DraftClubListItem[]>;
}

export interface DevelopmentWorkbookDraftTradeEnvironment {
  NODE_ENV?: string;
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED?: string;
  AFL_OUTCOMES_DEV_WORKBOOK_PATH?: string;
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256?: string;
  AFL_OUTCOMES_DATABASE_URL?: string;
}

export interface DevelopmentWorkbookAcquisitionPreviewQuery {
  year: number | null;
  club: string;
  q: string;
  category: AflOutcomesDevelopmentAcquisitionCategory | null;
  limit: number;
}

export interface DevelopmentWorkbookAcquisitionPreview {
  items: readonly AflOutcomesDevelopmentAcquisitionItem[];
  total: number;
  categoryCounts: AflOutcomesDevelopmentAcquisitionProjection['categoryCounts'];
  years: readonly number[];
}

interface DevelopmentWorkbookProjectionBundle {
  trades: AflOutcomesDevelopmentTradeProjection;
  acquisitions: AflOutcomesDevelopmentAcquisitionProjection;
  tradeGrades: ReadonlyMap<string, AflOutcomesDevelopmentTradeGradeEvidence>;
  observedAt: string;
  stagedOutcomeCache: Promise<
    ReadonlyMap<
      string,
      import('@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection').AflTradeDevelopmentReconciledAcquisitionOutcome
    >
  > | null;
  statlyValueCache: Map<string, Promise<AflTradeDevelopmentWorkbookValueProjection>>;
}

const projectionCache = new Map<string, Promise<DevelopmentWorkbookProjectionBundle>>();

export function isDevelopmentWorkbookDraftTradeReadEnabled(
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): boolean {
  return (
    environment.NODE_ENV !== 'production' &&
    environment.AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED?.trim().toLowerCase() === 'true'
  );
}

function requiredEnvironmentValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required when development workbook reads are enabled.`);
  }
  return normalized;
}

async function loadProjectionBundle(
  environment: DevelopmentWorkbookDraftTradeEnvironment
): Promise<DevelopmentWorkbookProjectionBundle> {
  const workbookPath = requiredEnvironmentValue(
    environment.AFL_OUTCOMES_DEV_WORKBOOK_PATH,
    'AFL_OUTCOMES_DEV_WORKBOOK_PATH'
  );
  const expectedSha256 = requiredEnvironmentValue(
    environment.AFL_OUTCOMES_DEV_WORKBOOK_SHA256,
    'AFL_OUTCOMES_DEV_WORKBOOK_SHA256'
  );
  const outcomeDatabaseIdentity = createHash('sha256')
    .update(environment.AFL_OUTCOMES_DATABASE_URL?.trim() ?? '')
    .digest('hex');
  const cacheKey = `${workbookPath}\0${expectedSha256.toLowerCase()}\0${outcomeDatabaseIdentity}`;
  const cached = projectionCache.get(cacheKey);
  if (cached) return cached;

  const loadInput: LoadAflOutcomesDevelopmentWorkbookInput = {
    workbookPath,
    expectedSha256,
    runtimeEnvironment: environment.NODE_ENV,
  };
  const pending = loadAflOutcomesDevelopmentWorkbook(loadInput).then((workbook) => {
    const trades = projectAflOutcomesDevelopmentWorkbookTrades(workbook);
    const acquisitions = projectAflOutcomesDevelopmentWorkbookAcquisitions(workbook);
    return {
      trades,
      acquisitions,
      tradeGrades: projectAflOutcomesDevelopmentWorkbookTradeGrades(workbook, trades, acquisitions),
      observedAt: workbook.report.source.observedAt,
      stagedOutcomeCache: null,
      statlyValueCache: new Map(),
    };
  });
  projectionCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    projectionCache.delete(cacheKey);
    throw error;
  }
}

function localOutcomeDatabaseUrl(
  environment: DevelopmentWorkbookDraftTradeEnvironment
): string | null {
  const value = environment.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) return null;
  if (environment.NODE_ENV === 'production') {
    throw new Error('Private workbook outcomes cannot read PostgreSQL in production mode.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AFL_OUTCOMES_DATABASE_URL must be a valid local PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  ) {
    throw new Error(
      'Private workbook outcomes accept only a loopback PostgreSQL rehearsal database.'
    );
  }
  return value;
}

async function loadStagedOutcomes(
  bundle: DevelopmentWorkbookProjectionBundle,
  environment: DevelopmentWorkbookDraftTradeEnvironment
) {
  const databaseUrl = localOutcomeDatabaseUrl(environment);
  if (databaseUrl === null) return new Map();
  if (bundle.stagedOutcomeCache) return bundle.stagedOutcomeCache;
  const pending = (async () => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: 'statly-local-workbook-outcome-projection',
    });
    try {
      return await loadLocalAflTradeStagedWorkbookOutcomes(
        createPgAflOutcomeSqlClient(pool),
        bundle.acquisitions.items
      );
    } finally {
      await pool.end();
    }
  })();
  bundle.stagedOutcomeCache = pending;
  try {
    return await pending;
  } catch (error) {
    bundle.stagedOutcomeCache = null;
    throw error;
  }
}

function projectionCreatedAt(
  observedAt: string,
  outcomes: ReadonlyMap<
    string,
    import('@/server/aflTradeIntelligence/modeling/developmentWorkbookValueProjection').AflTradeDevelopmentReconciledAcquisitionOutcome
  >
): string {
  return [...outcomes.values()].reduce(
    (latest, outcome) =>
      Date.parse(outcome.effectiveThrough) > Date.parse(latest)
        ? new Date(outcome.effectiveThrough).toISOString()
        : latest,
    new Date(observedAt).toISOString()
  );
}

function createRepository(
  projection: AflOutcomesDevelopmentTradeProjection
): DraftTradeReadRepository {
  return {
    async listTradesByYear(year, options) {
      const trades = [...(projection.tradesByYear.get(year) ?? [])];
      const byClub = options?.clubSlug
        ? trades.filter(({ clubSlugs }) => clubSlugs.includes(options.clubSlug as string))
        : trades;
      const byType = options?.type
        ? byClub.filter((trade) => {
            if (options.type === 'player') return trade.hasPlayers;
            if (options.type === 'future_pick') return trade.hasFuturePicks;
            return trade.hasPicks;
          })
        : byClub;
      const query = options?.q?.trim().toLowerCase();
      if (!query) return byType;
      return byType.filter(
        ({ title, clubNames }) =>
          title.toLowerCase().includes(query) ||
          clubNames.some((clubName) => clubName.toLowerCase().includes(query))
      );
    },
    async listYears() {
      return [...projection.years];
    },
    async getById(tradeId) {
      return projection.detailsById.get(tradeId) ?? null;
    },
    async listRefsByClub(clubSlug) {
      return [...(projection.refsByClub.get(clubSlug) ?? [])];
    },
    async listClubs() {
      return [...projection.clubs];
    },
  };
}

export async function getDevelopmentWorkbookDraftTradeReadRepository(
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<DraftTradeReadRepository | null> {
  if (!isDevelopmentWorkbookDraftTradeReadEnabled(environment)) return null;
  return createRepository((await loadProjectionBundle(environment)).trades);
}

export async function getDevelopmentWorkbookAcquisitionPreview(
  query: DevelopmentWorkbookAcquisitionPreviewQuery,
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<DevelopmentWorkbookAcquisitionPreview | null> {
  if (!isDevelopmentWorkbookDraftTradeReadEnabled(environment)) return null;
  const projection = (await loadProjectionBundle(environment)).acquisitions;
  const normalizedClub = query.club.trim().toLowerCase();
  const normalizedQuery = query.q.trim().toLowerCase();
  const filtered = projection.items.filter((item) => {
    if (query.year !== null && item.year !== query.year) return false;
    if (query.category !== null && item.category !== query.category) return false;
    if (normalizedClub && !item.clubName.toLowerCase().includes(normalizedClub)) return false;
    if (
      normalizedQuery &&
      !item.playerName.toLowerCase().includes(normalizedQuery) &&
      !item.acquisitionType.toLowerCase().includes(normalizedQuery) &&
      !item.signing?.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    return true;
  });
  return {
    items: filtered.slice(0, Math.max(1, Math.min(query.limit, 100))),
    total: filtered.length,
    categoryCounts: projection.categoryCounts,
    years: projection.years,
  };
}

export async function getDevelopmentWorkbookTradeGradeEvidence(
  tradeId: string,
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<AflOutcomesDevelopmentTradeGradeEvidence | null> {
  if (!isDevelopmentWorkbookDraftTradeReadEnabled(environment)) return null;
  return (await loadProjectionBundle(environment)).tradeGrades.get(tradeId) ?? null;
}

async function loadDevelopmentWorkbookStatlyTradeValues(
  tradeIds: readonly string[],
  maximumTrades: number,
  limitMessage: string,
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<AflTradeDevelopmentWorkbookValueProjection | null> {
  if (!isDevelopmentWorkbookDraftTradeReadEnabled(environment)) return null;
  const bundle = await loadProjectionBundle(environment);
  const requestedTradeIds = [...new Set(tradeIds)].filter((tradeId) =>
    bundle.trades.detailsById.has(tradeId)
  );
  if (requestedTradeIds.length > maximumTrades) {
    throw new Error(limitMessage);
  }
  const cacheKey = [...requestedTradeIds].sort().join('\0');
  const cached = bundle.statlyValueCache.get(cacheKey);
  if (cached) return cached;
  const pending = loadStagedOutcomes(bundle, environment).then((reconciledOutcomesByAcquisitionId) =>
    projectAflOutcomesDevelopmentWorkbookValues({
      trades: bundle.trades,
      acquisitions: bundle.acquisitions,
      providerSeasons: [],
      reconciledOutcomesByAcquisitionId,
      createdAt: projectionCreatedAt(bundle.observedAt, reconciledOutcomesByAcquisitionId),
      minimumCohortSize: 20,
      tradeIds: requestedTradeIds,
    })
  );
  bundle.statlyValueCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    bundle.statlyValueCache.delete(cacheKey);
    throw error;
  }
}

export async function getDevelopmentWorkbookStatlyTradeValues(
  tradeIds: readonly string[],
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<AflTradeDevelopmentWorkbookValueProjection | null> {
  return loadDevelopmentWorkbookStatlyTradeValues(
    tradeIds,
    100,
    'Development Statly value reads are bounded to 100 trades per request.',
    environment
  );
}

export async function getDevelopmentWorkbookStatlyTradeEvaluationValues(
  tradeIds: readonly string[],
  environment: DevelopmentWorkbookDraftTradeEnvironment = process.env
): Promise<AflTradeDevelopmentWorkbookValueProjection | null> {
  return loadDevelopmentWorkbookStatlyTradeValues(
    tradeIds,
    2_000,
    'Private local workbook evaluation is bounded to 2,000 trades.',
    environment
  );
}

export function clearDevelopmentWorkbookDraftTradeReadCacheForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Development workbook cache reset is test-only.');
  }
  projectionCache.clear();
}
