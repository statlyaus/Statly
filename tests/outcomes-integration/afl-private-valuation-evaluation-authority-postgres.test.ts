import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { inspectLocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationEvaluationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationEvaluationAuthority';
import { createAflTradePrivateValuationEvaluationDecision } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_private_valuation_authority_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const digest = (character: string) => character.repeat(64);
const releaseCreatedAt = '2026-08-16T00:00:00.000Z';
const factualReleaseId = `outcome-release:${digest('1')}`;
const sourceRights = [
  createLocalAflTradeOfficialAfl2026Authority().capture.sourceRights,
  createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.sourceRights,
];
const canonicalMembers = [
  {
    recordKind: 'transaction',
    canonicalRecordId: 'trade-a',
    canonicalRecordSha256: digest('a'),
    ordinal: 1,
  },
];
const releaseManifest = {
  releaseId: factualReleaseId,
  content: {
    canonicalMembers,
    sourceCaptures: sourceRights.map((rights, index) => ({
      captureId: `capture-${index + 1}`,
      rightsArtifactId: rights.rightsArtifactId,
    })),
  },
};

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    `INSERT INTO outcome_release_manifest
       (release_id,scope_key,environment,created_at,effective_through,manifest_json)
     VALUES ($1,$2,'non_production',$3,$3,$4::jsonb),
            ($5,$2,'production',$3,$3,$6::jsonb)`,
    [
      factualReleaseId,
      'public-afl-draft-trade-outcomes',
      releaseCreatedAt,
      canonicalizeAflTradeJson(releaseManifest),
      `outcome-release:${digest('9')}`,
      canonicalizeAflTradeJson({
        ...releaseManifest,
        releaseId: `outcome-release:${digest('9')}`,
      }),
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
  const activationFixtureConnection = await pool.connect();
  try {
    await activationFixtureConnection.query(`SET session_replication_role='replica'`);
    await activationFixtureConnection.query(
      `INSERT INTO outcome_active_release (scope_key,release_id,activated_at,revision)
       VALUES ('public-afl-draft-trade-outcomes',$1,$2,1)`,
      [factualReleaseId, releaseCreatedAt]
    );
  } finally {
    await activationFixtureConnection.query(`SET session_replication_role='origin'`);
    activationFixtureConnection.release();
  }
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL private valuation evaluation authority', () => {
  it('authorizes, exactly replays, and withdraws one private local decision chain', async () => {
    const authority = new PostgresAflTradePrivateValuationEvaluationAuthority(
      createPgAflOutcomeSqlClient(pool)
    );
    await expect(
      inspectLocalAflTradeValuationReadiness(pool, {
        scopeKey: 'afl-men:2025-trades',
      })
    ).resolves.toMatchObject({
      privateEvaluationAuthorityState: 'not_authorized',
      blockerCodes: ['source_qualification_not_run', 'private_evaluation_not_authorized'],
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
    });
    const authorized = await authority.recordDecision({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      factualReleaseId,
      expectedCurrentDecisionId: null,
      reviewerId: 'local-factual-release-owner',
      rationale:
        'Authorize exact retained evidence for private local non-production derived calculations.',
    });

    await expect(
      authority.assessCurrent({
        valuationScopeKey: 'afl-men:2025-trades',
        factualReleaseId,
      })
    ).resolves.toEqual({ state: 'authorized', decision: authorized });
    await expect(
      authority.admitCalculation({
        valuationScopeKey: 'afl-men:2025-trades',
        factualReleaseId,
      })
    ).resolves.toMatchObject({
      state: 'authorized',
      authority: {
        kind: 'private_nonproduction_derived_calculation',
        decisionId: authorized.decisionId,
        factualReleaseId,
        publicationEligible: false,
        publicationProhibited: true,
      },
    });
    await expect(
      inspectLocalAflTradeValuationReadiness(pool, {
        scopeKey: 'afl-men:2025-trades',
      })
    ).resolves.toMatchObject({
      privateEvaluationAuthorityState: 'authorized',
      privateEvaluationDecisionId: authorized.decisionId,
      blockerCodes: ['model_not_approved'],
      requiredNextAuthority: 'authenticated_private_calculation_inputs',
    });

    const withdrawn = await authority.recordDecision({
      status: 'withdrawn',
      valuationScopeKey: 'afl-men:2025-trades',
      factualReleaseId,
      expectedCurrentDecisionId: authorized.decisionId,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Withdraw private calculation authority and fail closed.',
    });

    expect(withdrawn.content).toMatchObject({
      status: 'withdrawn',
      revision: 2,
      supersedesDecisionId: authorized.decisionId,
      factualReleaseId,
    });
    await expect(
      authority.assessCurrent({
        valuationScopeKey: 'afl-men:2025-trades',
        factualReleaseId,
      })
    ).resolves.toEqual({ state: 'withdrawn', decision: withdrawn });
    await expect(
      authority.admitCalculation({
        valuationScopeKey: 'afl-men:2025-trades',
        factualReleaseId,
      })
    ).resolves.toEqual({
      state: 'blocked',
      reason: 'withdrawn',
      decisionId: withdrawn.decisionId,
    });
    await expect(
      inspectLocalAflTradeValuationReadiness(pool, {
        scopeKey: 'afl-men:2025-trades',
      })
    ).resolves.toMatchObject({
      privateEvaluationAuthorityState: 'withdrawn',
      privateEvaluationDecisionId: withdrawn.decisionId,
      blockerCodes: ['source_qualification_not_run', 'private_evaluation_withdrawn'],
      requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
    });
    await expect(
      pool.query(
        `UPDATE outcome_private_valuation_evaluation_decision
            SET reviewer_id='tampered' WHERE decision_id=$1`,
        [authorized.decisionId]
      )
    ).rejects.toThrow(/append-only/i);
  });

  it('allows exactly one first writer and rejects stale approval', async () => {
    const authority = new PostgresAflTradePrivateValuationEvaluationAuthority(
      createPgAflOutcomeSqlClient(pool)
    );
    const input = {
      status: 'authorized' as const,
      valuationScopeKey: 'afl-men:concurrent',
      factualReleaseId,
      expectedCurrentDecisionId: null,
      reviewerId: 'local-factual-release-owner',
      rationale: 'Concurrent first-writer authority test.',
    };
    const results = await Promise.allSettled([
      authority.recordDecision(input),
      authority.recordDecision(input),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(rejected?.reason).toMatchObject({ code: 'STALE_DECISION' });
  });

  it('rejects authority for a production release', async () => {
    const authority = new PostgresAflTradePrivateValuationEvaluationAuthority(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      authority.recordDecision({
        status: 'authorized',
        valuationScopeKey: 'afl-men:production',
        factualReleaseId: `outcome-release:${digest('9')}`,
        expectedCurrentDecisionId: null,
        reviewerId: 'local-factual-release-owner',
        rationale: 'This must fail closed.',
      })
    ).rejects.toMatchObject({ code: 'RELEASE_MISMATCH' });
  });

  it('rejects a content-addressed decision that grants model training', async () => {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const decidedAt = (
        await connection.query<{ decided_at: Date }>(
          `SELECT transaction_timestamp()::timestamptz(3) AS decided_at`
        )
      ).rows[0]!.decided_at.toISOString();
      const valid = createAflTradePrivateValuationEvaluationDecision({
        status: 'authorized',
        valuationScopeKey: 'afl-men:tampered',
        factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
        factualReleaseId,
        factualReleaseArtifact: createAflTradeCanonicalJsonArtifactRef(
          releaseManifest,
          releaseCreatedAt
        ),
        releaseMembershipArtifact: createAflTradeCanonicalJsonArtifactRef(
          canonicalMembers,
          releaseCreatedAt
        ),
        sourceRightsEvidenceRefs: sourceRights.map((rights) =>
          createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt)
        ),
        revision: 1,
        supersedesDecisionId: null,
        reviewerId: 'local-factual-release-owner',
        rationale: 'Tampered direct insert must fail.',
        decidedAt,
      });
      const content = {
        ...valid.content,
        permissions: { ...valid.content.permissions, modelTraining: true },
      };
      const decisionId = createAflTradeContentAddress(
        'private-valuation-evaluation-decision',
        content
      );
      await expect(
        connection.query(
          `INSERT INTO outcome_private_valuation_evaluation_decision
            (decision_id,valuation_scope_key,factual_release_scope_key,factual_release_id,status,
             revision,supersedes_decision_id,reviewer_id,decided_at,decision_sha256,
             decision_content_canonical_json,decision_json)
           VALUES ($1,$2,$3,$4,'authorized',1,NULL,$5,$6,$7,$8,$9::jsonb)`,
          [
            decisionId,
            content.valuationScopeKey,
            content.factualReleaseScopeKey,
            factualReleaseId,
            content.reviewerId,
            content.decidedAt,
            sha256AflTradeCanonicalJson(content),
            canonicalizeAflTradeJson(content),
            canonicalizeAflTradeJson({ decisionId, content }),
          ]
        )
      ).rejects.toThrow(/exact release and source authentication/i);
      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  });
});
