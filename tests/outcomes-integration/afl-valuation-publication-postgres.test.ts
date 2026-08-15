import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactElement } from 'react';

import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { publicRuntime } = vi.hoisted(() => ({
  publicRuntime: {
    archiveReadRepository: null as Record<string, unknown> | null,
    valueReadService: null as Record<string, unknown> | null,
    methodologyReadService: null as Record<string, unknown> | null,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => {
    if (
      publicRuntime.archiveReadRepository === null ||
      publicRuntime.valueReadService === null ||
      publicRuntime.methodologyReadService === null
    ) {
      throw new Error('The local valuation rehearsal read runtime has not been installed.');
    }
    return publicRuntime;
  },
}));

import DraftTradeDetailPage from '../../src/app/(public)/draft/trades/[tradeId]/page';
import { GET as getDraftTrades } from '../../src/app/api/draft-trades/route';
import { GET as exportDraftTrades } from '../../src/app/api/draft-trades/export/route';
import { GET as exportDraftTrade } from '../../src/app/api/draft-trades/[tradeId]/export/route';
import { GET as getValuation } from '../../src/app/api/draft-trades/[tradeId]/valuation/route';
import { GET as getMethodology } from '../../src/app/api/draft-trades/methodology/route';
import { GET as getValuations } from '../../src/app/api/draft-trades/valuations/route';
import { createPostgresDraftTradeReadRepository } from '@/lib/draftTrades/postgres';
import { createLocalAflTradeArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { prepareAndRehearseLocalAflTradeValuationPublication } from '@/server/aflTradeIntelligence/development/localAflTradeValuationPublicationRehearsal';
import { seedLocalAflTradeOutcomeArchive } from '@/server/aflTradeIntelligence/development/postgresLocalOutcomeArchiveSeed';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflDraftTradeOutcomeReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflDraftTradeOutcomeRegistrySnapshotStore } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';
import { PostgresAflTradePromotionBackedGate2Repository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';
import { createAflTradePromotionBackedArchiveSelector } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import { createGovernedAflTradePublicationSelector } from '@/server/aflTradeIntelligence/publication/governedPublicationSelector';
import { createAflTradeMethodologyReadService } from '@/server/aflTradeIntelligence/publication/methodologyReadService';
import { createPostgresAflTradeProjectionArtifactReleaseSource } from '@/server/aflTradeIntelligence/publication/postgresProjectionArtifactReleaseSource';
import { createPostgresAflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import { createAflTradeProjectionArtifactReadRepository } from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { createResolvingAflTradeProjectionReadRepository } from '@/server/aflTradeIntelligence/publication/resolvingProjectionReadRepository';
import { createPostgresAflTradeValuationPublicationCommandService } from '@/server/aflTradeIntelligence/publication/valuationPublicationCommandService';
import { createAflTradeValueReadService } from '@/server/aflTradeIntelligence/publication/valueReadService';
import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const containerId =
  process.env.AFL_OUTCOMES_TEST_CONTAINER_ID ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_CONTAINER_ID is required.');
  })();
if (!/^[a-f0-9]{64}$/u.test(containerId)) {
  throw new Error('The disposable PostgreSQL container identifier is invalid.');
}
const schemaName = `afl_valuation_rehearsal_${process.pid}_${Date.now()}${randomInt(10_000)
  .toString()
  .padStart(4, '0')}`;
const archivePath = `/tmp/${schemaName}.dump`;
const adminPool = new Pool({ connectionString: databaseUrl });
let outcomesPool: Pool | undefined;
let artifactRoot: string | undefined;

function createOutcomesPool(): Pool {
  return new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
}

function currentOutcomesPool(): Pool {
  if (outcomesPool === undefined) throw new Error('The disposable outcomes pool is unavailable.');
  return outcomesPool;
}

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function runPostgresTool(tool: 'pg_dump' | 'pg_restore', args: string[]): void {
  execFileSync('docker', ['exec', '--env', 'PGPASSWORD=statly_test', containerId, tool, ...args], {
    stdio: 'pipe',
    timeout: 30_000,
  });
}

function localArtifactRepository(
  artifactClass: 'derived_private' | 'public_projection',
  repositoryId: string
) {
  if (artifactRoot === undefined) throw new Error('Local artifact root is unavailable.');
  return createLocalAflTradeArtifactRepository({
    rootDirectory: artifactRoot,
    artifactClass,
    repositoryId,
    maximumObjectBytes: 128 * 1024 * 1024,
  });
}

async function postgresNow(): Promise<string> {
  const result = await currentOutcomesPool().query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (value === undefined) throw new Error('PostgreSQL did not return a rehearsal timestamp.');
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-valuation-rehearsal-'));
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  outcomesPool = createOutcomesPool();
});

afterAll(async () => {
  publicRuntime.archiveReadRepository = null;
  publicRuntime.valueReadService = null;
  publicRuntime.methodologyReadService = null;
  await outcomesPool?.end();
  try {
    execFileSync('docker', ['exec', containerId, 'rm', '-f', '--', archivePath], {
      stdio: 'pipe',
      timeout: 30_000,
    });
  } finally {
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await adminPool.end();
      if (artifactRoot !== undefined) await rm(artifactRoot, { recursive: true, force: true });
    }
  }
});

describe('local AFL valuation-publication rehearsal', () => {
  it('serves and restores one archive-bound release and proves rollback and withdrawal', async () => {
    let client = createPgAflOutcomeSqlClient(currentOutcomesPool());
    const factual = await seedLocalAflTradeOutcomeArchive(client);
    const derivedRepository = localArtifactRepository(
      'derived_private',
      'local-synthetic-valuation-derived'
    );
    let publicProjectionRepository = localArtifactRepository(
      'public_projection',
      'local-synthetic-valuation-public'
    );
    const { lifecycle, replacement } = await prepareAndRehearseLocalAflTradeValuationPublication({
      client,
      factual,
      derivedRepository,
      publicProjectionRepository,
    });
    expect(lifecycle.activeSequence).toEqual([
      lifecycle.baselinePublicationId,
      lifecycle.replacementPublicationId,
      lifecycle.baselinePublicationId,
      null,
      lifecycle.replacementPublicationId,
    ]);
    expect(lifecycle.idempotentReplay).toBe(false);
    expect(lifecycle.factualStateAfter).toEqual(lifecycle.factualStateBefore);

    const { lifecycle: replay } = await prepareAndRehearseLocalAflTradeValuationPublication({
      client,
      factual,
      derivedRepository,
      publicProjectionRepository,
    });
    expect(replay).toMatchObject({
      idempotentReplay: true,
      baselinePublicationId: lifecycle.baselinePublicationId,
      replacementPublicationId: lifecycle.replacementPublicationId,
      activeSequence: [lifecycle.replacementPublicationId],
      factualStateAfter: lifecycle.factualStateBefore,
    });

    const readAt = await postgresNow();
    const listRequest = {
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      requestedView: 'current' as const,
      tradeIds: [factual.tradeId],
      limit: 1,
      cursor: null,
    };
    async function readSurfaceSnapshot(
      surfaceClient: ReturnType<typeof createPgAflOutcomeSqlClient>
    ) {
      const surfacePublicationRepository =
        createPostgresAflTradePublicationRepository(surfaceClient);
      const surfaceGateRepository =
        createPostgresAflTradeGateDecisionLedgerRepository(surfaceClient);
      const publicationSelector = createGovernedAflTradePublicationSelector({
        publicationRepository: surfacePublicationRepository,
        gateRepository: surfaceGateRepository,
        environment: 'test_fixture',
        now: () => readAt,
      });
      const factualRegistryStore = new PostgresAflDraftTradeOutcomeRegistrySnapshotStore(
        surfaceClient
      );
      const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(surfaceClient);
      const archiveSelector = createAflTradePromotionBackedArchiveSelector({
        loadRegistry: () => factualRegistryStore.load(),
        loadGateDecisionLedger: async () => (await surfaceGateRepository.load()).ledger,
        loadGate2Authority: (releaseId) => gate2Repository.loadCurrentAuthority(releaseId),
        expectedEnvironment: 'test_fixture',
        now: () => readAt,
      });
      const archiveReadRepository = createPostgresDraftTradeReadRepository({
        archiveSelector,
        archiveRepository: createPostgresAflTradePromotionBackedPublicArchiveReadRepository({
          client: surfaceClient,
        }),
      });
      const releaseSource = createPostgresAflTradeProjectionArtifactReleaseSource({
        client: surfaceClient,
        artifactRepository: publicProjectionRepository,
      });
      const projectionRepository = createResolvingAflTradeProjectionReadRepository({
        factory: (projectionId) =>
          createAflTradeProjectionArtifactReadRepository({
            projectionId,
            releaseSource,
            clock: () => readAt,
          }),
        isFactualArchiveTrade: async (tradeId) =>
          (await archiveReadRepository.getById(tradeId)) !== null,
      });
      const valueReadService = createAflTradeValueReadService({
        publicationSelector,
        projectionRepository,
        now: () => readAt,
      });
      const methodologyReadService = createAflTradeMethodologyReadService({
        publicationSelector,
        projectionRepository,
        now: () => new Date(readAt),
      });
      publicRuntime.archiveReadRepository = archiveReadRepository;
      publicRuntime.valueReadService = valueReadService;
      publicRuntime.methodologyReadService = methodologyReadService;

      const syntheticMatches = await archiveReadRepository.searchTrades(
        'synthetic local trade 1988-001',
        1
      );
      const syntheticTradeId = syntheticMatches[0]?.tradeId;
      if (!syntheticTradeId) {
        throw new Error('Expected one archive-only synthetic trade.');
      }
      const selection = await publicationSelector.capture(AFL_TRADE_PUBLIC_VALUE_SCOPE);
      if (selection.selection === null) {
        throw new Error('Expected the recovered active publication.');
      }
      await projectionRepository.read(selection.selection);
      const directList = await valueReadService.list(listRequest);
      const mixedList = await valueReadService.list({
        ...listRequest,
        tradeIds: [factual.tradeId, syntheticTradeId],
        limit: 2,
      });
      const directDetail = await valueReadService.detail({
        scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
        tradeId: factual.tradeId,
        requestedViews: AFL_TRADE_VALUATION_VIEWS,
      });
      const syntheticDetail = await valueReadService.detail({
        scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
        tradeId: syntheticTradeId,
        requestedViews: AFL_TRADE_VALUATION_VIEWS,
      });
      const listResponse = await getValuations(
        new NextRequest(
          `http://localhost/api/draft-trades/valuations?tradeId=${encodeURIComponent(factual.tradeId)}&view=current&limit=1`
        )
      );
      const detailResponse = await getValuation(
        new NextRequest(
          `http://localhost/api/draft-trades/${encodeURIComponent(factual.tradeId)}/valuation`
        ),
        { params: Promise.resolve({ tradeId: encodeURIComponent(factual.tradeId) }) }
      );
      const syntheticDetailResponse = await getValuation(
        new NextRequest(
          `http://localhost/api/draft-trades/${encodeURIComponent(syntheticTradeId)}/valuation`
        ),
        { params: Promise.resolve({ tradeId: encodeURIComponent(syntheticTradeId) }) }
      );
      const methodologyResponse = await getMethodology();
      const archiveListResponse = await getDraftTrades(
        new NextRequest('http://localhost/api/draft-trades?year=2025')
      );
      const archiveListExportResponse = await exportDraftTrades(
        new NextRequest('http://localhost/api/draft-trades/export?year=2025')
      );
      const archiveDetailExportResponse = await exportDraftTrade(
        new NextRequest(
          `http://localhost/api/draft-trades/${encodeURIComponent(factual.tradeId)}/export`
        ),
        { params: Promise.resolve({ tradeId: encodeURIComponent(factual.tradeId) }) }
      );
      const listBody = await listResponse.json();
      const detailBody = await detailResponse.json();
      const syntheticDetailBody = await syntheticDetailResponse.json();
      const methodologyBody = await methodologyResponse.json();
      const archiveListBody = await archiveListResponse.json();
      const archiveListCsv = await archiveListExportResponse.text();
      const archiveDetailCsv = await archiveDetailExportResponse.text();
      const page = (await DraftTradeDetailPage({
        params: Promise.resolve({ tradeId: encodeURIComponent(factual.tradeId) }),
      })) as ReactElement<{
        detail: { trade: { tradeId: string } };
        valueAnalysis: typeof directDetail;
        statlyValues: unknown;
      }>;
      const syntheticPage = (await DraftTradeDetailPage({
        params: Promise.resolve({ tradeId: encodeURIComponent(syntheticTradeId) }),
      })) as ReactElement<{
        detail: { trade: { tradeId: string } };
        valueAnalysis: typeof syntheticDetail;
        statlyValues: {
          atTrade: { availability: string };
          current: { availability: string };
        } | null;
      }>;
      const exported = await projectionRepository.exportRows(selection.selection, {
        tradeIds: [factual.tradeId],
        requestedViews: ['at_trade', 'current'],
      });
      const archiveDetail = await archiveReadRepository.getById(factual.tradeId);
      const archiveSelection = await archiveSelector.capture(
        factual.factualReleaseManifest.content.scopeKey
      );
      const restoredFactualRepository =
        createPostgresAflDraftTradeOutcomeReleaseRepository(surfaceClient);
      const factualRegistry = await restoredFactualRepository.loadRegistry();
      const factualState = {
        active:
          factualRegistry.activeByScope[factual.factualReleaseManifest.content.scopeKey] ?? null,
        release: factualRegistry.releases[factual.releaseId] ?? null,
      };

      expect(listResponse.status).toBe(200);
      expect(detailResponse.status).toBe(200);
      expect(syntheticDetailResponse.status).toBe(200);
      expect(methodologyResponse.status).toBe(200);
      expect(archiveListResponse.status).toBe(200);
      expect(archiveListExportResponse.status).toBe(200);
      expect(archiveDetailExportResponse.status).toBe(200);
      expect(archiveDetail).toMatchObject({ trade: { tradeId: factual.tradeId } });
      expect(archiveListBody.data.trades).toContainEqual(
        expect.objectContaining({ tradeId: factual.tradeId })
      );
      expect(archiveListCsv).toContain(factual.tradeId);
      expect(archiveDetailCsv).toContain(factual.tradeId);
      expect(page.props.detail.trade.tradeId).toBe(factual.tradeId);
      expect(page.props.statlyValues).not.toBeNull();
      expect(
        mixedList.items.map(({ tradeId, valuation }) => [tradeId, valuation.availability])
      ).toEqual([
        [factual.tradeId, expect.not.stringMatching(/^not_calculated$/)],
        [syntheticTradeId, 'not_calculated'],
      ]);
      expect(
        syntheticDetail.valuations.every(({ availability }) => availability === 'not_calculated')
      ).toBe(true);
      expect(syntheticDetailBody.data.valuations).toEqual(
        expect.arrayContaining([expect.objectContaining({ availability: 'not_calculated' })])
      );
      expect(syntheticPage.props).toMatchObject({
        detail: { trade: { tradeId: syntheticTradeId } },
        statlyValues: {
          atTrade: { availability: 'not_calculated' },
          current: { availability: 'not_calculated' },
        },
      });
      expect(exported.rows.length).toBeGreaterThan(0);
      expect(archiveSelection.selection).toMatchObject({
        releaseId: factual.releaseId,
        publicArchiveId: factual.publicArchiveId,
      });
      expect(replacement.synthetic.assessmentVerification.output.content.source.archiveId).toBe(
        archiveSelection.selection?.publicArchiveId
      );
      expect(
        new Set([
          directList.consistency.publication?.publicationId,
          mixedList.consistency.publication?.publicationId,
          directDetail.consistency.publication?.publicationId,
          syntheticDetail.consistency.publication?.publicationId,
          listBody.data.consistency.publication?.publicationId,
          detailBody.data.consistency.publication?.publicationId,
          methodologyBody.data.consistency.publication?.publicationId,
          page.props.valueAnalysis.consistency.publication?.publicationId,
          exported.metadata.publicationId,
        ])
      ).toEqual(new Set([lifecycle.replacementPublicationId]));
      expect(
        new Set([
          directList.consistency.projectionBuildId,
          mixedList.consistency.projectionBuildId,
          directDetail.consistency.projectionBuildId,
          syntheticDetail.consistency.projectionBuildId,
          listBody.data.consistency.projectionBuildId,
          detailBody.data.consistency.projectionBuildId,
          methodologyBody.data.consistency.projectionBuildId,
          page.props.valueAnalysis.consistency.projectionBuildId,
          exported.metadata.projectionBuildId,
        ])
      ).toEqual(new Set([lifecycle.replacementProjectionId]));

      return {
        publicationRepository: surfacePublicationRepository,
        gateRepository: surfaceGateRepository,
        valueReadService,
        snapshot: {
          archiveDetail,
          directList,
          mixedList,
          directDetail,
          syntheticDetail,
          listApi: {
            status: listResponse.status,
            success: listBody.success,
            data: listBody.data,
          },
          detailApi: {
            status: detailResponse.status,
            success: detailBody.success,
            data: detailBody.data,
          },
          syntheticDetailApi: {
            status: syntheticDetailResponse.status,
            success: syntheticDetailBody.success,
            data: syntheticDetailBody.data,
          },
          methodologyApi: {
            status: methodologyResponse.status,
            success: methodologyBody.success,
            data: methodologyBody.data,
          },
          archiveListApi: {
            status: archiveListResponse.status,
            success: archiveListBody.success,
            data: archiveListBody.data,
          },
          archiveListCsv,
          archiveDetailCsv,
          archiveSelection,
          page: page.props,
          syntheticPage: syntheticPage.props,
          exported,
          factualState,
          publicationRegistry: await surfacePublicationRepository.load(),
          gateLedger: await surfaceGateRepository.load(),
        },
      };
    }

    const beforeRestore = await readSurfaceSnapshot(client);
    runPostgresTool('pg_dump', [
      '--username',
      'statly_test',
      '--dbname',
      'statly_outcomes_test',
      '--format=custom',
      `--file=${archivePath}`,
      `--schema=${schemaName}`,
      '--no-owner',
      '--no-privileges',
    ]);
    await currentOutcomesPool().end();
    outcomesPool = undefined;
    publicRuntime.archiveReadRepository = null;
    publicRuntime.valueReadService = null;
    publicRuntime.methodologyReadService = null;
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    const destroyed = await adminPool.query<{ absent: boolean }>(
      `SELECT to_regnamespace($1) IS NULL AS absent`,
      [schemaName]
    );
    expect(destroyed.rows[0]?.absent).toBe(true);
    runPostgresTool('pg_restore', [
      '--username',
      'statly_test',
      '--dbname',
      'statly_outcomes_test',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      archivePath,
    ]);
    outcomesPool = createOutcomesPool();
    client = createPgAflOutcomeSqlClient(currentOutcomesPool());
    publicProjectionRepository = localArtifactRepository(
      'public_projection',
      'local-synthetic-valuation-public'
    );
    const afterRestore = await readSurfaceSnapshot(client);
    expect(afterRestore.snapshot).toEqual(beforeRestore.snapshot);

    const restoredPublicationCommand = createPostgresAflTradeValuationPublicationCommandService({
      client,
      publicationRepository: afterRestore.publicationRepository,
      gateRepository: afterRestore.gateRepository,
      environment: 'test_fixture',
      artifactRepository: publicProjectionRepository,
    });
    await restoredPublicationCommand.disposition({
      action: 'withdraw',
      publicationId: lifecycle.replacementPublicationId,
      actor: 'local-synthetic-valuation-rehearsal',
      evidenceId: `artifact:${'c'.repeat(64)}`,
      reason: 'Verify no-fallback withdrawal without changing the factual release.',
    });
    const unavailable = await afterRestore.valueReadService.list(listRequest);
    expect(unavailable.consistency.selection).toBe('none');
    expect(unavailable.items[0]?.valuation.availability).toBe('not_calculated');
    const restoredFactualRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
    const restoredFactualRegistry = await restoredFactualRepository.loadRegistry();
    expect({
      active:
        restoredFactualRegistry.activeByScope[factual.factualReleaseManifest.content.scopeKey] ??
        null,
      release: restoredFactualRegistry.releases[factual.releaseId] ?? null,
    }).toEqual(lifecycle.factualStateBefore);
  }, 180_000);
});
