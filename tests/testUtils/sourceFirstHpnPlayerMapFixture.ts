import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { stageLocalAflTradeFitzRoyFixture } from './localFitzRoyStagingFixture';
import {
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
  LOCAL_FITZROY_REHEARSAL_HPN_VALUES,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createAflTradeHpnFieldMapCandidate } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { listAflTradeHpnCandidateSourceFields } from '@/server/aflTradeIntelligence/modeling/hpnFieldMapCandidate';
import { assessAflTradeHpnSourceFirstCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/hpnPrivateCalculationSourceUse';
import {
  createAflTradeHpnFieldMapReviewDecision,
  createAflTradeHpnProjectedFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

/** Explicit synthetic review through existing owners; no source or SQL authority override. */
export async function registerSourceFirstHpnPlayerMapFixture(
  client: AflOutcomeSqlClient,
  staged: Awaited<ReturnType<typeof stageLocalAflTradeFitzRoyFixture>>,
  provider: 'afl_tables' | 'footywire',
  hpnPlayerSide: 'home' | 'away' = 'home'
) {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider,
    profile: 'hpn_player_stats',
    hpnPlayerSide,
  });
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
  const candidate = createAflTradeHpnFieldMapCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    provider,
    capabilityId: map.capabilityId,
    sourceSchemaSha256: map.sourceSchemaSha256,
    inputKind: 'player_match_stats',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    semanticBindings: [
      { semanticField: 'player', mapping: { kind: 'direct', sourceField: 'player_id' } },
      { semanticField: 'match', mapping: { kind: 'direct', sourceField: 'match_id' } },
      { semanticField: 'club', mapping: { kind: 'direct', sourceField: hpnPlayerSide } },
      ...Object.keys(LOCAL_FITZROY_REHEARSAL_HPN_VALUES).map((field) => ({
        semanticField: field as keyof typeof LOCAL_FITZROY_REHEARSAL_HPN_VALUES,
        mapping: { kind: 'direct' as const, sourceField: field },
      })),
    ],
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
    reviewerId: 'synthetic-source-first-hpn-player-reviewer',
    rationale: 'Synthetic complete player input regression; not genuine source approval.',
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
