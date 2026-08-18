import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { PostgresAflTradePreparedValuationInputSetStore } from '@/server/aflTradeIntelligence/valuation/postgresPreparedValuationInputSetStore';
import { PostgresAflTradeValuationSourceQualification } from '@/server/aflTradeIntelligence/valuation/postgresValuationSourceQualification';
import { PostgresAflTradeValuationSourceQualificationReportStore } from '@/server/aflTradeIntelligence/valuation/postgresValuationSourceQualificationReportStore';
import {
  AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
  createAflTradePreparedValuationInputSet,
} from '@/server/aflTradeIntelligence/valuation/preparedValuationInputSet';
import { createAflTradeValuationSourceQualificationReport } from '@/server/aflTradeIntelligence/valuation/valuationSourceQualificationReport';
import { AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/valuation/valuationSourceQualificationReport';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_prepared_inputs_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 256,
    createdAt: '2026-08-15T01:00:00.000Z',
  };
}

const canonicalMembers = [
  {
    recordKind: 'transaction',
    canonicalRecordId: 'trade-a',
    canonicalRecordSha256: digest('a'),
    ordinal: 1,
  },
  {
    recordKind: 'transaction',
    canonicalRecordId: 'trade-b',
    canonicalRecordSha256: digest('b'),
    ordinal: 2,
  },
];
const sourceRights = [
  createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights,
  createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.sourceRights,
];
const releaseManifest = {
  releaseId: `outcome-release:${digest('1')}`,
  content: {
    canonicalMembers,
    sourceCaptures: sourceRights.map((rights, index) => ({
      captureId: `capture-${index + 1}`,
      rightsArtifactId: rights.rightsArtifactId,
    })),
  },
};
const qualificationBlockers = sourceRights
  .map((rights) => ({
    code: 'source_blocked' as const,
    subject: { kind: 'source' as const, id: rights.content.registerId },
    evidenceRefs: [createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt)],
  }))
  .sort((left, right) => left.subject.id.localeCompare(right.subject.id));
const qualificationReport = createAflTradeValuationSourceQualificationReport({
  schemaVersion: AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION,
  environment: 'non_production',
  operation: 'valuation_model_training_and_derived_feature_creation',
  valuationScopeKey: 'afl-men:2025-trades',
  factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
  factualReleaseId: releaseManifest.releaseId,
  factualReleaseArtifact: createAflTradeCanonicalJsonArtifactRef(
    releaseManifest,
    '2026-08-15T00:00:00.000Z'
  ),
  releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
    canonicalMembers,
    '2026-08-15T00:00:00.000Z'
  ),
  releaseTradeIds: ['trade-a', 'trade-b'],
  sourceRightsEvidenceRefs: sourceRights
    .map((rights) => createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  decision: { state: 'blocked', blockers: qualificationBlockers },
  evaluatedAt: '2026-08-15T02:00:00.000Z',
  publicationEligible: false,
  limitation:
    'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.',
});

function preparedSet(
  releaseTradeIds: readonly string[] = ['trade-a', 'trade-b'],
  factualReleaseArtifact = createAflTradeCanonicalJsonArtifactRef(
    releaseManifest,
    '2026-08-15T00:00:00.000Z'
  ),
  blockerRights: readonly (typeof sourceRights)[number][] = sourceRights,
  qualificationEvidenceRights: readonly (typeof sourceRights)[number][] = sourceRights
) {
  const blockers = blockerRights
    .map((rights) => ({
      code: 'source_blocked' as const,
      subject: { kind: 'source' as const, id: rights.content.registerId },
      evidenceRefs: [createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt)],
    }))
    .sort((left, right) => left.subject.id.localeCompare(right.subject.id));
  const entries = releaseTradeIds.map((tradeId) => ({
    tradeId,
    state: 'blocked' as const,
    blockers,
  }));
  return createAflTradePreparedValuationInputSet({
    schemaVersion: AFL_TRADE_PREPARED_VALUATION_INPUT_SET_SCHEMA_VERSION,
    environment: 'non_production',
    scopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId: `outcome-release:${digest('1')}`,
    factualReleaseArtifact,
    releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
      canonicalMembers,
      '2026-08-15T00:00:00.000Z'
    ),
    preparationAuthority: 'source_policy_preflight_only',
    qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
    qualificationReportId: qualificationReport.qualificationReportId,
    qualificationReportArtifact: createAflTradeCanonicalJsonArtifactRef(
      qualificationReport,
      qualificationReport.content.evaluatedAt
    ),
    sourceQualificationEvidenceRefs: qualificationEvidenceRights
      .map((rights) => createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    releaseTradeIds: [...releaseTradeIds],
    entries,
    tradeCount: entries.length,
    readyCount: 0,
    blockedCount: entries.length,
    preparedAt: '2026-08-15T02:00:00.000Z',
    publicationEligible: false,
    limitation:
      'Private preparation evidence only; not a valuation result, publication approval, or activation authority.',
  });
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    `INSERT INTO outcome_release_manifest
       (release_id,scope_key,environment,created_at,effective_through,manifest_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      `outcome-release:${digest('1')}`,
      'public-afl-draft-trade-outcomes',
      'non_production',
      '2026-08-15T00:00:00.000Z',
      '2026-08-14T23:59:59.000Z',
      canonicalizeAflTradeJson(releaseManifest),
    ]
  );
  for (const rights of sourceRights) {
    const capabilityId =
      rights.content.acquisition.kind === 'fitzroy'
        ? rights.content.acquisition.capabilities[0]!.capabilityId
        : null;
    await pool.query(
      `INSERT INTO outcome_source_rights_proposal
        (rights_artifact_id,provider,dataset,dataset_version,capability_id,proposed_at,content_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        rights.rightsArtifactId,
        rights.content.provider,
        rights.content.dataset,
        rights.content.datasetVersion,
        capabilityId,
        rights.content.proposedAt,
        canonicalizeAflTradeJson(rights),
      ]
    );
  }
  await new PostgresAflTradeValuationSourceQualificationReportStore(
    createPgAflOutcomeSqlClient(pool)
  ).register(qualificationReport);
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL prepared valuation input-set store', () => {
  it('derives and persists the complete operation-specific blocker set from one exact release', async () => {
    const client = createPgAflOutcomeSqlClient(pool);
    const qualification = new PostgresAflTradeValuationSourceQualification(client);

    const result = await qualification.prepare({
      factualReleaseId: releaseManifest.releaseId,
      valuationScopeKey: 'afl-men:2025-trades',
    });

    expect(result).toMatchObject({
      state: 'blocked',
      qualificationReport: {
        content: {
          operation: 'valuation_model_training_and_derived_feature_creation',
          valuationScopeKey: 'afl-men:2025-trades',
          factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
          releaseTradeIds: ['trade-a', 'trade-b'],
          decision: { state: 'blocked' },
        },
      },
      preparedInputSet: {
        content: {
          scopeKey: 'afl-men:2025-trades',
          factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
          qualificationOperation: 'valuation_model_training_and_derived_feature_creation',
          releaseTradeIds: ['trade-a', 'trade-b'],
          tradeCount: 2,
          readyCount: 0,
          blockedCount: 2,
        },
      },
    });
    if (result.state !== 'blocked') throw new Error('Expected source qualification to block.');
    const retainedReport = await pool.query<{ report_json: unknown }>(
      `SELECT report_json FROM outcome_valuation_source_qualification_report
        WHERE qualification_report_id=$1`,
      [result.qualificationReport.qualificationReportId]
    );
    expect(retainedReport.rows).toEqual([{ report_json: result.qualificationReport }]);
    await expect(
      new PostgresAflTradePreparedValuationInputSetStore(client).loadExact(
        result.preparedInputSet.preparedInputSetId
      )
    ).resolves.toEqual(result.preparedInputSet);

    const falseEligible = createAflTradeValuationSourceQualificationReport({
      ...result.qualificationReport.content,
      decision: { state: 'eligible_for_dataset_admission' },
    });
    await expect(
      new PostgresAflTradeValuationSourceQualificationReportStore(client).register(falseEligible)
    ).rejects.toThrow(/identity, policy, or factual ancestry mismatch/i);
  });

  it('atomically persists and exactly replays one complete classified release', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );
    const expected = preparedSet();

    await expect(
      Promise.all([store.register(expected), store.register(expected)])
    ).resolves.toEqual([expected, expected]);
    await expect(store.loadExact(expected.preparedInputSetId)).resolves.toEqual(expected);
    await expect(
      store.loadTrade({ preparedInputSetId: expected.preparedInputSetId, tradeId: 'trade-a' })
    ).resolves.toMatchObject({ state: 'blocked', tradeId: 'trade-a' });
    await expect(
      store.loadTrade({ preparedInputSetId: expected.preparedInputSetId, tradeId: 'trade-b' })
    ).resolves.toEqual(expected.content.entries[1]);
    await expect(
      store.loadTrade({ preparedInputSetId: expected.preparedInputSetId, tradeId: 'not-a-member' })
    ).resolves.toBeNull();

    const row = await pool.query<{ prepared_input_set_id: string }>(
      `SELECT prepared_input_set_id FROM outcome_prepared_valuation_input_set
        WHERE prepared_input_set_id=$1`,
      [expected.preparedInputSetId]
    );
    expect(row.rows).toEqual([{ prepared_input_set_id: expected.preparedInputSetId }]);
    await expect(
      pool.query(
        `UPDATE outcome_prepared_valuation_input_entry SET trade_id='tampered'
          WHERE prepared_input_set_id=$1 AND trade_id='trade-b'`,
        [expected.preparedInputSetId]
      )
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects a self-consistent subset that omits an authoritative release transaction', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(store.register(preparedSet(['trade-a']))).rejects.toThrow(
      /identity or factual ancestry mismatch/i
    );
  });

  it('rejects a prepared set whose release artifact digest is not the registered manifest', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(store.register(preparedSet(undefined, artifact('c')))).rejects.toThrow(
      /identity or factual ancestry mismatch/i
    );
  });

  it('rejects false metadata attached to the correct registered release digest', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );
    const exact = createAflTradeCanonicalJsonArtifactRef(
      releaseManifest,
      '2026-08-15T00:00:00.000Z'
    );

    await expect(
      store.register(preparedSet(undefined, { ...exact, mediaType: 'text/plain' }))
    ).rejects.toThrow(/identity or factual ancestry mismatch/i);
  });

  it('rejects a blocker subset that disagrees with the exact qualification decision', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      store.register(preparedSet(undefined, undefined, sourceRights.slice(0, 1)))
    ).rejects.toThrow(/identity or factual ancestry mismatch/i);
  });

  it('rejects qualification evidence that omits a source-rights ancestor of the exact release', async () => {
    const store = new PostgresAflTradePreparedValuationInputSetStore(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      store.register(
        preparedSet(undefined, undefined, sourceRights.slice(0, 1), sourceRights.slice(0, 1))
      )
    ).rejects.toThrow(/identity or factual ancestry mismatch/i);
  });

  it('uses a content-addressed prepared-set identity', () => {
    const expected = preparedSet();
    expect(expected.preparedInputSetId).toBe(
      createAflTradeContentAddress('prepared-valuation-input-set', expected.content)
    );
  });
});
