import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactRef,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  createAflDraftTradeOutcomeActivationAuthorization,
  createAflDraftTradeOutcomeProjectionManifest,
  createAflDraftTradeOutcomeReleaseManifest,
  type AflDraftTradeOutcomeReleaseManifest,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  applyAflDraftTradeOutcomeReleaseCommand,
  registerAflDraftTradeOutcomeRelease,
  type AflDraftTradeOutcomeReleaseRegistry,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { aflTradeGate0AReceiptSchema } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

export const aflDraftTradeOutcomeFixtureHash = (value: string) => value.repeat(64);

const artifact = (name: string, createdAt: string) =>
  createAflTradeCanonicalJsonArtifactRef({ fixture: name }, createdAt);

export function createAflTradeGateDecisionFixture(input: {
  gate: AflTradeGateCode;
  decisionKey: string;
  environment?: 'test_fixture' | 'non_production';
  affectedArtifacts?: readonly AflTradeGovernedArtifactRef[];
  scopeDimensions?: ReadonlyArray<{ name: string; values: readonly string[] }>;
  decidedAt: string;
  revalidateAt?: string;
}) {
  const environment = input.environment ?? 'test_fixture';
  const affectedArtifacts = [...(input.affectedArtifacts ?? [])];
  const scope = {
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    description: 'Fabricated public AFL outcome fixture.',
    dimensions: [...(input.scopeDimensions ?? [])],
    exclusions: [],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment,
    scope,
    proposal: 'Approve only this fabricated factual-release fixture.',
    alternativesConsidered: ['Keep the fabricated release inactive.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${aflDraftTradeOutcomeFixtureHash('e')}`],
    affectedArtifacts,
    proposedAt: '2026-08-06T00:00:00.000Z',
    proposedBy: 'fixture-owner',
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
    environment,
    scope,
    state: 'approved' as const,
    authorityKind:
      environment === 'test_fixture' ? ('fixture' as const) : ('external_human_record' as const),
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${aflDraftTradeOutcomeFixtureHash('e')}`],
    conditionResults: [],
    rationale: 'Fabricated test-only approval.',
    limitations: ['This decision has no production authority.'],
    decidedAt: input.decidedAt,
    effectiveAt: input.decidedAt,
    revalidateAt: input.revalidateAt ?? '2027-01-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return {
    decisionId: decision.decisionId,
    ledger: { proposals: [proposal], decisions: [decision] } as AflTradeGateDecisionLedger,
  };
}

export function createAflDraftTradeOutcomeReleaseFixture(
  key: string,
  rightsRevalidateAt?: string,
  termsExpireAt?: string
) {
  const sourceSnapshotId = `source-snapshot:${aflDraftTradeOutcomeFixtureHash(key)}`;
  const sourceRightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: `fixture-rights-${key}`,
    provider: 'Fixture provider',
    dataset: 'Fixture AFL player outcomes',
    datasetVersion: '2026-08-06',
    intendedPurpose: 'Test the public AFL Draft and Trade Outcomes release boundary.',
    scope: {
      competitions: ['AFL'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'provider_export' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/x-ndjson',
      deliveryMethod: 'Fabricated fixture export',
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'allowed' as const,
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
        basis: 'Fabricated fixture retention.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Fabricated fixture audit retention.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Fabricated fixture derived retention.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
    attribution: { required: false, text: null, placement: null },
    restrictions: {
      geographic: ['Australia'],
      commercial: ['test-only-fixture'],
      audience: ['public-afl-readers'],
    },
    fields: ['games', 'goals'].map((sourceField) => ({
      sourceField,
      normalizedField: `player_${sourceField}`,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'blocked' as const,
        derived_feature: 'allowed' as const,
        public_display: 'allowed' as const,
      },
      attributionRequired: false,
      notes: null,
    })),
    conditions: [],
    rightsEvidenceIds: [`artifact:${aflDraftTradeOutcomeFixtureHash('a')}`],
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: termsExpireAt ?? '2027-01-01T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fixture raw and derived artifacts.',
      retainableAuditMaterial: 'Content addresses and decision records.',
    },
    proposedAt: '2026-08-05T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const sourceRightsProposal = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', sourceRightsContent),
    content: sourceRightsContent,
  });
  const sourceRightsArtifactId = sourceRightsProposal.rightsArtifactId;
  const rights = createAflTradeGateDecisionFixture({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey: `fixture-source-rights-${key}`,
    decidedAt: '2026-08-06T00:10:00.000Z',
    ...(rightsRevalidateAt ? { revalidateAt: rightsRevalidateAt } : {}),
    scopeDimensions: [
      { name: 'source_rights_artifact', values: [sourceRightsArtifactId] },
      { name: 'competition', values: ['AFL'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: ['provider_export'] },
      { name: 'geography', values: ['Australia'] },
      { name: 'commercial_context', values: ['test-only-fixture'] },
      { name: 'audience', values: ['public-afl-readers'] },
      {
        name: 'operation',
        values: ['raw_evidence_retention', 'public_derived_output', 'public_fact_display'],
      },
    ],
    affectedArtifacts: [{ kind: 'source_rights', artifactId: sourceRightsArtifactId }],
  });
  const gate0aReceiptContent = {
    schemaVersion: 'afl-trade-gate0a-evaluation/v2' as const,
    request: {
      decisionKey: `fixture-source-rights-${key}`,
      environment: 'test_fixture',
      rightsArtifactId: sourceRightsArtifactId,
      evaluatedAt: '2026-08-06T00:20:00.000Z',
      competition: 'AFL',
      season: 2026,
      accessMechanism: 'provider_export',
      capabilityId: null,
      geography: 'Australia',
      commercialContext: 'test-only-fixture',
      audience: 'public-afl-readers',
      operations: ['raw_evidence_retention', 'public_derived_output', 'public_fact_display'],
      fieldUses: [
        { sourceField: 'games', use: 'public_display' },
        { sourceField: 'goals', use: 'public_display' },
      ],
      rawRetentionDays: 30,
      metadataRetentionDays: null,
      cacheSeconds: 300,
    },
    result: {
      status: 'mechanically_eligible' as const,
      decisionId: rights.decisionId,
      rightsArtifactId: sourceRightsArtifactId,
      blockers: [],
    },
    recordedAt: '2026-08-06T00:21:00.000Z',
  };
  const gate0aReceipt = aflTradeGate0AReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('gate0a-evaluation', gate0aReceiptContent),
    content: gate0aReceiptContent,
  });
  const metricDefinitions = [...AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS]
    .filter(({ metric }) => metric === 'games' || metric === 'goals')
    .sort((left, right) => left.metric.localeCompare(right.metric));
  const release = createAflDraftTradeOutcomeReleaseManifest({
    schemaVersion: 'afl-draft-trade-outcome-release/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    environment: 'test_fixture',
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    createdAt: '2026-08-06T01:00:00.000Z',
    effectiveThrough: '2026-08-05T14:00:00.000Z',
    archiveDatasetId: `archive-dataset:${aflDraftTradeOutcomeFixtureHash(key)}`,
    sourceSnapshotSetId: `source-snapshot-set:${aflDraftTradeOutcomeFixtureHash(key)}`,
    outcomeEvaluationSetId: `outcome-evaluation:${aflDraftTradeOutcomeFixtureHash(key)}`,
    acquisitionSpellRuleId: `acquisition-spell-rule:${aflDraftTradeOutcomeFixtureHash(key)}`,
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metricDefinitions,
    sourceRightsBindings: [
      {
        sourceSnapshotId,
        sourceRightsArtifactId,
        gateDecisionId: rights.decisionId,
        sourceRightsProposal,
        gate0aReceipt,
        consumedSourceFields: ['games', 'goals'],
      },
    ],
    reconciliationReportArtifact: artifact(`reconciliation-${key}`, '2026-08-06T00:40:00.000Z'),
    exceptionReportArtifact: artifact(`exceptions-${key}`, '2026-08-06T00:40:00.000Z'),
    supportedScope: ['AFL games and goals in the exact acquisition-spell scope'],
    excludedScope: ['Unresolved player identities'],
    outcomeRecordCount: 2,
    exceptionCount: 1,
    unresolvedIdentityCount: 1,
    unresolvedLineageCount: 0,
  });
  const createdAt = '2026-08-06T02:00:00.000Z';
  const projection = createAflDraftTradeOutcomeProjectionManifest({
    schemaVersion: 'afl-draft-trade-outcome-projection/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    environment: 'test_fixture',
    scopeKey: release.content.scopeKey,
    createdAt,
    releaseId: release.releaseId,
    archiveDatasetId: release.content.archiveDatasetId,
    metricRegistryVersion: release.content.metricRegistryVersion,
    effectiveThrough: release.content.effectiveThrough,
    metricDefinitionIds: metricDefinitions
      .map(({ metricDefinitionId }) => metricDefinitionId)
      .sort(),
    viewArtifacts: {
      list: artifact(`list-${key}`, createdAt),
      tradeDetail: artifact(`detail-${key}`, createdAt),
      club: artifact(`club-${key}`, createdAt),
      player: artifact(`player-${key}`, createdAt),
      year: artifact(`year-${key}`, createdAt),
      dashboard: artifact(`dashboard-${key}`, createdAt),
    },
    exportArtifacts: {
      json: artifact(`json-${key}`, createdAt),
      csv: artifact(`csv-${key}`, createdAt),
      xlsx: artifact(`xlsx-${key}`, createdAt),
    },
    parityReport: {
      artifact: artifact(`parity-${key}`, createdAt),
      status: 'passed',
      checkCount: 20,
      failureCount: 0,
      checkedOutcomeRecordCount: 2,
      logicalDatasetSha256: aflDraftTradeOutcomeFixtureHash(key),
    },
    documentCount: 12,
  });
  return { rights, release, projection };
}

export function createAflDraftTradeOutcomeActivationAuthorizationFixture(
  value: ReturnType<typeof createAflDraftTradeOutcomeReleaseFixture>,
  expectedRegistryRevision: number,
  authorizedAt: string,
  expiresAt: string,
  evidenceId: string,
  rollbackWindowEndsAt = '2026-08-07T00:00:00.000Z'
) {
  return createAflDraftTradeOutcomeActivationAuthorization({
    schemaVersion: 'afl-draft-trade-outcome-activation-authorization/v1',
    environment: 'test_fixture',
    scopeKey: value.release.content.scopeKey,
    releaseId: value.release.releaseId,
    projectionId: value.projection.projectionId,
    expectedRegistryRevision,
    authorizedAt,
    expiresAt,
    rollbackWindowEndsAt,
    writeBarrier: 'engaged',
    parityReportArtifactId: value.projection.content.parityReport.artifact.artifactId,
    authorityKind: 'fixture',
    authorizedBy: 'ops:fixture-authorizer',
    authorityEvidenceIds: [evidenceId],
  });
}

export function registerAflDraftTradeOutcomeReleaseFixture(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  release: AflDraftTradeOutcomeReleaseManifest
) {
  return registerAflDraftTradeOutcomeRelease(registry, {
    expectedRevision: registry.revision,
    manifest: release,
    actor: 'fixture-importer',
    evidenceId: release.releaseId,
  });
}

export function createAflDraftTradeOutcomeSelectionEvaluationFixture(
  value: ReturnType<typeof createAflDraftTradeOutcomeReleaseFixture>,
  evaluatedAt = '2026-08-06T13:00:00.000Z'
) {
  return { evaluatedAt, sourceRightsDecisionLedger: value.rights.ledger };
}

export function activateAflDraftTradeOutcomeReleaseFixture(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  value: ReturnType<typeof createAflDraftTradeOutcomeReleaseFixture>,
  baseHour: number,
  options: {
    reviewRevalidateAt?: string;
    authorizationExpiresAt?: string;
    rollbackWindowEndsAt?: string;
  } = {}
) {
  const validationAt = `2026-08-06T${String(baseHour).padStart(2, '0')}:00:00.000Z`;
  let next = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'validate',
    releaseId: value.release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: validationAt,
    actor: 'fixture-reviewer',
    evidenceId: value.projection.projectionId,
    environment: 'test_fixture',
    projectionManifest: value.projection,
    gateDecisionLedger: value.rights.ledger,
  });
  const affectedArtifacts = [
    { kind: 'factual_release' as const, artifactId: value.release.releaseId },
    { kind: 'factual_projection' as const, artifactId: value.projection.projectionId },
  ];
  const review = createAflTradeGateDecisionFixture({
    gate: 'gate_4_publication_api_readiness',
    decisionKey: `fixture-factual-review-${value.release.releaseId.slice(-8)}`,
    affectedArtifacts,
    decidedAt: validationAt,
    ...(options.reviewRevalidateAt ? { revalidateAt: options.reviewRevalidateAt } : {}),
  });
  next = applyAflDraftTradeOutcomeReleaseCommand(next, {
    action: 'approve',
    releaseId: value.release.releaseId,
    expectedRevision: next.revision,
    occurredAt: `2026-08-06T${String(baseHour + 1).padStart(2, '0')}:00:00.000Z`,
    actor: 'fixture-reviewer',
    evidenceId: review.decisionId,
    environment: 'test_fixture',
    gateDecisionId: review.decisionId,
    gateDecisionLedger: review.ledger,
  });
  const authorization = createAflTradeGateDecisionFixture({
    gate: 'gate_5_comprehension_accessibility',
    decisionKey: `fixture-operational-authorization-${value.release.releaseId.slice(-8)}`,
    affectedArtifacts,
    decidedAt: validationAt,
  });
  const operationalAuthorization = createAflDraftTradeOutcomeActivationAuthorizationFixture(
    value,
    next.revision,
    `2026-08-06T${String(baseHour + 1).padStart(2, '0')}:30:00.000Z`,
    options.authorizationExpiresAt ??
      `2026-08-06T${String(baseHour + 3).padStart(2, '0')}:00:00.000Z`,
    authorization.decisionId,
    options.rollbackWindowEndsAt
  );
  return applyAflDraftTradeOutcomeReleaseCommand(next, {
    action: 'activate',
    releaseId: value.release.releaseId,
    expectedRevision: next.revision,
    occurredAt: `2026-08-06T${String(baseHour + 2).padStart(2, '0')}:00:00.000Z`,
    actor: 'fixture-operator',
    evidenceId: authorization.decisionId,
    environment: 'test_fixture',
    gateDecisionId: authorization.decisionId,
    gateDecisionLedger: authorization.ledger,
    sourceRightsDecisionLedger: value.rights.ledger,
    factualReviewDecisionLedger: review.ledger,
    activationAuthorization: operationalAuthorization,
  });
}
