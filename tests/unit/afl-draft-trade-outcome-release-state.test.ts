import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type {
  AflTradeGateCode,
  AflTradeGovernedArtifactRef,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { aflTradeGate0AReceiptSchema } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import {
  createAflDraftTradeOutcomeActivationAuthorization,
  createAflDraftTradeOutcomeProjectionManifest,
  createAflDraftTradeOutcomeReleaseManifest,
  validateAflDraftTradeOutcomeReleaseProjectionPair,
  type AflDraftTradeOutcomeReleaseManifest,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  AflDraftTradeOutcomeReleaseStateError,
  applyAflDraftTradeOutcomeReleaseCommand,
  captureAflDraftTradeOutcomeReleaseSelection,
  createAflDraftTradeOutcomeRegistryReleaseSelector,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
  type AflDraftTradeOutcomeReleaseRegistry,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import {
  AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
  AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';

const hash = (value: string) => value.repeat(64);
const artifact = (name: string, createdAt: string) =>
  createAflTradeCanonicalJsonArtifactRef({ fixture: name }, createdAt);

function gateDecision(input: {
  gate: AflTradeGateCode;
  decisionKey: string;
  affectedArtifacts?: readonly AflTradeGovernedArtifactRef[];
  scopeDimensions?: ReadonlyArray<{ name: string; values: readonly string[] }>;
  decidedAt: string;
  revalidateAt?: string;
}) {
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
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve only this fabricated factual-release fixture.',
    alternativesConsidered: ['Keep the fabricated release inactive.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${hash('e')}`],
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
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${hash('e')}`],
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

function fixture(key: string, rightsRevalidateAt?: string, termsExpireAt?: string) {
  const sourceSnapshotId = `source-snapshot:${hash(key)}`;
  const sourceRightsContent = {
    schemaVersion: 'afl-trade-source-rights/v1' as const,
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
    redistribution: {
      rawFieldsPermitted: false,
      publicDerivedOutputPermitted: true,
    },
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
    rightsEvidenceIds: [`artifact:${hash('a')}`],
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
  const gate0aScopeDimensions = [
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
  ];
  const rights = gateDecision({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey: `fixture-source-rights-${key}`,
    decidedAt: '2026-08-06T00:10:00.000Z',
    ...(rightsRevalidateAt ? { revalidateAt: rightsRevalidateAt } : {}),
    scopeDimensions: gate0aScopeDimensions,
    affectedArtifacts: [{ kind: 'source_rights', artifactId: sourceRightsArtifactId }],
  });
  const gate0aReceiptContent = {
    schemaVersion: 'afl-trade-gate0a-evaluation/v1' as const,
    request: {
      decisionKey: `fixture-source-rights-${key}`,
      environment: 'test_fixture',
      rightsArtifactId: sourceRightsArtifactId,
      evaluatedAt: '2026-08-06T00:20:00.000Z',
      competition: 'AFL',
      season: 2026,
      accessMechanism: 'provider_export',
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
    archiveDatasetId: `archive-dataset:${hash(key)}`,
    sourceSnapshotSetId: `source-snapshot-set:${hash(key)}`,
    outcomeEvaluationSetId: `outcome-evaluation:${hash(key)}`,
    acquisitionSpellRuleId: `acquisition-spell-rule:${hash(key)}`,
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
      logicalDatasetSha256: hash(key),
    },
    documentCount: 12,
  });
  return { rights, release, projection };
}

function activationAuthorization(
  value: ReturnType<typeof fixture>,
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

function register(
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

function selectionEvaluation(
  value: ReturnType<typeof fixture>,
  evaluatedAt = '2026-08-06T13:00:00.000Z'
) {
  return { evaluatedAt, sourceRightsDecisionLedger: value.rights.ledger };
}

function activateFixture(
  registry: AflDraftTradeOutcomeReleaseRegistry,
  value: ReturnType<typeof fixture>,
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
  const review = gateDecision({
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
  const authorization = gateDecision({
    gate: 'gate_5_comprehension_accessibility',
    decisionKey: `fixture-operational-authorization-${value.release.releaseId.slice(-8)}`,
    affectedArtifacts,
    decidedAt: validationAt,
  });
  const operationalAuthorization = activationAuthorization(
    value,
    next.revision,
    `2026-08-06T${String(baseHour + 1).padStart(2, '0')}:30:00.000Z`,
    options.authorizationExpiresAt ??
      `2026-08-06T${String(baseHour + 3).padStart(2, '0')}:00:00.000Z`,
    authorization.decisionId,
    options.rollbackWindowEndsAt
  );
  next = applyAflDraftTradeOutcomeReleaseCommand(next, {
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
  return next;
}

describe('AFL Draft & Trade factual release contracts', () => {
  it('content-addresses exact release and projection evidence and rejects drift', () => {
    const { release, projection } = fixture('a');
    expect(release.releaseId).toMatch(/^outcome-release:[a-f0-9]{64}$/);
    expect(projection.projectionId).toMatch(/^outcome-projection:[a-f0-9]{64}$/);
    expect(validateAflDraftTradeOutcomeReleaseProjectionPair(release, projection)).toBe(true);
    expect(
      validateAflDraftTradeOutcomeReleaseProjectionPair(release, {
        ...projection,
        content: { ...projection.content, documentCount: 13 },
      })
    ).toBe(false);
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        scopeKey: 'fantasy:league-owned-outcomes',
      })
    ).toThrow();
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        excludedScope: [release.content.supportedScope[0]],
      })
    ).toThrow();

    const sourceBinding = release.content.sourceRightsBindings[0];
    const narrowedReceiptContent = {
      ...sourceBinding.gate0aReceipt.content,
      request: {
        ...sourceBinding.gate0aReceipt.content.request,
        fieldUses: sourceBinding.gate0aReceipt.content.request.fieldUses.map((fieldUse) =>
          fieldUse.sourceField === 'goals'
            ? { ...fieldUse, use: 'derived_feature' as const }
            : fieldUse
        ),
      },
    };
    const narrowedReceipt = aflTradeGate0AReceiptSchema.parse({
      receiptId: createAflTradeContentAddress('gate0a-evaluation', narrowedReceiptContent),
      content: narrowedReceiptContent,
    });
    expect(() =>
      createAflDraftTradeOutcomeReleaseManifest({
        ...release.content,
        sourceRightsBindings: [{ ...sourceBinding, gate0aReceipt: narrowedReceipt }],
      })
    ).toThrow();
  });
});

describe('AFL Draft & Trade factual release lifecycle', () => {
  it('keeps candidates inactive and rejects stale registration without mutation', () => {
    const value = fixture('a');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        value.release.content.scopeKey,
        selectionEvaluation(value)
      )
    ).toEqual({ registryRevision: 1, selection: null });
    const original = structuredClone(registry);
    expect(() =>
      registerAflDraftTradeOutcomeRelease(registry, {
        expectedRevision: 0,
        manifest: fixture('b').release,
        actor: 'stale-importer',
        evidenceId: `artifact:${hash('f')}`,
      })
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
    expect(registry).toEqual(original);
  });

  it('activates one exact release selection and rejects a concurrent stale winner', async () => {
    const first = fixture('a');
    let registry = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    registry = activateFixture(registry, first, 3);
    const snapshot = captureAflDraftTradeOutcomeReleaseSelection(
      registry,
      AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      selectionEvaluation(first)
    );
    expect(snapshot).toMatchObject({
      registryRevision: 4,
      selection: {
        registryRevision: 4,
        release: {
          releaseId: first.release.releaseId,
          projectionId: first.projection.projectionId,
          archiveDatasetId: first.release.content.archiveDatasetId,
          publishedAt: '2026-08-06T05:00:00.000Z',
        },
      },
    });
    const selector = createAflDraftTradeOutcomeRegistryReleaseSelector(
      async () => registry,
      async () => first.rights.ledger,
      () => '2026-08-06T13:00:00.000Z'
    );
    await expect(selector.capture(AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE)).resolves.toEqual(snapshot);
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first, '2027-01-01T00:00:00.000Z')
      )
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));

    const original = structuredClone(registry);
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'withdraw',
        releaseId: first.release.releaseId,
        expectedRevision: 3,
        occurredAt: '2026-08-06T06:00:00.000Z',
        actor: 'stale-operator',
        evidenceId: `artifact:${hash('f')}`,
        reason: 'Fabricated concurrent withdrawal.',
      })
    ).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }));
    expect(registry).toEqual(original);
  });

  it('rechecks source rights at activation rather than relying on earlier validation', () => {
    const value = fixture('c', '2026-08-06T04:30:00.000Z');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(() => activateFixture(registry, value, 3)).toThrow(
      expect.objectContaining({ code: 'INEFFECTIVE_DECISION' })
    );
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        value.release.content.scopeKey,
        selectionEvaluation(value)
      )
    ).toEqual({ registryRevision: 1, selection: null });

    const expiredTerms = fixture('c', undefined, '2026-08-06T04:30:00.000Z');
    const termsRegistry = register(
      createAflDraftTradeOutcomeReleaseRegistry(),
      expiredTerms.release
    );
    expect(() => activateFixture(termsRegistry, expiredTerms, 3)).toThrow(
      expect.objectContaining({ code: 'INEFFECTIVE_DECISION' })
    );
  });

  it('rechecks factual review and operational authorization at activation', () => {
    const value = fixture('d');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    expect(() =>
      activateFixture(registry, value, 3, {
        reviewRevalidateAt: '2026-08-06T04:30:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
    expect(() =>
      activateFixture(registry, value, 3, {
        authorizationExpiresAt: '2026-08-06T04:45:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
    expect(() =>
      activateFixture(registry, value, 3, {
        rollbackWindowEndsAt: '2026-08-06T04:45:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'INEFFECTIVE_DECISION' }));
  });

  it('strictly rejects unknown and accessor command envelopes without mutation', () => {
    const value = fixture('e');
    const registry = register(createAflDraftTradeOutcomeReleaseRegistry(), value.release);
    const original = structuredClone(registry);
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'erase',
        releaseId: value.release.releaseId,
        expectedRevision: registry.revision,
        occurredAt: '2026-08-06T03:00:00.000Z',
        actor: 'fixture-operator',
        evidenceId: `artifact:${hash('e')}`,
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));

    let invocationCount = 0;
    const accessor = {
      releaseId: value.release.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-06T03:00:00.000Z',
      actor: 'fixture-operator',
      evidenceId: `artifact:${hash('e')}`,
    };
    Object.defineProperty(accessor, 'action', {
      enumerable: true,
      get() {
        invocationCount += 1;
        return 'withdraw';
      },
    });
    expect(() => applyAflDraftTradeOutcomeReleaseCommand(registry, accessor)).toThrow(
      expect.objectContaining({ code: 'INVALID_COMMAND' })
    );
    expect(invocationCount).toBe(0);
    expect(registry).toEqual(original);
  });

  it('atomically supersedes, withdraws without fallback, and requires fresh recovery', () => {
    const first = fixture('a');
    const second = fixture('b');
    let registry = createAflDraftTradeOutcomeReleaseRegistry();
    registry = register(registry, first.release);
    registry = activateFixture(registry, first, 3);
    registry = register(registry, second.release);
    registry = activateFixture(registry, second, 6);
    expect(registry.releases[first.release.releaseId].state).toBe('superseded');
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(second)
      ).selection?.release.releaseId
    ).toBe(second.release.releaseId);

    registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
      action: 'withdraw',
      releaseId: second.release.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-06T09:30:00.000Z',
      actor: 'fixture-operator',
      evidenceId: `artifact:${hash('f')}`,
      reason: 'Fabricated source-rights incident.',
    });
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(second)
      )
    ).toEqual({ registryRevision: registry.revision, selection: null });
    expect(() =>
      applyAflDraftTradeOutcomeReleaseCommand(registry, {
        action: 'activate',
        releaseId: first.release.releaseId,
        expectedRevision: registry.revision,
        occurredAt: '2026-08-06T10:00:00.000Z',
        actor: 'fixture-operator',
        evidenceId: `artifact:${hash('d')}`,
        environment: 'test_fixture',
        gateDecisionId: `gate-decision:${hash('d')}`,
        gateDecisionLedger: { proposals: [], decisions: [] },
        sourceRightsDecisionLedger: first.rights.ledger,
        factualReviewDecisionLedger: { proposals: [], decisions: [] },
        activationAuthorization: activationAuthorization(
          first,
          registry.revision,
          '2026-08-06T09:45:00.000Z',
          '2026-08-06T11:00:00.000Z',
          `artifact:${hash('d')}`
        ),
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));

    registry = activateFixture(registry, first, 10);
    expect(
      captureAflDraftTradeOutcomeReleaseSelection(
        registry,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      ).selection?.release
    ).toMatchObject({
      releaseId: first.release.releaseId,
      publishedAt: '2026-08-06T12:00:00.000Z',
    });
  });

  it('fails closed when the active pointer is inconsistent', () => {
    const first = fixture('a');
    let registry = register(createAflDraftTradeOutcomeReleaseRegistry(), first.release);
    registry = activateFixture(registry, first, 3);
    const corrupted = {
      ...registry,
      releases: {
        ...registry.releases,
        [first.release.releaseId]: {
          ...registry.releases[first.release.releaseId],
          state: 'withdrawn' as const,
        },
      },
    };
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        corrupted,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(AflDraftTradeOutcomeReleaseStateError);

    expect(registry.events).toHaveLength(registry.revision);
    expect(registry.events.at(-1)?.eventId).toMatch(/^outcome-release-event:[a-f0-9]{64}$/);
    const tamperedEventChain = structuredClone(registry);
    tamperedEventChain.events[0].content.actor = 'tampered-actor';
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        tamperedEventChain,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const forgedScope = structuredClone(registry);
    forgedScope.releases[first.release.releaseId].scopeKey = 'public-afl-forged-scope';
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        forgedScope,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const forgedAuthority = structuredClone(registry);
    forgedAuthority.releases[first.release.releaseId].gate5DecisionId =
      `gate-decision:${hash('x')}`;
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        forgedAuthority,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const rehashedInvalidTransition = structuredClone(registry);
    const activationRecordEvent =
      rehashedInvalidTransition.releases[first.release.releaseId].events.at(-1)!;
    activationRecordEvent.from = 'candidate';
    const activationGlobalEvent = rehashedInvalidTransition.events.at(-1)!;
    activationGlobalEvent.content.from = 'candidate';
    const targetState = activationGlobalEvent.content.affectedRecordStates.find(
      ({ releaseId }) => releaseId === first.release.releaseId
    )!;
    targetState.recordState = structuredClone(
      rehashedInvalidTransition.releases[first.release.releaseId]
    );
    targetState.recordStateId = createAflTradeContentAddress(
      'outcome-release-record-state',
      targetState.recordState
    );
    activationGlobalEvent.eventId = createAflTradeContentAddress(
      'outcome-release-event',
      activationGlobalEvent.content
    );
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        rehashedInvalidTransition,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));

    const rehashedHistoricalProjection = structuredClone(registry);
    const validationGlobalEvent = rehashedHistoricalProjection.events[1];
    const validationState = validationGlobalEvent.content.affectedRecordStates[0];
    validationState.recordState.projectionManifest!.content.documentCount += 1;
    validationState.recordStateId = createAflTradeContentAddress(
      'outcome-release-record-state',
      validationState.recordState
    );
    for (let index = 1; index < rehashedHistoricalProjection.events.length; index += 1) {
      const event = rehashedHistoricalProjection.events[index];
      event.content.previousEventId = rehashedHistoricalProjection.events[index - 1].eventId;
      event.eventId = createAflTradeContentAddress('outcome-release-event', event.content);
    }
    expect(() =>
      captureAflDraftTradeOutcomeReleaseSelection(
        rehashedHistoricalProjection,
        AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
        selectionEvaluation(first)
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REGISTRY' }));
  });
});
