import { execFileSync } from 'node:child_process';
import type { ReactElement } from 'react';

import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { publicRuntime } = vi.hoisted(() => ({
  publicRuntime: {
    outcomeReadService: null as { list(request: unknown): Promise<unknown> } | null,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: async () => {
    if (publicRuntime.outcomeReadService === null) {
      throw new Error('The restored local factual-release read service has not been installed.');
    }
    return { outcomeReadService: publicRuntime.outcomeReadService };
  },
}));

import AflDraftTradeOutcomesPage from '../../src/app/(public)/draft/outcomes/page';
import { GET as getOutcomes } from '../../src/app/api/draft-trades/outcomes/route';
import {
  createLocalAflTradeFactualReleaseExportBytes,
  runLocalAflTradeFactualReleaseRehearsal,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualReleaseRehearsal';
import { doesAflTradeArtifactRefMatchBytes } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { aflTradeFactualReleaseCandidateSchema } from '@/server/aflTradeIntelligence/outcomes/factualReleaseCandidateContracts';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeFactualReleaseCandidateWriter } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReleaseCandidateRepository';
import { createPostgresAflDraftTradeOutcomeReadService } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeProjectionReadRepository';
import { createPostgresAflDraftTradeOutcomeReleaseRepository } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { extractAflTradeWorkbookOoxmlEvidence } from '@/server/aflTradeIntelligence/source/workbookOoxmlEvidence';
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

const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const archivePath = `/tmp/${schemaName}.dump`;
const adminPool = new Pool({ connectionString: databaseUrl });
let outcomesPool: Pool | undefined;

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

async function readReleaseSurfaceSnapshot(): Promise<unknown> {
  const pool = currentOutcomesPool();
  const client = createPgAflOutcomeSqlClient(pool);
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const sourceRightsDecisionLedger = (await gateRepository.load()).ledger;
  const releaseRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
  const authenticatedRegistry = await releaseRepository.loadRegistry();
  const authenticatedSelection = await releaseRepository.captureSelection(
    AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    {
      evaluatedAt: '2026-08-12T00:10:00.000Z',
      sourceRightsDecisionLedger,
    }
  );
  const outcomeReadService = createPostgresAflDraftTradeOutcomeReadService({
    client,
    cursorSecret: Buffer.from('local-fitzroy-factual-restore-cursor-secret'),
    expectedEnvironment: 'non_production',
    loadSourceRightsDecisionLedger: async () => sourceRightsDecisionLedger,
    now: () => '2026-08-12T00:10:00.000Z',
  });
  publicRuntime.outcomeReadService = outcomeReadService;
  const query = {
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    year: 2026,
    club: '',
    q: '',
    metric: null,
    status: null,
    limit: 25,
    cursor: null,
  } as const;
  const direct = await outcomeReadService.list(query);
  const apiResponse = await getOutcomes(
    new NextRequest('http://localhost/api/draft-trades/outcomes?year=2026&limit=25')
  );
  const apiBody = await apiResponse.json();
  const page = (await AflDraftTradeOutcomesPage({
    searchParams: Promise.resolve({ year: '2026' }),
  })) as ReactElement<{ response: typeof direct }>;
  const registry = await pool.query<
    Record<string, unknown> & { action: string; release_id: string; revision: number }
  >(`SELECT * FROM outcome_registry_event ORDER BY revision`);
  const active = await pool.query<
    Record<string, unknown> & { release_id: string; revision: number }
  >(`SELECT * FROM outcome_active_release WHERE scope_key=$1`, [
    AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  ]);
  const candidates = await pool.query<
    Record<string, unknown> & {
      candidate_id: string;
      candidate_json: unknown;
      candidate_sha256: string;
    }
  >(
    `SELECT *
       FROM outcome_factual_release_candidate
      ORDER BY candidate_id`
  );
  const projectionResult = await pool.query<{
    manifest_json: {
      content: {
        exportArtifacts: Record<string, Parameters<typeof doesAflTradeArtifactRefMatchBytes>[0]>;
        releaseId: string;
      };
      projectionId: string;
    };
  }>(
    `SELECT manifest_json
       FROM outcome_projection_manifest
      WHERE release_id=$1`,
    [active.rows[0]?.release_id]
  );
  const projection = projectionResult.rows[0]?.manifest_json;
  if (projection === undefined || active.rows[0] === undefined) {
    throw new Error('The restored factual release did not retain its active projection.');
  }
  const candidateWriter = new PostgresAflTradeFactualReleaseCandidateWriter(client);
  const candidateAuthentication = await Promise.all(
    candidates.rows.map(async (row) => {
      const candidate = aflTradeFactualReleaseCandidateSchema.parse({
        candidateId: row.candidate_id,
        candidateSha256: row.candidate_sha256,
        content: row.candidate_json,
      });
      return candidateWriter.persistCandidate(candidate);
    })
  );
  const exportBytes = createLocalAflTradeFactualReleaseExportBytes({
    releaseId: active.rows[0].release_id,
    publicItems: direct.items,
  });
  const xlsx = extractAflTradeWorkbookOoxmlEvidence(exportBytes.xlsx);
  const resolvedReleaseIds = [
    authenticatedSelection.selection?.release.releaseId,
    active.rows[0].release_id,
    direct.consistency.release?.releaseId,
    apiBody.data.consistency.release?.releaseId,
    page.props.response.consistency.release?.releaseId,
    projection.content.releaseId,
    xlsx.sheets[0]?.rows[0]?.cells[1]?.inlineText,
  ];
  const resolvedProjectionIds = [
    authenticatedSelection.selection?.release.projectionId,
    direct.consistency.release?.projectionId,
    apiBody.data.consistency.release?.projectionId,
    page.props.response.consistency.release?.projectionId,
    projection.projectionId,
  ];
  expect(authenticatedRegistry.revision).toBe(15);
  expect(authenticatedSelection.registryRevision).toBe(15);
  expect(active.rows[0].revision).toBe(15);
  expect(candidateAuthentication).toEqual([
    expect.objectContaining({ idempotentReplay: true }),
    expect.objectContaining({ idempotentReplay: true }),
  ]);
  expect(new Set(resolvedReleaseIds)).toEqual(
    new Set([authenticatedSelection.selection?.release.releaseId])
  );
  expect(new Set(resolvedProjectionIds)).toEqual(
    new Set([authenticatedSelection.selection?.release.projectionId])
  );

  return {
    active: active.rows,
    authenticatedRegistry,
    authenticatedSelection,
    api: { data: apiBody.data, status: apiResponse.status, success: apiBody.success },
    candidateAuthentication,
    candidates: candidates.rows,
    direct,
    exportAuthentication: {
      csv: doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.csv,
        exportBytes.csv,
        'text/csv'
      ),
      json: doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.json,
        exportBytes.json,
        'application/json'
      ),
      xlsx: doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.xlsx,
        exportBytes.xlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ),
      xlsxReleaseId: xlsx.sheets[0]?.rows[0]?.cells[1]?.inlineText,
    },
    exportBytes: {
      csv: Buffer.from(exportBytes.csv),
      json: Buffer.from(exportBytes.json),
      xlsx: Buffer.from(exportBytes.xlsx),
    },
    page: page.props.response,
    projection,
    registry: registry.rows,
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  outcomesPool = createOutcomesPool();
});

afterAll(async () => {
  publicRuntime.outcomeReadService = null;
  await outcomesPool?.end();
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('local fitzRoy factual-release backup and restore', () => {
  it('restores the exact release authority and every local public surface after schema destruction', async () => {
    await runLocalAflTradeFactualReleaseRehearsal(
      createPgAflOutcomeSqlClient(currentOutcomesPool())
    );
    const before = await readReleaseSurfaceSnapshot();
    expect(before).toMatchObject({
      active: [expect.objectContaining({ revision: 15 })],
      exportAuthentication: { csv: true, json: true, xlsx: true },
      registry: [
        expect.objectContaining({ action: 'register', revision: 1 }),
        ...Array.from({ length: 13 }, () => expect.anything()),
        expect.objectContaining({ action: 'activate', revision: 15 }),
      ],
    });

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
    publicRuntime.outcomeReadService = null;
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

    const after = await readReleaseSurfaceSnapshot();
    expect(after).toEqual(before);
  }, 60_000);
});
