import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { createAflTradeValuationInputBundleConstructionSpecification } from '@/server/aflTradeIntelligence/valuation/valuationInputBundleConstructionSpecification';

const digest = (character: string) => character.repeat(64);
const createdAt = '2026-08-15T01:00:00.000Z';

function policy(name: string) {
  const value = { policy: name, version: 1 };
  return { value, artifact: createAflTradeCanonicalJsonArtifactRef(value, createdAt) };
}

function evidenceArtifact(character: string) {
  return {
    artifactId: `artifact:${digest(character)}`,
    contentSha256: digest(character),
    storageUri: `artifact://sha256/${digest(character)}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

function componentRun(
  role: 'player_contribution_and_availability' | 'draft_pick_and_future_pick_distribution'
) {
  const player = role === 'player_contribution_and_availability';
  const manifest = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role,
    nativeExecution: player
      ? {
          kind: 'admitted_player_model_run',
          executionId: `model-run:${digest('1')}`,
          artifact: evidenceArtifact('2'),
        }
      : {
          kind: 'governed_pick_pav_model_execution',
          executionId: `pick-pav-model-execution:${digest('7')}`,
          artifact: evidenceArtifact('8'),
        },
    protocolId: `model-protocol:${digest(player ? '3' : '9')}`,
    protocolArtifact: evidenceArtifact(player ? '4' : 'a'),
    datasetId: `dataset:${digest(player ? '5' : 'b')}`,
    datasetArtifact: evidenceArtifact(player ? '6' : 'c'),
    datasetAdmissionId: `dataset-admission:${digest(player ? '7' : 'd')}`,
    datasetAdmissionArtifact: evidenceArtifact(player ? '8' : 'e'),
    datasetAdmissionGateLedgerRevision: 1,
    registeredAt: '2026-08-15T01:30:00.000Z',
  });
  return {
    manifest,
    artifact: createAflTradeCanonicalJsonArtifactRef(manifest, manifest.content.registeredAt),
  };
}

export function createAflTradeValuationInputBundleConstructionFixture() {
  const policies = {
    listSpot: policy('list-spot'),
    scarcity: policy('scarcity'),
    roleCongestion: policy('role-congestion'),
    lowReturn: policy('low-return'),
    eliteOutcome: policy('elite-outcome'),
    practicalEquivalence: policy('practical-equivalence'),
    explanation: policy('explanation'),
  };
  const specification = createAflTradeValuationInputBundleConstructionSpecification({
    scopeKey: 'afl-men:2025-trades',
    valueUnitId: 'fixed-horizon-pav-v1',
    createdAt: '2026-08-15T02:00:00.000Z',
    currentView: {
      effectiveAt: '2026-08-15T01:45:00.000Z',
      knowledgeCutoffAt: '2026-08-15T01:45:00.000Z',
      valuationAsOf: '2026-08-15T01:50:00.000Z',
    },
    policies: Object.fromEntries(
      Object.entries(policies).map(([key, retained]) => [key, retained.artifact])
    ) as { [K in keyof typeof policies]: (typeof policies)[K]['artifact'] },
    simulation: {
      draws: 10_000,
      seed: 'genuine-2025-valuation',
      samplingAlgorithmVersion: 'counter_sha256_rejection_v1',
    },
  });
  const specificationArtifact = createAflTradeCanonicalJsonArtifactRef(
    specification,
    specification.content.createdAt
  );
  const playerRun = componentRun('player_contribution_and_availability');
  const pickRun = componentRun('draft_pick_and_future_pick_distribution');
  const privateFactualAuthority = {
    valuationScopeKey: specification.content.scopeKey,
    candidateId: `private-factual-candidate:${digest('1')}`,
    evidenceScopeKey: 'afl-men:2025-evidence',
    evidenceBundleId: `private-reviewed-evidence-bundle:${digest('2')}`,
    reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${digest('3')}`,
    normalizedReconciledCustodySha256: digest('4'),
    revision: 2,
  };
  const operationPreimage = {
    scopeKey: specification.content.scopeKey,
    factualOperationId: `current-valuation-factual-refresh-operation:${digest('5')}`,
    privateFactualAuthority,
  };
  const modelEvidence = {
    schemaVersion: 'afl-current-valuation-model-evidence-result/v1' as const,
    operationId: createAflTradeContentAddress(
      'current-valuation-model-evidence-operation',
      operationPreimage
    ),
    ...operationPreimage,
    expectedModelRevision: 4,
    modelRevision: 5,
    capturedAt: '2026-08-15T01:40:00.000Z',
    completedAt: '2026-08-15T01:45:00.000Z',
    executionLocation: 'local' as const,
    visibility: 'private' as const,
    environment: 'non_production' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Private local non-production model evidence only; no prepared-input, valuation, production, activation, or publication authority is granted.' as const,
    playerObservationSetId: `player-observation-set:${digest('6')}`,
    pickBenchmarkEvidenceId: `pick-pav-observation-set:${digest('7')}`,
    playerRunId: playerRun.manifest.runId,
    pickRunId: pickRun.manifest.runId,
    qualificationId: `model-qualification:${digest('8')}`,
    state: 'qualified' as const,
    qualificationWorkId: `model-qualification-work:${digest('9')}`,
    playerGate3DecisionId: `gate-decision:${digest('a')}`,
    pickGate3DecisionId: `gate-decision:${digest('b')}`,
  };
  return {
    policies,
    specification,
    specificationArtifact,
    playerRun,
    pickRun,
    modelEvidence,
    specificationBytes: new TextEncoder().encode(canonicalizeAflTradeJson(specification)),
  };
}
