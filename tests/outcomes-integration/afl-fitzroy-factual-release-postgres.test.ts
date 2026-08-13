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
      throw new Error('The local factual-release read service has not been installed.');
    }
    return { outcomeReadService: publicRuntime.outcomeReadService };
  },
}));

import AflDraftTradeOutcomesPage from '../../src/app/(public)/draft/outcomes/page';
import { GET as getOutcomes } from '../../src/app/api/draft-trades/outcomes/route';
import { runLocalAflTradeFactualReleaseRehearsal } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualReleaseRehearsal';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { doesAflTradeArtifactRefMatchBytes } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflDraftTradeOutcomeReadService } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeProjectionReadRepository';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { createLocalAflTradeFactualReleaseExportBytes } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualReleaseRehearsal';
import { extractAflTradeWorkbookOoxmlEvidence } from '@/server/aflTradeIntelligence/source/workbookOoxmlEvidence';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
});

afterAll(async () => {
  publicRuntime.outcomeReadService = null;
  await outcomesPool.end();
  try {
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('local fitzRoy factual-release lifecycle', () => {
  it('serves one active replacement release through the service, API, projection exports, and archive page', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const rehearsal = await runLocalAflTradeFactualReleaseRehearsal(client);

    expect(rehearsal.baseline.releaseId).not.toBe(rehearsal.replacement.releaseId);
    expect(rehearsal.activeSelection).toMatchObject({
      releaseId: rehearsal.replacement.releaseId,
      projectionId: rehearsal.replacement.projectionId,
    });
    expect(rehearsal).toHaveProperty('rollbackSelection', rehearsal.baseline);
    expect(rehearsal).toHaveProperty('withdrawalSelection', null);
    expect(rehearsal).toHaveProperty('recoverySelection', rehearsal.replacement);

    const lifecycleEvents = await outcomesPool.query<{
      action: string;
      release_id: string;
      event_json: {
        content: { priorActiveReleaseId: string | null; nextActiveReleaseId: string | null };
      };
    }>(
      `SELECT action,release_id,event_json
         FROM outcome_registry_event
        ORDER BY revision`
    );
    expect(lifecycleEvents.rows.map(({ action }) => action)).toEqual([
      'register',
      'validate',
      'approve',
      'activate',
      'register',
      'validate',
      'approve',
      'activate',
      'validate',
      'approve',
      'activate',
      'withdraw',
      'validate',
      'approve',
      'activate',
    ]);
    const rollbackEvent = lifecycleEvents.rows[10];
    expect(rollbackEvent).toMatchObject({
      release_id: rehearsal.baseline.releaseId,
      event_json: {
        content: {
          priorActiveReleaseId: rehearsal.replacement.releaseId,
          nextActiveReleaseId: rehearsal.baseline.releaseId,
        },
      },
    });
    const withdrawalEvent = lifecycleEvents.rows[11];
    expect(withdrawalEvent).toMatchObject({
      action: 'withdraw',
      release_id: rehearsal.baseline.releaseId,
      event_json: {
        content: {
          priorActiveReleaseId: rehearsal.baseline.releaseId,
          nextActiveReleaseId: null,
        },
      },
    });
    const recoveryEvent = lifecycleEvents.rows[14];
    expect(recoveryEvent).toMatchObject({
      release_id: rehearsal.replacement.releaseId,
      event_json: {
        content: {
          priorActiveReleaseId: null,
          nextActiveReleaseId: rehearsal.replacement.releaseId,
        },
      },
    });
    await expect(
      outcomesPool.query(
        `INSERT INTO outcome_record_state_commitment
          (event_revision,release_id,record_state_id,record_state_json)
         VALUES (15,$1,$2,$3::jsonb)`,
        [
          rehearsal.baseline.releaseId,
          `outcome-release-record-state:${'a'.repeat(64)}`,
          JSON.stringify({ unexpected: true }),
        ]
      )
    ).rejects.toThrow(/exact affected release state declared by its registry event/i);

    const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const outcomeReadService = createPostgresAflDraftTradeOutcomeReadService({
      client,
      cursorSecret: Buffer.from('local-fitzroy-factual-release-cursor-secret'),
      expectedEnvironment: 'non_production',
      loadSourceRightsDecisionLedger: async () => (await gateRepository.load()).ledger,
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
    const storedProjection = await outcomesPool.query<{ manifest_json: any }>(
      `SELECT manifest_json FROM outcome_projection_manifest WHERE projection_id=$1`,
      [rehearsal.replacement.projectionId]
    );
    const projection = storedProjection.rows[0]?.manifest_json;

    expect(apiResponse.status).toBe(200);
    expect(direct.items).toEqual([
      expect.objectContaining({
        year: 2026,
        player: expect.objectContaining({
          aflPlayerId: 'afl-player:local-rehearsal',
          displayName: 'Player One',
          identityStatus: 'resolved',
        }),
        checks: expect.arrayContaining([
          expect.objectContaining({ metric: 'games', observedValue: 1 }),
          expect.objectContaining({ metric: 'goals', observedValue: 2 }),
        ]),
      }),
    ]);
    const resolvedReleaseIds = [
      rehearsal.activeSelection.releaseId,
      direct.consistency.release?.releaseId,
      apiBody.data.consistency.release?.releaseId,
      page.props.response.consistency.release?.releaseId,
      projection?.content.releaseId,
    ];
    const resolvedProjectionIds = [
      rehearsal.activeSelection.projectionId,
      direct.consistency.release?.projectionId,
      apiBody.data.consistency.release?.projectionId,
      page.props.response.consistency.release?.projectionId,
      projection?.projectionId,
    ];
    expect(new Set(resolvedReleaseIds)).toEqual(new Set([rehearsal.replacement.releaseId]));
    expect(new Set(resolvedProjectionIds)).toEqual(new Set([rehearsal.replacement.projectionId]));
    expect(Object.keys(projection.content.viewArtifacts).sort()).toEqual([
      'club',
      'dashboard',
      'list',
      'player',
      'tradeDetail',
      'year',
    ]);
    expect(Object.keys(projection.content.exportArtifacts).sort()).toEqual(['csv', 'json', 'xlsx']);
    expect(Object.values(projection.content.exportArtifacts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: expect.stringMatching(/^artifact:/) }),
      ])
    );
    const exportBytes = createLocalAflTradeFactualReleaseExportBytes({
      releaseId: rehearsal.replacement.releaseId,
      publicItems: direct.items,
    });
    expect(
      doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.json,
        exportBytes.json,
        'application/json'
      )
    ).toBe(true);
    expect(
      doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.csv,
        exportBytes.csv,
        'text/csv'
      )
    ).toBe(true);
    expect(
      doesAflTradeArtifactRefMatchBytes(
        projection.content.exportArtifacts.xlsx,
        exportBytes.xlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    ).toBe(true);
    const jsonExport = JSON.parse(Buffer.from(exportBytes.json).toString('utf8'));
    const csvExport = Buffer.from(exportBytes.csv).toString('utf8');
    const xlsxExport = extractAflTradeWorkbookOoxmlEvidence(exportBytes.xlsx);
    expect(jsonExport.releaseId).toBe(rehearsal.replacement.releaseId);
    expect(csvExport).toContain(`releaseId,${rehearsal.replacement.releaseId}`);
    expect(
      xlsxExport.sheets[0]?.rows[0]?.cells.map(({ inlineText }) => inlineText)
    ).toEqual(['releaseId', rehearsal.replacement.releaseId]);
  });
});
