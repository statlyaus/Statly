import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type { AflTradeGateCode } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AflTradePublicationStateError,
  applyAflTradePublicationCommand,
  captureAflTradePublicationRead,
  createAflTradePublicationRegistry,
  getActiveAflTradePublication,
  registerAflTradePublication,
  type AflTradePublicationCommand,
} from '@/server/aflTradeIntelligence/publication/publicationState';
import { createAflTradeProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';

import {
  createAflTradeProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
} from '../fixtures/aflTradeProjectionManifestFixture';

const hash = (value: string) => value.repeat(64);
const artifact = (value: string) => ({
  artifactId: `artifact:${hash(value)}`,
  contentSha256: hash(value),
  storageUri: `artifact://sha256/${hash(value)}`,
  mediaType: 'application/json',
  byteLength: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
});

function publication() {
  const content = {
    schemaVersion: 'afl-trade-publication/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current',
    createdAt: '2026-08-01T00:00:00.000Z',
    valuationBundleId: `valuation-bundle:${hash('1')}`,
    gate3DecisionId: `gate-decision:${hash('3')}`,
    sourceRegisterIds: ['fixture-source'],
    supportedViews: ['current' as const],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: [],
    valueUnitId: 'fixture-unit',
    entryCount: 1,
    publicationBundleArtifact: artifact('4'),
    methodologyArtifact: artifact('5'),
    validationReportArtifact: artifact('6'),
    modelCardArtifact: artifact('7'),
  };
  return aflTradePublicationManifestSchema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
}

function projection(parent = publication(), createdAt = '2026-08-01T01:00:00.000Z') {
  const content = {
    schemaVersion: 'afl-trade-projection/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: parent.content.scopeKey,
    createdAt,
    publicationId: parent.publicationId,
    buildJobId: 'fixture-build',
    responseContractVersion: 'afl-trade-value/v2' as const,
    documentCount: 1,
    projectionArtifact: artifact('8'),
    schemaArtifact: artifact('9'),
    parityReportArtifact: artifact('a'),
  };
  return aflTradeProjectionManifestSchema.parse({
    projectionId: createAflTradeContentAddress('projection', content),
    content,
  });
}

function compactProjectionV2(parent = publication()) {
  const inventoryIndexId = `valuation-output-inventory-index:${hash('b')}`;
  const presentationPolicyId = `projection-presentation-policy:${hash('c')}`;
  const evidenceIndexId = `projection-public-evidence-index:${hash('d')}`;
  const schemaBundleId = `projection-schema-bundle:${hash('e')}`;
  const content = {
    schemaVersion: 'afl-trade-projection/v2' as const,
    environment: 'test_fixture' as const,
    scopeKey: parent.content.scopeKey,
    createdAt: '2026-08-01T00:00:00.000Z',
    publicationId: parent.publicationId,
    buildJobId: 'fixture-build-v2',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    responseContractVersion: 'afl-trade-value/v2' as const,
    valuationExportContractVersion: 'afl-trade-valuation-csv/v1' as const,
    valueUnitId: parent.content.valueUnitId,
    supportedViews: ['at_trade', 'realized', 'remaining', 'current'] as const,
    documentCount: 10,
    valuationOutputInventoryIndex: {
      schemaVersion: 'afl-trade-valuation-output-inventory-index/v1' as const,
      valuationOutputInventoryIndexId: inventoryIndexId,
      artifactRef: artifact('b'),
      entryCount: 1,
      inventorySetSha256: hash('b'),
    },
    freshnessPolicy: {
      schemaVersion: 'afl-trade-publication-freshness-policy/v1' as const,
      freshnessPolicyId: `freshness-policy:${hash('3')}`,
      artifactRef: artifact('3'),
    },
    projectionPresentationPolicy: {
      schemaVersion: 'afl-trade-projection-presentation-policy/v1' as const,
      projectionPresentationPolicyId: presentationPolicyId,
      artifactRef: artifact('c'),
      valueUnitId: parent.content.valueUnitId,
      universalLayer: 'scarcity_adjusted' as const,
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'] as const,
    },
    projectionPublicEvidenceIndex: {
      schemaVersion: 'afl-trade-projection-public-evidence-index/v1' as const,
      projectionPublicEvidenceIndexId: evidenceIndexId,
      artifactRef: artifact('d'),
      publicationId: parent.publicationId,
      valuationOutputInventoryIndexId: inventoryIndexId,
      scopeKey: parent.content.scopeKey,
      valueUnitId: parent.content.valueUnitId,
      indexedEvidenceSchemaVersion: 'afl-trade-projection-public-evidence/v1' as const,
      entryCount: 1,
      evidenceBindingSetSha256: hash('d'),
    },
    projectionMaterialization: {
      schemaVersion: 'afl-trade-projection-materialization/v1' as const,
      projectionMaterializationId: `projection-materialization:${hash('f')}`,
      artifactRef: artifact('f'),
      publicationId: parent.publicationId,
      valuationOutputInventoryIndexId: inventoryIndexId,
      projectionPublicEvidenceIndexId: evidenceIndexId,
      projectionPresentationPolicyId: presentationPolicyId,
      projectionSchemaBundleId: schemaBundleId,
      scopeKey: parent.content.scopeKey,
      valueUnitId: parent.content.valueUnitId,
      calculationAsOf: '2026-08-01T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-01T00:00:00.000Z',
      tradeCount: 1,
      documentCount: 9,
      evidenceTradeSetSha256: hash('a'),
      entrySetSha256: hash('b'),
      shardSetSha256: hash('c'),
    },
    projectionDocumentSet: {
      schemaVersion: 'afl-trade-projection-document-set/v1' as const,
      projectionDocumentSetId: `projection-document-set:${hash('0')}`,
      artifactRef: artifact('0'),
      tradeCount: 1,
      documentCount: 10,
    },
    projectionSchemaBundle: {
      schemaVersion: 'afl-trade-projection-schema-bundle/v1' as const,
      projectionSchemaBundleId: schemaBundleId,
      artifactRef: artifact('e'),
      responseContractVersion: 'afl-trade-value/v2' as const,
      valuationExportContractVersion: 'afl-trade-valuation-csv/v1' as const,
    },
    parityReport: {
      schemaVersion: 'afl-trade-projection-parity-report/v1' as const,
      projectionParityReportId: `projection-parity-report:${hash('2')}`,
      artifactRef: artifact('2'),
      status: 'passed' as const,
      checkCount: 88,
      failureCount: 0 as const,
      checkedDocumentCount: 10,
    },
  };
  return aflTradeProjectionManifestSchema.parse({
    projectionId: createAflTradeContentAddress('projection', content),
    content,
  });
}

function ledger(gate: AflTradeGateCode, parent = publication(), build = projection(parent)) {
  const scope = {
    scopeKey: parent.content.scopeKey,
    description: 'Fixture scope.',
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
    proposal: 'Approve a fabricated publication fixture.',
    alternativesConsidered: ['Keep the fixture inactive.'],
    evidenceIds: [`artifact:${hash('f')}`],
    affectedArtifacts: [
      { kind: 'publication' as const, artifactId: parent.publicationId },
      { kind: 'projection' as const, artifactId: build.projectionId },
    ],
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
    authorityEvidenceIds: [`artifact:${hash('f')}`],
    conditionResults: [],
    rationale: 'Fixture approval.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-01T01:00:00.000Z',
    effectiveAt: '2026-08-01T01:00:00.000Z',
    revalidateAt: '2027-01-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [
      { kind: 'publication' as const, artifactId: parent.publicationId },
      { kind: 'projection' as const, artifactId: build.projectionId },
    ],
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const decisionId = decision.decisionId;
  return {
    decisionId,
    value: {
      proposals: [proposal],
      decisions: [decision],
    } as unknown as AflTradeGateDecisionLedger,
  };
}

function register() {
  const manifest = publication();
  return {
    manifest,
    registry: registerAflTradePublication(createAflTradePublicationRegistry(), {
      manifest,
      actor: 'fixture-worker',
      evidenceId: `artifact:${hash('1')}`,
    }),
  };
}

function published() {
  const { manifest, registry } = register();
  const build = projection(manifest);
  let next = applyAflTradePublicationCommand(registry, {
    action: 'validate',
    publicationId: manifest.publicationId,
    occurredAt: '2026-08-01T02:00:00.000Z',
    actor: 'fixture-reviewer',
    evidenceId: build.projectionId,
    projectionManifest: build,
  });
  const gate4 = ledger('gate_4_publication_api_readiness', manifest, build);
  next = applyAflTradePublicationCommand(next, {
    action: 'approve',
    publicationId: manifest.publicationId,
    occurredAt: '2026-08-01T03:00:00.000Z',
    actor: 'fixture-owner',
    evidenceId: gate4.decisionId,
    gateDecisionId: gate4.decisionId,
    gateDecisionLedger: gate4.value,
    environment: 'test_fixture',
  });
  const gate5 = ledger('gate_5_comprehension_accessibility', manifest, build);
  next = applyAflTradePublicationCommand(next, {
    action: 'publish',
    publicationId: manifest.publicationId,
    occurredAt: '2026-08-01T04:00:00.000Z',
    actor: 'fixture-owner',
    evidenceId: gate5.decisionId,
    gateDecisionId: gate5.decisionId,
    gateDecisionLedger: gate5.value,
    environment: 'test_fixture',
  });
  return { manifest, registry: next };
}

describe('AFL trade-intelligence publication lifecycle', () => {
  it('registers a validated manifest as an inactive candidate', () => {
    const { manifest, registry } = register();
    const record = registry.publications[manifest.publicationId];
    expect(record).toMatchObject({
      state: 'candidate',
      publicationManifestSchemaVersion: manifest.content.schemaVersion,
      valuationBundleId: manifest.content.valuationBundleId,
      valueUnitId: manifest.content.valueUnitId,
      supportedViews: manifest.content.supportedViews,
      supportedCohorts: manifest.content.supportedCohorts,
      excludedCohorts: manifest.content.excludedCohorts,
    });
    expect(getActiveAflTradePublication(registry, manifest.content.scopeKey)).toBeNull();
    expect(captureAflTradePublicationRead(registry, manifest.content.scopeKey)).toBeNull();
  });

  it('requires the matching projection before validation', () => {
    const { manifest, registry } = register();
    const validProjection = projection(manifest);
    const wrongContent = {
      ...validProjection.content,
      publicationId: `publication:${hash('f')}`,
    };
    const wrong = aflTradeProjectionManifestSchema.parse({
      projectionId: createAflTradeContentAddress('projection', wrongContent),
      content: wrongContent,
    });
    try {
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-01T02:00:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: `artifact:${hash('2')}`,
        projectionManifest: wrong,
      });
      throw new Error('Expected the mismatched projection to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(AflTradePublicationStateError);
      expect((error as AflTradePublicationStateError).code).toBe('INVALID_MANIFEST');
    }
  });

  it('rejects a schema-valid compact projection v2 manifest', () => {
    const { manifest, registry } = register();
    const v2Projection = compactProjectionV2(manifest);
    expect(v2Projection.content.schemaVersion).toBe('afl-trade-projection/v2');

    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-01T02:00:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: v2Projection.projectionId,
        projectionManifest: v2Projection,
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });

  it('rejects compact projection v1 for publication v3', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const manifest = fixture.projectionDocumentSetVerification.publicationManifest;
    const compactV1 = projection(manifest, '2026-08-05T10:00:00.000Z');
    const registry = registerAflTradePublication(createAflTradePublicationRegistry(), {
      manifest,
      actor: 'fixture-worker',
      evidenceId: manifest.publicationId,
    });
    const originalRegistry = structuredClone(registry);

    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-05T10:10:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: compactV1.projectionId,
        projectionManifest: compactV1,
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
    expect(registry).toEqual(originalRegistry);
  });

  it('validates projection v2 from a totally replayable authenticated chain', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const manifest = fixture.projectionDocumentSetVerification.publicationManifest;
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const registry = registerAflTradePublication(createAflTradePublicationRegistry(), {
      manifest,
      actor: 'fixture-worker',
      evidenceId: manifest.publicationId,
    });

    const validated = applyAflTradePublicationCommand(registry, {
      action: 'validate',
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-05T10:10:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: output.projectionManifestArtifactRef.artifactId,
      projectionManifestVerification: { ...input, output },
    });

    expect(validated.publications[manifest.publicationId]).toMatchObject({
      state: 'validated',
      projectionId: output.projectionManifest.projectionId,
    });
  });

  it('rejects a valid projection chain against a different registered publication', () => {
    const projectionFixture = createAflTradeProjectionManifestFixture();
    const registeredFixture = createAflTradeProjectionManifestFixture('future_pick_resolution');
    const registeredManifest =
      registeredFixture.projectionDocumentSetVerification.publicationManifest;
    const input = createAflTradeProjectionManifestMaterializationInput(projectionFixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const registry = registerAflTradePublication(createAflTradePublicationRegistry(), {
      manifest: registeredManifest,
      actor: 'fixture-worker',
      evidenceId: registeredManifest.publicationId,
    });
    const originalRegistry = structuredClone(registry);

    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: registeredManifest.publicationId,
        occurredAt: '2026-08-05T10:10:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: output.projectionManifestArtifactRef.artifactId,
        projectionManifestVerification: { ...input, output },
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
    expect(registry).toEqual(originalRegistry);
  });

  it('rejects validate commands with both or neither projection evidence path', () => {
    const { manifest, registry } = register();
    const metadata = {
      action: 'validate' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T02:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: `artifact:${hash('2')}`,
    };

    const both = {
      ...metadata,
      projectionManifest: projection(manifest),
      projectionManifestVerification: {},
    } as unknown as AflTradePublicationCommand;
    const neither = metadata as unknown as AflTradePublicationCommand;

    expect(() => applyAflTradePublicationCommand(registry, both)).toThrow(
      expect.objectContaining({ code: 'INVALID_COMMAND' })
    );
    expect(() => applyAflTradePublicationCommand(registry, neither)).toThrow(
      expect.objectContaining({ code: 'INVALID_COMMAND' })
    );
  });

  it('rejects accessor projection evidence without invoking it', () => {
    const { manifest, registry } = register();
    let invocationCount = 0;
    const command = {
      action: 'validate' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T02:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: `artifact:${hash('2')}`,
    };
    Object.defineProperty(command, 'projectionManifestVerification', {
      enumerable: true,
      get() {
        invocationCount += 1;
        return {};
      },
    });

    expect(() =>
      applyAflTradePublicationCommand(registry, command as unknown as AflTradePublicationCommand)
    ).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));
    expect(invocationCount).toBe(0);
  });

  it('rejects inherited, accessor, and proxy validate-command metadata without invocation', () => {
    const { manifest, registry } = register();
    const originalRegistry = structuredClone(registry);
    const validCommand = {
      action: 'validate' as const,
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T02:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: `artifact:${hash('2')}`,
      projectionManifest: projection(manifest),
    };
    let invocationCount = 0;

    const { action: _action, ...withoutAction } = validCommand;
    const inheritedAction = Object.assign(
      Object.create({
        get action() {
          invocationCount += 1;
          return 'validate';
        },
      }),
      withoutAction
    );
    const { actor: _actor, ...withoutActor } = validCommand;
    const inheritedMetadata = Object.assign(
      Object.create({
        get actor() {
          invocationCount += 1;
          return 'fixture-reviewer';
        },
      }),
      withoutActor
    );
    const accessorAction = { ...withoutAction };
    Object.defineProperty(accessorAction, 'action', {
      enumerable: true,
      get() {
        invocationCount += 1;
        return 'validate';
      },
    });
    const accessorMetadata = { ...withoutActor };
    Object.defineProperty(accessorMetadata, 'actor', {
      enumerable: true,
      get() {
        invocationCount += 1;
        return 'fixture-reviewer';
      },
    });
    const proxied = new Proxy(validCommand, {
      get(target, property, receiver) {
        invocationCount += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        invocationCount += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        invocationCount += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        invocationCount += 1;
        return Reflect.ownKeys(target);
      },
    });

    for (const command of [
      inheritedAction,
      inheritedMetadata,
      accessorAction,
      accessorMetadata,
      proxied,
    ]) {
      expect(() =>
        applyAflTradePublicationCommand(registry, command as unknown as AflTradePublicationCommand)
      ).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));
      expect(registry).toEqual(originalRegistry);
    }
    expect(invocationCount).toBe(0);
  });

  it('rejects projection v1 validation recorded before projection creation', () => {
    const { manifest, registry } = register();
    const build = projection(manifest);
    const originalRegistry = structuredClone(registry);

    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-01T00:30:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: build.projectionId,
        projectionManifest: build,
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
    expect(registry).toEqual(originalRegistry);
  });

  it('rejects projection v2 validation recorded before authenticated projection creation', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const manifest = fixture.projectionDocumentSetVerification.publicationManifest;
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const registry = registerAflTradePublication(createAflTradePublicationRegistry(), {
      manifest,
      actor: 'fixture-worker',
      evidenceId: manifest.publicationId,
    });
    const originalRegistry = structuredClone(registry);

    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-05T09:59:59.000Z',
        actor: 'fixture-reviewer',
        evidenceId: output.projectionManifestArtifactRef.artifactId,
        projectionManifestVerification: { ...input, output },
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
    expect(registry).toEqual(originalRegistry);
  });

  it('requires Gate 4 and Gate 5 before activation', () => {
    const { manifest, registry } = register();
    const build = projection(manifest);
    let next = applyAflTradePublicationCommand(registry, {
      action: 'validate',
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T02:00:00.000Z',
      actor: 'fixture-reviewer',
      evidenceId: build.projectionId,
      projectionManifest: build,
    });
    const gate4 = ledger('gate_4_publication_api_readiness', manifest, build);
    next = applyAflTradePublicationCommand(next, {
      action: 'approve',
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T03:00:00.000Z',
      actor: 'fixture-owner',
      evidenceId: gate4.decisionId,
      gateDecisionId: gate4.decisionId,
      gateDecisionLedger: gate4.value,
      environment: 'test_fixture',
    });
    const gate5 = ledger('gate_5_comprehension_accessibility', manifest, build);
    next = applyAflTradePublicationCommand(next, {
      action: 'publish',
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T04:00:00.000Z',
      actor: 'fixture-owner',
      evidenceId: gate5.decisionId,
      gateDecisionId: gate5.decisionId,
      gateDecisionLedger: gate5.value,
      environment: 'test_fixture',
    });
    expect(getActiveAflTradePublication(next, manifest.content.scopeKey)?.publicationId).toBe(
      manifest.publicationId
    );
    expect(captureAflTradePublicationRead(next, manifest.content.scopeKey)).toEqual({
      publication: {
        publicationId: manifest.publicationId,
        state: 'published',
        valuationBundleId: manifest.content.valuationBundleId,
        valueUnitId: manifest.content.valueUnitId,
        publishedAt: '2026-08-01T04:00:00.000Z',
      },
      projectionBuildId: build.projectionId,
      registryRevision: next.revision,
      scopeKey: manifest.content.scopeKey,
      supportedViews: manifest.content.supportedViews,
      supportedCohorts: manifest.content.supportedCohorts,
      excludedCohorts: manifest.content.excludedCohorts,
    });
  });

  it('fails closed when an active publication has no projection identity', () => {
    const { manifest, registry } = published();
    const record = registry.publications[manifest.publicationId];
    const corrupted = {
      ...registry,
      publications: {
        ...registry.publications,
        [manifest.publicationId]: { ...record, projectionId: null },
      },
    };

    expect(() => captureAflTradePublicationRead(corrupted, manifest.content.scopeKey)).toThrow(
      expect.objectContaining({ code: 'INVALID_ACTIVE_POINTER' })
    );
  });

  it('fails closed on withdrawal instead of silently reactivating old output', () => {
    const { manifest, registry } = published();
    const withdrawn = applyAflTradePublicationCommand(registry, {
      action: 'withdraw',
      publicationId: manifest.publicationId,
      occurredAt: '2026-08-01T05:00:00.000Z',
      actor: 'fixture-owner',
      evidenceId: `artifact:${hash('f')}`,
      reason: 'Fabricated withdrawal for fail-closed testing.',
    });

    expect(withdrawn.publications[manifest.publicationId].state).toBe('withdrawn');
    expect(getActiveAflTradePublication(withdrawn, manifest.content.scopeKey)).toBeNull();
  });

  it('rejects locale-dependent command timestamps with a typed error', () => {
    const { manifest, registry } = register();
    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: 'Aug 1 2026',
        actor: 'fixture-reviewer',
        evidenceId: `artifact:${hash('2')}`,
        projectionManifest: projection(manifest),
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_TIMESTAMP' }));
  });
});
