import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeProjectionManifestSchema,
  aflTradePublicationManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import type { AflTradeGateCode } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  applyAflTradePublicationCommand,
  createAflTradePublicationRegistry,
  getActiveAflTradePublication,
  registerAflTradePublication,
} from '@/server/aflTradeIntelligence/publication/publicationState';

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
    schemaVersion: 'afl-trade-publication/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: 'fixture-current',
    createdAt: '2026-08-01T00:00:00.000Z',
    datasetId: `dataset:${hash('1')}`,
    modelRunId: `model-run:${hash('2')}`,
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

function projection(parent = publication()) {
  const content = {
    schemaVersion: 'afl-trade-projection/v1' as const,
    environment: 'test_fixture' as const,
    scopeKey: parent.content.scopeKey,
    createdAt: '2026-08-01T01:00:00.000Z',
    publicationId: parent.publicationId,
    buildJobId: 'fixture-build',
    responseContractVersion: 'fixture-v1',
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

function ledger(gate: AflTradeGateCode, parent = publication(), build = projection(parent)) {
  const scope = {
    scopeKey: parent.content.scopeKey,
    description: 'Fixture scope.',
    dimensions: [],
    exclusions: [],
  };
  const proposal = {
    proposalId: `gate-proposal:${hash(gate === 'gate_4_publication_api_readiness' ? 'b' : 'c')}`,
    content: {
      gate,
      decisionKey: `${gate}-fixture`,
      version: 1,
      environment: 'test_fixture' as const,
      scope,
      accountableOwner: 'fixture-owner',
      conditions: [],
      reviewRequirement: 'accountable_owner_only' as const,
      requiredReviewerRoles: [],
    },
  };
  const decisionId = `gate-decision:${hash(gate === 'gate_4_publication_api_readiness' ? 'd' : 'e')}`;
  const decision = {
    decisionId,
    content: {
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
    },
  };
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

describe('AFL trade-intelligence publication lifecycle', () => {
  it('registers a validated manifest as an inactive candidate', () => {
    const { manifest, registry } = register();
    expect(registry.publications[manifest.publicationId].state).toBe('candidate');
    expect(getActiveAflTradePublication(registry, manifest.content.scopeKey)).toBeNull();
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
    expect(() =>
      applyAflTradePublicationCommand(registry, {
        action: 'validate',
        publicationId: manifest.publicationId,
        occurredAt: '2026-08-01T02:00:00.000Z',
        actor: 'fixture-reviewer',
        evidenceId: `artifact:${hash('2')}`,
        projectionManifest: wrong,
      })
    ).toThrow();
  });

  it('requires Gate 4 and Gate 5 before atomic activation', () => {
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
  });
});
