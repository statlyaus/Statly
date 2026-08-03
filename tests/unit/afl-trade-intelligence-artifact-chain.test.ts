import { describe, expect, it } from 'vitest';

import {
  aflTradeModelRunManifestSchema,
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
  validateAflTradeManifestProvenance,
  type AflTradeManifestProvenanceInput,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS,
  AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS,
  aflTradeArchitectureDecisionPackageSchema,
} from '@/server/aflTradeIntelligence/governance/architectureDecisionPackage';
import {
  AFL_TRADE_AUTHORITY_CONCERNS,
  AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS,
  aflTradeArchitectureCurrentStateSchema,
} from '@/server/aflTradeIntelligence/governance/architectureCurrentState';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type {
  AflTradeGateCode,
  AflTradeGovernedArtifactRef,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';

const digest = (character: string) => character.repeat(64);

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

function runContent() {
  return {
    schemaVersion: 'afl-trade-model-run/v1' as const,
    environment: 'test_fixture' as const,
    modelId: 'fixture-model',
    modelVersion: 'fixture-v1',
    datasetId: `dataset:${digest('1')}`,
    codeCommitSha: digest('2').slice(0, 40),
    cleanWorktree: true as const,
    seed: 42,
    job: {
      jobId: 'fixture-job',
      attempt: 1,
      initiatedBy: 'fixture-model-owner',
      workerIdentity: 'fixture-worker',
    },
    startedAt: '2026-08-05T00:00:00.000Z',
    finishedAt: '2026-08-05T01:00:00.000Z',
    windows: {
      train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      calibration: { from: '2021-01-08T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      validation: { from: '2022-01-08T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
      finalTest: { from: '2023-01-08T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 7,
    },
    sourceCodeArtifact: artifact('3'),
    dependencyLockArtifact: artifact('4'),
    runtimeArtifact: artifact('5'),
    containerArtifact: artifact('6'),
    configurationArtifact: artifact('7'),
    environmentArtifact: artifact('8'),
    featureDefinitionArtifacts: [artifact('9'), artifact('0')],
    outcome: {
      status: 'succeeded' as const,
      modelArtifact: artifact('a'),
      validationReportArtifact: artifact('b'),
      modelCardArtifact: artifact('c'),
      diagnosticsArtifact: artifact('d'),
    },
  };
}

function modelRun(content = runContent()) {
  return aflTradeModelRunManifestSchema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

function publicationContent(run = modelRun()) {
  return {
    schemaVersion: 'afl-trade-publication/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current-outcome',
    createdAt: '2026-08-06T00:00:00.000Z',
    datasetId: run.content.datasetId,
    modelRunId: run.runId,
    gate3DecisionId: `gate-decision:${digest('e')}`,
    sourceRegisterIds: ['fixture-source'],
    supportedViews: ['current' as const],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: ['fixture-excluded'],
    valueUnitId: 'fixture-contribution-v1',
    entryCount: 10,
    publicationBundleArtifact: artifact('1'),
    methodologyArtifact: artifact('2'),
    validationReportArtifact: artifact('3'),
    modelCardArtifact: artifact('4'),
  };
}

function publication(content = publicationContent()) {
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

function projectionContent(parent = publication()) {
  return {
    schemaVersion: 'afl-trade-projection/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: parent.content.scopeKey,
    createdAt: '2026-08-07T00:00:00.000Z',
    publicationId: parent.publicationId,
    buildJobId: 'fixture-projection-job',
    responseContractVersion: 'afl-trade-response-v1',
    documentCount: 10,
    projectionArtifact: artifact('5'),
    schemaArtifact: artifact('6'),
    parityReportArtifact: artifact('7'),
  };
}

function gatePair(
  gate: AflTradeGateCode,
  decisionCharacter: string,
  affectedArtifacts: AflTradeGovernedArtifactRef[]
) {
  const scope = {
    scopeKey: `${gate}-fixture`,
    description: 'Fabricated artifact-chain scope.',
    dimensions: [],
    exclusions: [],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate,
    decisionKey: `${gate}-fixture`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    accountableOwner: 'fixture-owner',
    conditions: [],
    proposal: 'Approve the fabricated artifact-chain fixture.',
    alternativesConsidered: ['Keep the fabricated chain blocked.'],
    evidenceIds: [`artifact:${digest(decisionCharacter)}`],
    affectedArtifacts,
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${digest('f')}`],
    conditionResults: [],
    rationale: 'Fabricated approval.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-01T00:00:00.000Z',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    revalidateAt: '2027-01-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

function architectureArtifacts() {
  const currentStateContent = {
    schemaVersion: 'afl-trade-architecture-current-state/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment: 'test_fixture' as const,
    repositoryRevision: digest('a').slice(0, 40),
    capturedAt: '2026-08-02T00:00:00.000Z',
    capturedBy: 'fixture-owner',
    captureMethod: 'repository_inspection' as const,
    productionClaim: false as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    verifications: [
      {
        verificationId: 'fixture-verification',
        command: 'Inspect fabricated fixtures.',
        outcome: 'confirmed' as const,
        observedAt: '2026-08-02T00:00:00.000Z',
        evidenceIds: [`artifact:${digest('a')}`],
      },
    ],
    authorities: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => ({
      concern,
      implementationState: 'not_implemented' as const,
      currentAuthority: `Fixture current authority for ${concern}.`,
      readPath: `Fixture read path for ${concern}.`,
      writePath: `Fixture write path for ${concern}.`,
      sourceReferences: [`fixture/${concern}`],
      limitations: ['No production authority.'],
    })),
    requiredObservations: AFL_TRADE_REQUIRED_CURRENT_STATE_OBSERVATIONS.map((observation) => ({
      observation,
      finding: `Fixture finding for ${observation}.`,
      sourceReferences: [`fixture/${observation}`],
      verificationIds: ['fixture-verification'],
    })),
    unresolvedQuestions: ['Production readiness remains unverified.'],
  };
  const currentState = aflTradeArchitectureCurrentStateSchema.parse({
    snapshotId: createAflTradeContentAddress('architecture-current-state', currentStateContent),
    content: currentStateContent,
  });
  const packageContent = {
    schemaVersion: 'afl-trade-architecture-decision-package/v1' as const,
    subject: 'afl-trade-intelligence' as const,
    environment: 'test_fixture' as const,
    decisionKey: 'fixture-gate1',
    packageVersion: 1,
    currentStateSnapshotId: currentState.snapshotId,
    preparedAt: '2026-08-03T00:00:00.000Z',
    preparedBy: 'fixture-owner',
    packageState: 'proposal_only' as const,
    productionClaim: false as const,
    infrastructureReadiness: 'not_asserted' as const,
    operationalAuthorization: 'not_granted' as const,
    authorityTransfer: 'not_executed' as const,
    integrityStatement: 'content_address_proves_integrity_not_truth_or_authority' as const,
    designAssertions: [...AFL_TRADE_ARCHITECTURE_DESIGN_ASSERTIONS],
    isolationContract: {
      protectedFantasyAuthority: 'observed_unchanged_outside_trade_engine' as const,
      analyticalDatabase: {
        deploymentBoundary: 'independent_database_or_isolated_database_and_role' as const,
        credentials: 'separate_pooled_and_direct' as const,
        migrationHistory: 'separate_postgresql_native' as const,
        backupRestore: 'separate_evidence_required' as const,
        connectionBudget: 'separate' as const,
        relationalDependencies: 'no_fantasy_foreign_keys' as const,
      },
      publicIdentities: 'source_native_no_fantasy_ownership' as const,
      valuationProjectionPointer: 'separate_from_legacy_archive_pointer' as const,
    },
    authorityMatrix: AFL_TRADE_AUTHORITY_CONCERNS.map((concern) => {
      const currentAuthority = `Fixture current authority for ${concern}.`;
      const protectedFantasy = concern === 'protected_fantasy_relational_state';
      return {
        concern,
        currentAuthority,
        targetAuthority: protectedFantasy
          ? currentAuthority
          : `Fixture target authority for ${concern}.`,
        transitionRequired: !protectedFantasy,
        currentAuthorityDisposition: 'unchanged_until_authorized_activation' as const,
        targetAuthorityStatus: 'proposed_not_authoritative' as const,
        activationOwner: 'fixture-owner',
        activationConditions: ['Verify the fabricated target.'],
        retirementConditions: ['Close the fabricated rollback window.'],
      };
    }),
    sections: AFL_TRADE_ARCHITECTURE_PACKAGE_SECTIONS.map((section) => ({
      section,
      decision: `Fixture decision for ${section}.`,
      owner: 'fixture-owner',
      acceptanceCriteria: ['Review fabricated evidence.'],
      evidenceIds: [`artifact:${digest('a')}`],
      sourceReferences: [`fixture/${section}`],
    })),
    readinessEvidenceRequirements: ['Observe controlled behavior.'],
    operationalAuthorizationRequirements: ['Record separate authorization.'],
    limitations: ['No production authority.'],
  };
  const decisionPackage = aflTradeArchitectureDecisionPackageSchema.parse({
    packageId: createAflTradeContentAddress('architecture-decision-package', packageContent),
    content: packageContent,
  });
  return { currentState, decisionPackage };
}

function validProvenanceInput(): AflTradeManifestProvenanceInput {
  const rightsId = `source-rights:${digest('1')}`;
  const receiptId = `gate0a-evaluation:${digest('2')}`;
  const evidenceId = `evidence:${digest('3')}`;
  const protocolContent = {
    schemaVersion: 'afl-trade-data-sufficiency-protocol/v1' as const,
    protocolKey: 'fixture-protocol',
    version: 1,
    environment: 'test_fixture' as const,
    evidenceManifestId: evidenceId,
    scope: { scopeKey: 'fixture', description: 'Fixture scope.', dimensions: [], exclusions: [] },
    estimand: 'Fabricated measurability only.',
    cohorts: [
      {
        cohortId: 'fixture-cohort',
        description: 'Fixture cohort.',
        dimensions: [{ name: 'season', values: ['2025'] }],
      },
    ],
    measures: [
      {
        measureId: 'coverage',
        category: 'coverage' as const,
        description: 'Fixture coverage.',
        numeratorDefinition: 'Observed fixtures.',
        denominatorDefinition: 'Expected fixtures.',
        cohortIds: ['fixture-cohort'],
        requiredForApproval: true,
        minimumRatio: { numerator: '1', denominator: '1' },
      },
    ],
    nullZeroSemantics: [
      {
        field: 'player_name',
        unknownMeaning: 'Missing fixture.',
        observedZeroMeaning: 'Explicit fixture zero.',
      },
    ],
    candidateWindows: {
      train: { from: '2020-01-01T00:00:00.000Z', to: '2021-01-01T00:00:00.000Z' },
      calibration: { from: '2021-01-01T00:00:00.000Z', to: '2022-01-01T00:00:00.000Z' },
      validation: { from: '2022-01-01T00:00:00.000Z', to: '2023-01-01T00:00:00.000Z' },
      finalTest: { from: '2023-01-01T00:00:00.000Z', to: '2024-01-01T00:00:00.000Z' },
      embargoDays: 0,
    },
    exclusions: [],
    proposedAt: '2026-08-02T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const protocolId = createAflTradeContentAddress('data-sufficiency-protocol', protocolContent);
  const reportContent = {
    schemaVersion: 'afl-trade-coverage-report/v1' as const,
    protocolId,
    evidenceManifestId: evidenceId,
    environment: 'test_fixture' as const,
    sourceRegisterIds: ['fixture-source'],
    measurementStartedAt: '2026-08-03T00:00:00.000Z',
    measurementCompletedAt: '2026-08-03T01:00:00.000Z',
    createdAt: '2026-08-03T01:00:01.000Z',
    observations: [
      {
        measureId: 'coverage',
        cohortId: 'fixture-cohort',
        status: 'measured' as const,
        observedRatio: { numerator: '1', denominator: '1' },
        supportingArtifacts: [artifact('e')],
      },
    ],
    findings: [],
    excludedCohorts: [],
  };
  const reportId = createAflTradeContentAddress('coverage-report', reportContent);
  const corpusId = `corpus:${digest('4')}`;
  const datasetId = `dataset:${digest('1')}`;
  const run = modelRun();
  const candidate = publication({
    ...publicationContent(run),
    validationReportArtifact:
      run.content.outcome.status === 'succeeded'
        ? run.content.outcome.validationReportArtifact
        : artifact('3'),
    modelCardArtifact:
      run.content.outcome.status === 'succeeded'
        ? run.content.outcome.modelCardArtifact
        : artifact('4'),
  });
  const projectionValue = projectionContent(candidate);
  const build = aflTradeProjectionManifestSchema.parse({
    projectionId: createAflTradeContentAddress('projection', projectionValue),
    content: projectionValue,
  });
  const gate0a = gatePair('gate_0a_permission_to_evaluate', '5', [
    { kind: 'source_rights', artifactId: rightsId },
  ]);
  const gate0b = gatePair('gate_0b_data_sufficiency', '6', [
    { kind: 'data_sufficiency_protocol', artifactId: protocolId },
    { kind: 'coverage_report', artifactId: reportId },
  ]);
  const architecture = architectureArtifacts();
  const gate1 = gatePair('gate_1_architecture_authority', 'b', [
    { kind: 'architecture_current_state', artifactId: architecture.currentState.snapshotId },
    { kind: 'architecture_decision_package', artifactId: architecture.decisionPackage.packageId },
  ]);
  const gate2 = gatePair('gate_2_corpus_lineage', '7', [
    { kind: 'corpus_manifest', artifactId: corpusId },
  ]);
  const gate3 = gatePair('gate_3_model_validity', 'e', [
    { kind: 'model_run', artifactId: run.runId },
  ]);
  return {
    ledger: {
      proposals: [gate0a.proposal, gate0b.proposal, gate1.proposal, gate2.proposal, gate3.proposal],
      decisions: [gate0a.decision, gate0b.decision, gate1.decision, gate2.decision, gate3.decision],
    } as unknown as AflTradeGateDecisionLedger,
    environment: 'test_fixture',
    evaluatedAt: '2026-08-10T00:00:00.000Z',
    sourceRights: [
      { rightsArtifactId: rightsId, content: { registerId: 'fixture-source' } } as never,
    ],
    gate0aReceipts: [
      {
        receiptId,
        content: {
          request: {
            rightsArtifactId: rightsId,
            operations: ['bounded_evaluation_capture'],
            fieldUses: [{ sourceField: 'player_name', use: 'archive_fact' }],
          },
          result: { status: 'mechanically_eligible', decisionId: gate0a.decision.decisionId },
          recordedAt: '2026-08-01T01:00:00.000Z',
        },
      } as never,
    ],
    evidence: {
      manifestId: evidenceId,
      content: {
        environment: 'test_fixture',
        createdAt: '2026-08-02T00:00:00.000Z',
        sourceAuthorizations: [
          {
            authorizationId: 'fixture-auth',
            sourceRegisterId: 'fixture-source',
            rightsArtifactId: rightsId,
            gate0aDecisionId: gate0a.decision.decisionId,
            gate0aReceiptId: receiptId,
          },
        ],
        items: [
          {
            evidenceItemId: `evidence-item:${digest('8')}`,
            content: {
              authorizationId: 'fixture-auth',
              sourceRegisterId: 'fixture-source',
              capturedFields: ['player_name'],
              retrievedAt: '2026-08-01T02:00:00.000Z',
            },
          },
        ],
      },
    } as never,
    dataSufficiencyProtocol: { protocolId, content: protocolContent },
    coverageReport: { reportId, content: reportContent },
    architectureCurrentState: architecture.currentState,
    architectureDecisionPackage: architecture.decisionPackage,
    corpus: {
      corpusId,
      content: {
        evidenceManifestId: evidenceId,
        dataSufficiencyProtocolId: protocolId,
        coverageReportId: reportId,
        gate0bDecisionId: gate0b.decision.decisionId,
        architectureCurrentStateId: architecture.currentState.snapshotId,
        architectureDecisionPackageId: architecture.decisionPackage.packageId,
        gate1DecisionId: gate1.decision.decisionId,
        sourceRegisterIds: ['fixture-source'],
        environment: 'test_fixture',
        createdAt: '2026-08-04T00:00:00.000Z',
      },
    } as never,
    dataset: {
      datasetId,
      content: {
        corpusId,
        gate2DecisionId: gate2.decision.decisionId,
        sourceRegisterIds: ['fixture-source'],
        environment: 'test_fixture',
        createdAt: '2026-08-05T00:00:00.000Z',
        featureDefinitionArtifacts: run.content.featureDefinitionArtifacts,
      },
    } as never,
    modelRun: run,
    publication: {
      ...candidate,
      content: { ...candidate.content, gate3DecisionId: gate3.decision.decisionId },
    } as never,
    projection: build,
  };
}

describe('AFL trade-intelligence model, publication, and projection artifacts', () => {
  it('accepts one complete authorization-aware provenance DAG', () => {
    expect(validateAflTradeManifestProvenance(validProvenanceInput())).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('treats feature-definition artifacts as an order-independent multiset', () => {
    const input = validProvenanceInput();
    const reordered = {
      ...input,
      dataset: {
        ...input.dataset,
        content: {
          ...input.dataset.content,
          featureDefinitionArtifacts: [
            ...input.dataset.content.featureDefinitionArtifacts,
          ].reverse(),
        },
      },
    };

    expect(validateAflTradeManifestProvenance(reordered)).toEqual({ valid: true, issues: [] });
  });

  it('reports independent provenance failures in stable validation order', () => {
    const input = validProvenanceInput();
    input.dataset.content.corpusId = `corpus:${digest('d')}`;
    input.publication.content.sourceRegisterIds = ['other-source'];
    input.projection.content.environment = 'non_production';
    input.projection.content.createdAt = '2026-08-05T12:00:00.000Z';

    expect(validateAflTradeManifestProvenance(input)).toEqual({
      valid: false,
      issues: [
        {
          code: 'parent_mismatch',
          subject: input.dataset.datasetId,
          message: 'Dataset must reference the exact corpus.',
        },
        {
          code: 'source_set_mismatch',
          subject: input.publication.publicationId,
          message: 'Artifact source set differs from evidence.',
        },
        {
          code: 'environment_mismatch',
          subject: input.environment,
          message: 'Artifact environments must match.',
        },
        {
          code: 'chronology_invalid',
          subject: input.projection.projectionId,
          message: `${input.projection.projectionId} predates ${input.publication.publicationId}.`,
        },
      ],
    });
  });

  it('requires the exact Gate 1 architecture decision in the corpus provenance chain', () => {
    const input = validProvenanceInput();
    const gate1DecisionId = input.corpus.content.gate1DecisionId;
    input.ledger = {
      proposals: input.ledger.proposals.filter(
        (proposal) => proposal.content.gate !== 'gate_1_architecture_authority'
      ),
      decisions: input.ledger.decisions.filter(
        (decision) => decision.decisionId !== gate1DecisionId
      ),
    };

    expect(validateAflTradeManifestProvenance(input).issues).toContainEqual(
      expect.objectContaining({ code: 'decision_invalid', subject: gate1DecisionId })
    );
  });
  it('builds an acyclic model-run, publication, and projection chain', () => {
    const run = modelRun();
    const candidate = publication(publicationContent(run));
    const projectionContentValue = projectionContent(candidate);
    const projection = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', projectionContentValue),
      content: projectionContentValue,
    });

    expect(candidate.content.modelRunId).toBe(run.runId);
    expect(projection.content.publicationId).toBe(candidate.publicationId);
  });

  it('requires a clean source tree for a reproducible model run', () => {
    const content = { ...runContent(), cleanWorktree: false };
    expect(
      aflTradeModelRunManifestSchema.safeParse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).success
    ).toBe(false);
  });

  it('records failed runs without allowing them to impersonate successful output', () => {
    const content = {
      ...runContent(),
      outcome: {
        status: 'failed' as const,
        failureClassification: 'validation_failure' as const,
        failureArtifact: artifact('e'),
        diagnosticsArtifact: artifact('f'),
      },
    };

    expect(
      aflTradeModelRunManifestSchema.parse({
        runId: createAflTradeContentAddress('model-run', content),
        content,
      }).content.outcome.status
    ).toBe('failed');

    const impersonatingContent = {
      ...content,
      outcome: { ...content.outcome, modelArtifact: artifact('a') },
    };
    expect(
      aflTradeModelRunManifestSchema.safeParse({
        runId: createAflTradeContentAddress('model-run', impersonatingContent),
        content: impersonatingContent,
      }).success
    ).toBe(false);
  });

  it('rejects a forward projection reference from a publication manifest', () => {
    const content = publicationContent();
    const invalidContent = { ...content, projectionId: `projection:${digest('f')}` };

    expect(
      aflTradePublicationManifestSchema.safeParse({
        publicationId: createAflTradeContentAddress('publication', invalidContent),
        content: invalidContent,
      }).success
    ).toBe(false);
  });

  it('rejects publication and projection content altered after hashing', () => {
    const candidate = publication();
    const content = projectionContent(candidate);
    const projection = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', content),
      content,
    });

    expect(
      aflTradePublicationManifestSchema.safeParse({
        ...candidate,
        content: { ...candidate.content, entryCount: 11 },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionManifestSchema.safeParse({
        ...projection,
        content: { ...projection.content, documentCount: 11 },
      }).success
    ).toBe(false);
  });

  it('fails the full provenance boundary immediately for an invalid decision ledger', () => {
    const duplicateProposal = {
      proposalId: 'duplicate',
      content: {
        gate: 'gate_0a_permission_to_evaluate',
        environment: 'test_fixture',
        decisionKey: 'duplicate',
        version: 1,
      },
    };
    const input = {
      ledger: {
        proposals: [duplicateProposal, duplicateProposal],
        decisions: [],
      },
    } as unknown as AflTradeManifestProvenanceInput;

    expect(validateAflTradeManifestProvenance(input)).toEqual({
      valid: false,
      issues: [
        {
          code: 'invalid_ledger',
          subject: 'ledger',
          message: 'The gate decision ledger is invalid.',
        },
      ],
    });
  });
});
