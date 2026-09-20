import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  createAflTradeHpnFieldMapCandidate,
  listAflTradeHpnCandidateSourceFields,
} from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { assessAflTradeHpnSourceFirstCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
afterAll(async () => admin.end());

it.each([
  { year: 2018, scope: 'cameron-2018-private-pilot', expected: true },
  { year: 2020, scope: 'cameron-2020-private-pilot', expected: true },
  { year: 2021, scope: 'cameron-2021-private-pilot', expected: true },
  { year: 2022, scope: 'cameron-2022-private-pilot', expected: true },
  { year: 2023, scope: 'cameron-2023-private-pilot', expected: true },
  { year: 2021, scope: 'cameron-2020-private-pilot', expected: false },
  { year: 2019, scope: 'cameron-2019-private-pilot', expected: false },
  { year: 2024, scope: 'cameron-2024-private-pilot', expected: false },
])(
  'authenticates only the exact Cameron statistical season: $year / $scope',
  async ({ year, scope, expected }) => {
    const schema = `afl_cameron_scope_${process.pid}_${year}_${expected ? 'permitted' : 'rejected'}`;
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('schema', schema);
    const pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
      max: 3,
    });
    const client = createPgAflOutcomeSqlClient(pool);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    try {
      runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
      await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_governance_registry_writer') THEN
        CREATE ROLE afl_trade_nonproduction_governance_registry_writer NOLOGIN;
      END IF;
    END $$`);
      await admin.query(
        `GRANT USAGE ON SCHEMA "${schema}" TO afl_trade_nonproduction_governance_registry_writer`
      );
      await admin.query(`GRANT SELECT ON "${schema}".outcome_review_decision,
      "${schema}".outcome_governed_evidence_reference TO afl_trade_nonproduction_governance_registry_writer`);

      const options = { profile: 'completed_match_result' as const, seasonYear: year };
      const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
      const authority = fixture.command.capture;
      const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
      await ledger.appendBatch({
        expectedRevision: (await ledger.load()).revision,
        records: [
          {
            sourceRights: authority.sourceRights,
            proposal: authority.ledger.proposals[0]!,
            decision: authority.ledger.decisions[0]!,
          },
        ],
      });
      const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
      const normalization = (
        await client.query<{ finalized_at: Date; staging_sha256: string }>(
          'SELECT finalized_at,staging_sha256 FROM outcome_provider_normalization_run WHERE normalization_run_id=$1',
          [staged.staging.normalization.normalizationRunId]
        )
      ).rows[0]!;
      const at = (
        await client.query<{ at: string }>(
          `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
        )
      ).rows[0]!.at;
      const map = fixture.command.fieldMap;
      const mapArtifact = createAflTradeCanonicalJsonArtifactRef(map, map.approvedAt);
      const candidate = createAflTradeHpnFieldMapCandidate({
        environment: 'non_production',
        competition: 'AFLM',
        provider: 'footywire',
        capabilityId: map.capabilityId,
        sourceSchemaSha256: map.sourceSchemaSha256,
        inputKind: 'completed_match_result',
        validFromSeason: year,
        validThroughSeason: year,
        providerDecodeMap: map,
        providerDecodeMapArtifact: mapArtifact,
        createdAt: at,
        semanticBindings: [
          { semanticField: 'match', mapping: { kind: 'direct', sourceField: 'match_id' } },
          { semanticField: 'homeClub', mapping: { kind: 'direct', sourceField: 'home' } },
          { semanticField: 'awayClub', mapping: { kind: 'direct', sourceField: 'away' } },
          { semanticField: 'homePoints', mapping: { kind: 'direct', sourceField: 'home_points' } },
          { semanticField: 'awayPoints', mapping: { kind: 'direct', sourceField: 'away_points' } },
          { semanticField: 'completionStatus', mapping: { kind: 'direct', sourceField: 'status' } },
        ],
        completionRule: { kind: 'source_status', completedValues: ['Final'] },
      });
      const assessment = assessAflTradeHpnSourceFirstCalculationSourceUse({
        rights: authority.sourceRights,
        rightsArtifact: createAflTradeCanonicalJsonArtifactRef(
          authority.sourceRights,
          authority.sourceRights.content.proposedAt
        ),
        competition: 'AFLM',
        seasonYear: year,
        valuationScopeKey: scope,
        evaluatedAt: at,
        sourceFields: candidate.content.semanticBindings.flatMap(
          listAflTradeHpnCandidateSourceFields
        ),
        source: {
          captureId: staged.staging.capture.captureId,
          sourceSnapshotId: staged.snapshotId,
          sourceArtifact: staged.receipt.content.sourceCustody.artifact,
          normalizationRunId: staged.staging.normalization.normalizationRunId,
          normalizationFinalizationSha256: sha256AflTradeCanonicalJson({
            normalizationRunId: staged.staging.normalization.normalizationRunId,
            stagingSha256: normalization.staging_sha256,
            finalizedAt: normalization.finalized_at.toISOString(),
          }),
          providerDecodeMapId: map.mapId,
          providerDecodeMapSha256: mapArtifact.contentSha256,
          sourceSchemaSha256: map.sourceSchemaSha256,
          gateDecisionId: fixture.gateDecisionId,
          gateProposalId: authority.ledger.proposals[0]!.proposalId,
          gateDecisionKey: authority.ledger.decisions[0]!.content.decisionKey,
        },
      });
      const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, at);
      const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(assessment, at);
      const decision = createAflTradeHpnFieldMapReviewDecision({
        candidate,
        candidateArtifact,
        sourceUseAssessment: assessment,
        sourceUseAssessmentArtifact: assessmentArtifact,
        decision: 'approved',
        reviewerId: 'synthetic-scope-reviewer',
        rationale: 'Synthetic scope boundary regression.',
        decidedAt: at,
      });
      const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(decision, at);
      const projected = createAflTradeHpnProjectedFieldMap({
        candidate,
        candidateArtifact,
        decision,
        decisionArtifact,
      });
      await new PostgresAflTradeHpnProjectedFieldMapAuthority(client).registerApprovedProjection({
        candidate,
        candidateArtifact,
        sourceUseAssessment: assessment,
        sourceUseAssessmentArtifact: assessmentArtifact,
        reviewDecision: decision,
        decisionArtifact,
        projectedFieldMap: projected,
      });
      const exact = async (captureId: string, runId: string) =>
        client.transaction(async (transaction) => {
          await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
          const result = await transaction.query<{ exact: boolean }>(
            'SELECT outcome_hpn_statistical_source_map_is_exact($1,$2,$3) AS exact',
            [projected.fieldMapId, captureId, runId]
          );
          return result.rows[0]!.exact;
        });
      const captureId = staged.staging.capture.captureId;
      const runId = staged.staging.normalization.normalizationRunId;
      expect(await exact(captureId, runId)).toBe(expected);
      if (expected) {
        expect(await exact(`source-capture:${'e'.repeat(64)}`, runId)).toBe(false);
        expect(await exact(captureId, `provider-normalization-run:${'f'.repeat(64)}`)).toBe(false);
      }
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }
);
