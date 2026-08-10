import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import {
  createAflDraftTradeOutcomeActivationAuthorization,
  createAflDraftTradeOutcomeReleaseManifest,
} from '../outcomes/outcomeReleaseContracts';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '../outcomes/outcomeReadService';
import { aflTradeGate0AReceiptSchema } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceContracts';
import { createLocalAflTradeFactualOutcomePublication } from './localFactualOutcomePublication';

const hash = (character: string) => character.repeat(64);
const artifact = (name: string, createdAt: string) =>
  createAflTradeCanonicalJsonArtifactRef({ localFixture: name }, createdAt);

function gateDecision(input: {
  gate: AflTradeGateCode;
  decisionKey: string;
  decidedAt: string;
  affectedArtifacts: readonly AflTradeGovernedArtifactRef[];
  scopeDimensions?: readonly { readonly name: string; readonly values: readonly string[] }[];
}) {
  const scope = {
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    description: 'Local source-native AFL archive fixture only.',
    dimensions: input.scopeDimensions ?? [{ name: 'environment', values: ['test_fixture'] }],
    exclusions: ['Production authority', 'Fantasy ownership'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Admit this deterministic local source-shaped fixture only.',
    alternativesConsidered: ['Keep the local archive empty.'],
    accountableOwner: 'local-fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${hash('e')}`],
    affectedArtifacts: [...input.affectedArtifacts],
    proposedAt: '2026-08-09T08:00:00.000Z',
    proposedBy: 'local-fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'local-fixture-owner',
    decidedBy: 'local-fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${hash('e')}`],
    conditionResults: [],
    rationale: 'Deterministic local development fixture.',
    limitations: ['No production, source-capture, model, or publication authority.'],
    decidedAt: input.decidedAt,
    effectiveAt: input.decidedAt,
    revalidateAt: '2027-08-09T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [...input.affectedArtifacts],
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return {
    proposal,
    decision,
    ledger: { proposals: [proposal], decisions: [decision] } satisfies AflTradeGateDecisionLedger,
  };
}

export function createLocalAflTradeOutcomeReleaseAuthority() {
  const sourceFields = [
    'draft_season',
    'original_club',
    'party_club',
    'pick_number',
    'selected_player',
    'selection_number',
    'trade_asset',
    'trade_id',
  ];
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'local-draftguru-source-shaped-fixture-v1',
    provider: 'draftguru',
    dataset: 'Local source-shaped AFL trade and draft fixture',
    datasetVersion: '2025-v1',
    intendedPurpose: 'Exercise the isolated local factual archive and public read boundary.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2025, to: 2026 }],
      accessMechanism: 'provider_export' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/json',
      deliveryMethod: 'Checked-in deterministic local fixture contract.',
    },
    operations: {
      bounded_evaluation_capture: 'blocked' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'blocked' as const,
      public_derived_output: 'allowed' as const,
      public_fact_display: 'allowed' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: false,
      identification: null,
      rateLimit: null,
      cache: { permitted: true, maximumSeconds: 300 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Local deterministic fixture retention.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Local provenance retention.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Local generated view retention.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
    attribution: {
      required: true,
      text: 'Development fixture shaped from Draftguru trade and draft facts.',
      placement: 'Local development methodology only.',
    },
    restrictions: { geographic: [], commercial: ['test-only'], audience: ['local-developer'] },
    fields: sourceFields.map((sourceField) => ({
      sourceField,
      normalizedField: sourceField,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'blocked' as const,
        derived_feature: 'blocked' as const,
        public_display: 'allowed' as const,
      },
      attributionRequired: true,
      notes: 'Deterministic test-fixture field.',
    })),
    conditions: [],
    rightsEvidenceIds: [`artifact:${hash('e')}`],
    termsEffectiveAt: '2026-08-09T08:00:00.000Z',
    termsExpireAt: '2027-08-09T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete local fixture bytes and reset the local outcomes database.',
      retainableAuditMaterial: 'Content addresses only.',
    },
    proposedAt: '2026-08-09T08:00:00.000Z',
    proposedBy: 'local-fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const rights = gateDecision({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey: 'local-draftguru-source-shaped-fixture',
    decidedAt: '2026-08-09T08:10:00.000Z',
    affectedArtifacts: [{ kind: 'source_rights', artifactId: sourceRights.rightsArtifactId }],
    scopeDimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2025'] },
      { name: 'access_mechanism', values: ['provider_export'] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['test-only'] },
      { name: 'audience', values: ['local-developer'] },
      {
        name: 'operation',
        values: ['raw_evidence_retention', 'public_derived_output', 'public_fact_display'],
      },
    ],
  });
  const gate0Content = {
    schemaVersion: 'afl-trade-gate0a-evaluation/v2' as const,
    request: {
      decisionKey: rights.decision.content.decisionKey,
      environment: 'test_fixture' as const,
      rightsArtifactId: sourceRights.rightsArtifactId,
      evaluatedAt: '2026-08-09T08:20:00.000Z',
      competition: 'AFLM',
      season: 2025,
      accessMechanism: 'provider_export',
      capabilityId: null,
      geography: 'global',
      commercialContext: 'test-only',
      audience: 'local-developer',
      operations: [
        'raw_evidence_retention',
        'public_derived_output',
        'public_fact_display',
      ] as const,
      fieldUses: sourceFields.map((sourceField) => ({
        sourceField,
        use: 'public_display' as const,
      })),
      rawRetentionDays: 30,
      metadataRetentionDays: null,
      cacheSeconds: 300,
    },
    result: {
      status: 'mechanically_eligible' as const,
      decisionId: rights.decision.decisionId,
      rightsArtifactId: sourceRights.rightsArtifactId,
      blockers: [],
    },
    recordedAt: '2026-08-09T08:21:00.000Z',
  };
  const gate0aReceipt = aflTradeGate0AReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('gate0a-evaluation', gate0Content),
    content: gate0Content,
  });
  const metricDefinitions = AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.filter(
    ({ metric }) => metric === 'games'
  );
  const legacyTemplate = createAflDraftTradeOutcomeReleaseManifest({
    schemaVersion: 'afl-draft-trade-outcome-release/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    environment: 'test_fixture',
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    createdAt: '2026-08-09T09:00:00.000Z',
    effectiveThrough: '2026-08-09T08:59:59.000Z',
    archiveDatasetId: `archive-dataset:${hash('1')}`,
    sourceSnapshotSetId: `source-snapshot-set:${hash('2')}`,
    outcomeEvaluationSetId: `outcome-evaluation:${hash('3')}`,
    acquisitionSpellRuleId: `acquisition-spell-rule:${hash('4')}`,
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metricDefinitions,
    sourceRightsBindings: [
      {
        sourceSnapshotId: `source-snapshot:${hash('5')}`,
        sourceRightsArtifactId: sourceRights.rightsArtifactId,
        gateDecisionId: rights.decision.decisionId,
        sourceRightsProposal: sourceRights,
        gate0aReceipt,
        consumedSourceFields: sourceFields,
      },
    ],
    reconciliationReportArtifact: artifact('local-reconciliation', '2026-08-09T08:40:00.000Z'),
    exceptionReportArtifact: artifact('local-exceptions', '2026-08-09T08:40:00.000Z'),
    supportedScope: ['One deterministic source-native AFL trade fixture'],
    excludedScope: ['Numerical valuation and production publication'],
    outcomeRecordCount: 0,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  });
  const publication = createLocalAflTradeFactualOutcomePublication(legacyTemplate);
  const { release, projection } = publication;
  const affectedArtifacts = [
    { kind: 'factual_release' as const, artifactId: release.releaseId },
    { kind: 'factual_projection' as const, artifactId: projection.projectionId },
  ];
  const review = gateDecision({
    gate: 'gate_4_publication_api_readiness',
    decisionKey: 'local-factual-review',
    decidedAt: '2026-08-09T09:20:00.000Z',
    affectedArtifacts,
  });
  const operation = gateDecision({
    gate: 'gate_5_comprehension_accessibility',
    decisionKey: 'local-factual-activation',
    decidedAt: '2026-08-09T09:30:00.000Z',
    affectedArtifacts,
  });
  const activation = createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: 'test_fixture',
    scopeKey: release.content.scopeKey,
    releaseId: release.releaseId,
    projectionId: projection.projectionId,
    expectedRegistryRevision: 3,
    authorizedAt: '2026-08-09T09:30:00.000Z',
    expiresAt: '2027-08-09T00:00:00.000Z',
    rollbackWindowEndsAt: '2027-08-09T00:00:00.000Z',
    writeBarrier: 'engaged',
    parityReportArtifactId: projection.content.parityReport.artifact.artifactId,
    authorityKind: 'fixture',
    authorizedBy: 'local-fixture-owner',
    authorityEvidenceIds: [operation.decision.decisionId],
  });
  return {
    sourceRights,
    rights,
    release,
    projection,
    candidate: publication.candidate,
    itemSet: publication.itemSet,
    review,
    operation,
    activation,
  };
}
