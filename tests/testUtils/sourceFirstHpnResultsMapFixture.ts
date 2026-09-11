import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { prepareLocalAflTradeFitzRoyMatchEvidence } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createLocalAflTradeHpnCompletedResultFieldMapCandidate } from '@/server/aflTradeIntelligence/development/localHpnFieldMapCandidates';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { assessAflTradeHpnSourceFirstCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

/** Explicit synthetic review through existing owners; no source or SQL authority override. */
export async function registerSourceFirstHpnResultsMapFixture(
  client: AflOutcomeSqlClient,
  evidence: Awaited<ReturnType<typeof prepareLocalAflTradeFitzRoyMatchEvidence>>
) {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'match_only',
  });
  const staged = evidence.ingestion;
  const sourceAuthority = fixture.command.capture;
  const retained = await client.query<{ finalized_at: Date; staging_sha256: string }>(
    'SELECT finalized_at,staging_sha256 FROM outcome_provider_normalization_run WHERE normalization_run_id=$1',
    [staged.staging.normalization.normalizationRunId]
  );
  if (retained.rows.length !== 1) throw new Error('Expected exact retained results normalization.');
  const clock = await client.query<{ now: Date }>(
    "SELECT date_trunc('milliseconds',clock_timestamp()) AS now"
  );
  const at = clock.rows[0]!.now.toISOString();
  const map = fixture.command.fieldMap;
  const mapArtifact = createAflTradeCanonicalJsonArtifactRef(map, map.approvedAt);
  const candidate = createLocalAflTradeHpnCompletedResultFieldMapCandidate({
    seasonYear: 2026,
    providerDecodeMap: map,
    providerDecodeMapArtifact: mapArtifact,
    createdAt: at,
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
    sourceFields: [
      ...new Set(candidate.content.semanticBindings.flatMap(listAflTradeHpnCandidateSourceFields)),
    ].sort(),
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
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(candidate, at);
  const sourceUseAssessmentArtifact = createAflTradeCanonicalJsonArtifactRef(
    sourceUseAssessment,
    at
  );
  const reviewDecision = createAflTradeHpnFieldMapReviewDecision({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    decision: 'approved',
    reviewerId: 'synthetic-same-request-results-reviewer',
    rationale: 'Synthetic same-request results admission regression; not genuine source approval.',
    decidedAt: at,
  });
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(reviewDecision, at);
  const projectedFieldMap = createAflTradeHpnProjectedFieldMap({
    candidate,
    candidateArtifact,
    decision: reviewDecision,
    decisionArtifact,
  });
  await new PostgresAflTradeHpnProjectedFieldMapAuthority(client).registerApprovedProjection({
    candidate,
    candidateArtifact,
    sourceUseAssessment,
    sourceUseAssessmentArtifact,
    reviewDecision,
    decisionArtifact,
    projectedFieldMap,
  });
  return projectedFieldMap;
}
