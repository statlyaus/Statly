import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeGateDecisionRecordSchema } from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { authenticateGovernedReadyComponentAuthority } from '@/server/aflTradeIntelligence/valuation/internal/governedReadyComponentAuthority';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';

const capturedAt = '2026-08-20T10:00:00.000Z';
const createdAt = '2026-08-20T09:00:00.000Z';

function artifact(label: string) {
  const contentSha256 = createAflTradeContentAddress('artifact', label).split(':')[1]!;
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

function fixture() {
  const protocolId = createAflTradeContentAddress('model-protocol', { fixture: 'player' });
  const datasetId = createAflTradeContentAddress('dataset', { fixture: 'player' });
  const datasetAdmissionId = createAflTradeContentAddress('dataset-admission', {
    fixture: 'player',
  });
  const run = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'player_contribution_and_availability',
    nativeExecution: {
      kind: 'admitted_player_model_run',
      executionId: createAflTradeContentAddress('model-run', { fixture: 'native-player' }),
      artifact: artifact('native-player'),
    },
    protocolId,
    protocolArtifact: artifact('player-protocol'),
    datasetId,
    datasetArtifact: artifact('player-dataset'),
    datasetAdmissionId,
    datasetAdmissionArtifact: artifact('player-admission'),
    datasetAdmissionGateLedgerRevision: 11,
    registeredAt: createdAt,
  });
  const runArtifact = createAflTradeCanonicalJsonArtifactRef(run, createdAt);
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: createAflTradeContentAddress('gate-proposal', { fixture: 'player-gate3' }),
    gate: 'gate_3_model_validity' as const,
    decisionKey: 'private-player-component-run-v1',
    version: 2,
    environment: 'non_production' as const,
    scope: {
      scopeKey: 'afl-men:2025-trades',
      description: 'Player component model validity.',
      dimensions: [],
      exclusions: [],
    },
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: 'statly-model-owner',
    decidedBy: 'statly-independent-reviewer',
    reviewers: [],
    authorityEvidenceIds: [artifact('review-evidence').artifactId],
    conditionResults: [],
    rationale: 'Independent review accepted this exact component envelope.',
    limitations: ['Private non-production calculation only.'],
    decidedAt: '2026-08-20T09:10:00.000Z',
    effectiveAt: '2026-08-20T09:15:00.000Z',
    revalidateAt: '2026-09-20T09:15:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: [{ kind: 'model_run' as const, artifactId: run.runId }],
    withdrawalActions: [],
  };
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return {
    run: { manifest: run, artifact: runArtifact },
    traceComponent: {
      role: run.content.role,
      runId: run.runId,
      protocolId,
      datasetId,
      datasetAdmissionId,
      gate3DecisionId: gate3Decision.decisionId,
      evidence: {
        runManifest: runArtifact,
        protocol: run.content.protocolArtifact,
        datasetAdmission: run.content.datasetAdmissionArtifact,
        gate3Decision: createAflTradeCanonicalJsonArtifactRef(
          gate3Decision,
          gate3Decision.content.decidedAt!
        ),
      },
    },
    gate3Decision,
  };
}

function replaceDecision(
  value: ReturnType<typeof fixture>,
  content: typeof value.gate3Decision.content
) {
  const gate3Decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
  const gate3DecisionArtifact = createAflTradeCanonicalJsonArtifactRef(
    gate3Decision,
    gate3Decision.content.decidedAt!
  );
  return {
    ...value,
    traceComponent: {
      ...value.traceComponent,
      gate3DecisionId: gate3Decision.decisionId,
      evidence: { ...value.traceComponent.evidence, gate3Decision: gate3DecisionArtifact },
    },
    gate3Decision,
    gate3DecisionArtifact,
  };
}

describe('governed ready component authority', () => {
  it('returns only exact current externally reviewed Gate 3 authority', () => {
    const value = fixture();
    expect(
      authenticateGovernedReadyComponentAuthority({
        ...value,
        gate3DecisionArtifact: value.traceComponent.evidence.gate3Decision,
        gate3IsCurrent: true,
        gateLedgerRevision: 19,
        capturedAt,
      })
    ).toEqual({
      role: value.traceComponent.role,
      runId: value.traceComponent.runId,
      protocolId: value.traceComponent.protocolId,
      datasetId: value.traceComponent.datasetId,
      datasetAdmissionId: value.traceComponent.datasetAdmissionId,
      datasetAdmissionGateLedgerRevision: 11,
      gate3DecisionId: value.gate3Decision.decisionId,
      gate3DecisionVersion: 2,
    });
  });

  it('rejects superseded, expired, and fixture-only review authority', () => {
    const value = fixture();
    const common = {
      ...value,
      gate3DecisionArtifact: value.traceComponent.evidence.gate3Decision,
      gateLedgerRevision: 19,
      capturedAt,
    };
    expect(() =>
      authenticateGovernedReadyComponentAuthority({ ...common, gate3IsCurrent: false })
    ).toThrow(/current/i);

    const expired = replaceDecision(value, {
      ...value.gate3Decision.content,
      revalidateAt: capturedAt,
    });
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        ...expired,
        gate3IsCurrent: true,
      })
    ).toThrow(/current|revalidation/i);

    const fixtureOnly = replaceDecision(value, {
      ...value.gate3Decision.content,
      authorityKind: 'fixture',
    });
    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        ...common,
        ...fixtureOnly,
        gate3IsCurrent: true,
      })
    ).toThrow(/external human/i);
  });

  it('rejects a legacy pick fixture wrapper even when a Gate 3 record names it', () => {
    const value = fixture();
    const legacyPickRun = createGovernedValuationComponentRunManifest({
      ...value.run.manifest.content,
      role: 'draft_pick_and_future_pick_distribution',
      nativeExecution: {
        kind: 'pick_pav_model_execution',
        executionId: createAflTradeContentAddress('pick-pav-model-execution', {
          fixture: 'legacy-pick',
        }),
        artifact: artifact('legacy-pick'),
      },
    });
    const runArtifact = createAflTradeCanonicalJsonArtifactRef(legacyPickRun, createdAt);
    const replaced = replaceDecision(value, {
      ...value.gate3Decision.content,
      affectedArtifacts: [{ kind: 'model_run', artifactId: legacyPickRun.runId }],
    });

    expect(() =>
      authenticateGovernedReadyComponentAuthority({
        traceComponent: {
          role: legacyPickRun.content.role,
          runId: legacyPickRun.runId,
          protocolId: legacyPickRun.content.protocolId,
          datasetId: legacyPickRun.content.datasetId,
          datasetAdmissionId: legacyPickRun.content.datasetAdmissionId,
          gate3DecisionId: replaced.gate3Decision.decisionId,
          evidence: {
            runManifest: runArtifact,
            protocol: legacyPickRun.content.protocolArtifact,
            datasetAdmission: legacyPickRun.content.datasetAdmissionArtifact,
            gate3Decision: replaced.gate3DecisionArtifact,
          },
        },
        run: { manifest: legacyPickRun, artifact: runArtifact },
        gate3Decision: replaced.gate3Decision,
        gate3DecisionArtifact: replaced.gate3DecisionArtifact,
        gate3IsCurrent: true,
        gateLedgerRevision: 19,
        capturedAt,
      })
    ).toThrow(/governed|fixture|eligible/i);
  });
});
