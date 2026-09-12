import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
const schemaName = `afl_source_field_order_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 4 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scoped.toString(),
  });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
});

// Full database guards with explicit synthetic upstream bytes/reviews. No historical
// corpus, validator replacement, real provider request, or scientific claim.
it('registers and reads a source-first map whose full field permissions use mixed-case locale order', async () => {
  const options = { profile: 'completed_match_result' as const, mixedCaseResultFields: true };
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
  const sourceAuthority = fixture.command.capture;
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: sourceAuthority.sourceRights,
        proposal: sourceAuthority.ledger.proposals[0]!,
        decision: sourceAuthority.ledger.decisions[0]!,
      },
    ],
  });
  const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
  const retained = await client.query<{ finalized_at: Date; staging_sha256: string }>(
    'SELECT finalized_at,staging_sha256 FROM outcome_provider_normalization_run WHERE normalization_run_id=$1',
    [staged.staging.normalization.normalizationRunId]
  );
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
    validFromSeason: 2026,
    validThroughSeason: 2026,
    providerDecodeMap: map,
    providerDecodeMapArtifact: mapArtifact,
    createdAt: at,
    semanticBindings: [
      { semanticField: 'match', mapping: { kind: 'direct', sourceField: 'match_id' } },
      { semanticField: 'homeClub', mapping: { kind: 'direct', sourceField: 'home' } },
      { semanticField: 'awayClub', mapping: { kind: 'direct', sourceField: 'away' } },
      { semanticField: 'homePoints', mapping: { kind: 'direct', sourceField: 'Match_id' } },
      { semanticField: 'awayPoints', mapping: { kind: 'direct', sourceField: 'MI5' } },
      { semanticField: 'completionStatus', mapping: { kind: 'direct', sourceField: 'status' } },
    ],
    completionRule: { kind: 'source_status', completedValues: ['Final'] },
  });
  const sourceUseAssessment = assessAflTradeHpnSourceFirstCalculationSourceUse({
    rights: sourceAuthority.sourceRights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(
      sourceAuthority.sourceRights,
      sourceAuthority.sourceRights.content.proposedAt
    ),
    competition: 'AFLM',
    seasonYear: 2026,
    valuationScopeKey: 'afl-men:2026-trades',
    evaluatedAt: at,
    sourceFields: candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields),
    source: {
      captureId: staged.staging.capture.captureId,
      sourceSnapshotId: staged.snapshotId,
      sourceArtifact: staged.receipt.content.sourceCustody.artifact,
      normalizationRunId: staged.staging.normalization.normalizationRunId,
      normalizationFinalizationSha256: sha256AflTradeCanonicalJson({
        normalizationRunId: staged.staging.normalization.normalizationRunId,
        stagingSha256: retained.rows[0]!.staging_sha256,
        finalizedAt: retained.rows[0]!.finalized_at.toISOString(),
      }),
      providerDecodeMapId: map.mapId,
      providerDecodeMapSha256: mapArtifact.contentSha256,
      sourceSchemaSha256: map.sourceSchemaSha256,
      gateDecisionId: fixture.gateDecisionId,
      gateProposalId: sourceAuthority.ledger.proposals[0]!.proposalId,
      gateDecisionKey: sourceAuthority.ledger.decisions[0]!.content.decisionKey,
    },
  });
  const assessedNames = sourceUseAssessment.content.fields.map((field) => field.sourceField);
  expect(assessedNames.indexOf('Match_id')).toBeLessThan(assessedNames.indexOf('MI5'));
  const assessmentBeforeRegistration = JSON.stringify(sourceUseAssessment);
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, at);
  const assessmentArtifact = createAflTradeCanonicalJsonArtifactRef(sourceUseAssessment, at);
  const decision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: assessmentArtifact,
    decision: 'approved',
    reviewerId: 'synthetic-result-reviewer',
    rationale: 'Synthetic current-source authority regression only.',
    decidedAt: at,
  });
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(decision, at);
  const projectedFieldMap = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision,
    decisionArtifact,
  });
  const repository = new PostgresAflTradeHpnProjectedFieldMapAuthority(client);
  await repository.registerApprovedProjection({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: assessmentArtifact,
    reviewDecision: decision,
    decisionArtifact,
    projectedFieldMap,
  });
  const selector = {
    provider: 'footywire',
    capabilityId: map.capabilityId,
    inputKind: 'completed_match_result' as const,
    sourceSchemaSha256: map.sourceSchemaSha256,
    providerDecodeMapId: map.mapId,
    seasonYear: 2026,
    rightsArtifactId: sourceAuthority.sourceRights.rightsArtifactId,
    valuationScopeKey: 'afl-men:2026-trades',
    captureId: staged.staging.capture.captureId,
    normalizationRunId: staged.staging.normalization.normalizationRunId,
  };
  expect(await repository.loadCurrentForSource(selector)).toEqual(projectedFieldMap);
  // Replay must preserve the originally reviewed assessment ordering and digest.
  await repository.registerApprovedProjection({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact: assessmentArtifact,
    reviewDecision: decision,
    decisionArtifact,
    projectedFieldMap,
  });
  expect(await repository.loadCurrentForSource(selector)).toEqual(projectedFieldMap);
  expect(JSON.stringify(sourceUseAssessment)).toBe(assessmentBeforeRegistration);
  for (const fields of [
    [...sourceUseAssessment.content.fields, sourceUseAssessment.content.fields[0]!],
    sourceUseAssessment.content.fields.slice(1),
    sourceUseAssessment.content.fields.map((field, index) =>
      index === 0 ? { ...field, state: 'not_permitted' as const } : field
    ),
  ]) {
    const content = { ...sourceUseAssessment.content, fields };
    const invalidAssessment = {
      assessmentId: createAflTradeContentAddress('hpn-private-source-use-assessment', content),
      content,
    };
    const invalidAssessmentArtifact = createAflTradeCanonicalJsonArtifactRef(invalidAssessment, at);
    const reviewContent = {
      ...decision.content,
      sourceUseAssessmentId: invalidAssessment.assessmentId,
      sourceUseAssessmentArtifact: invalidAssessmentArtifact,
    };
    const invalidDecision = {
      decisionId: createAflTradeContentAddress('hpn-field-map-review-decision', reviewContent),
      content: reviewContent,
    };
    const invalidDecisionArtifact = createAflTradeCanonicalJsonArtifactRef(invalidDecision, at);
    const invalidProjection = createAflTradeHpnProjectedFieldMap({
      candidate,
      candidateArtifact,
      decision: invalidDecision,
      decisionArtifact: invalidDecisionArtifact,
    });
    // Readdress all enclosing records so a stale artifact hash is not the cause
    // of rejection. The public owner must reject the permission payload itself.
    await expect(
      repository.registerApprovedProjection({
        candidate,
        candidateArtifact,
        sourceUseAssessment: invalidAssessment,
        sourceUseAssessmentArtifact: invalidAssessmentArtifact,
        reviewDecision: invalidDecision,
        decisionArtifact: invalidDecisionArtifact,
        projectedFieldMap: invalidProjection,
      })
    ).rejects.toThrow();
    expect(await repository.loadCurrentForSource(selector)).toEqual(projectedFieldMap);
  }
});
