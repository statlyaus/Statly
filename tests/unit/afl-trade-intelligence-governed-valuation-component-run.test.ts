import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  authenticateGovernedValuationComponentRunManifest,
  createGovernedValuationComponentRunManifest,
} from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';

const registeredAt = '2026-08-20T10:00:00.000Z';
const retainedAt = '2026-08-20T09:00:00.000Z';
const id = (kind: string, marker: string) => `${kind}:${marker.repeat(64)}`;
const artifact = (label: string) =>
  createAflTradeCanonicalJsonArtifactRef({ label }, retainedAt);

function common() {
  return {
    environment: 'non_production' as const,
    protocolId: id('model-protocol', '1'),
    protocolArtifact: artifact('protocol'),
    datasetId: id('dataset', '2'),
    datasetArtifact: artifact('dataset'),
    datasetAdmissionId: id('dataset-admission', '3'),
    datasetAdmissionArtifact: artifact('dataset-admission'),
    datasetAdmissionGateLedgerRevision: 12,
    registeredAt,
  };
}

describe('governed valuation component run manifest', () => {
  it('normalizes admitted player and pick executions without granting Gate 3', () => {
    const player = createGovernedValuationComponentRunManifest({
      ...common(),
      role: 'player_contribution_and_availability',
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: id('model-run', '4'),
        artifact: artifact('player-run'),
      },
    });
    const pick = createGovernedValuationComponentRunManifest({
      ...common(),
      role: 'draft_pick_and_future_pick_distribution',
      nativeExecution: {
        kind: 'governed_pick_pav_model_execution',
        executionId: id('pick-pav-model-execution', '5'),
        artifact: artifact('pick-run'),
      },
    });

    for (const manifest of [player, pick]) {
      expect(manifest.runId).toMatch(/^model-run:[a-f0-9]{64}$/);
      expect(manifest.content).toMatchObject({
        schemaVersion: 'governed-valuation-component-run/v1',
        environment: 'non_production',
        approvalState: 'gate_3_review_required',
        publicationEligible: false,
      });
      expect(authenticateGovernedValuationComponentRunManifest(manifest)).toEqual(manifest);
    }
    expect(player.content.nativeExecution.kind).toBe('admitted_player_model_run');
    expect(pick.content.nativeExecution.kind).toBe('governed_pick_pav_model_execution');
  });

  it('rejects role substitution and duplicate retained evidence', () => {
    expect(() =>
      createGovernedValuationComponentRunManifest({
        ...common(),
        role: 'draft_pick_and_future_pick_distribution',
        nativeExecution: {
          kind: 'admitted_player_model_run',
          executionId: id('model-run', '4'),
          artifact: artifact('player-run'),
        },
      })
    ).toThrow(/role|execution/i);

    const duplicate = common();
    duplicate.datasetAdmissionArtifact = duplicate.datasetArtifact;
    expect(() =>
      createGovernedValuationComponentRunManifest({
        ...duplicate,
        role: 'player_contribution_and_availability',
        nativeExecution: {
          kind: 'admitted_player_model_run',
          executionId: id('model-run', '4'),
          artifact: artifact('player-run'),
        },
      })
    ).toThrow(/distinct|artifact|evidence/i);
  });

  it('rejects future evidence and changed content under a retained run identity', () => {
    const manifest = createGovernedValuationComponentRunManifest({
      ...common(),
      role: 'draft_pick_and_future_pick_distribution',
      nativeExecution: {
        kind: 'governed_pick_pav_model_execution',
        executionId: id('pick-pav-model-execution', '5'),
        artifact: artifact('pick-run'),
      },
    });
    const tampered = structuredClone(manifest);
    tampered.content.datasetAdmissionGateLedgerRevision = 13;
    expect(() => authenticateGovernedValuationComponentRunManifest(tampered)).toThrow();

    expect(() =>
      createGovernedValuationComponentRunManifest({
        ...common(),
        protocolArtifact: createAflTradeCanonicalJsonArtifactRef(
          { label: 'future-protocol' },
          '2026-08-20T11:00:00.000Z'
        ),
        role: 'draft_pick_and_future_pick_distribution',
        nativeExecution: {
          kind: 'governed_pick_pav_model_execution',
          executionId: id('pick-pav-model-execution', '5'),
          artifact: artifact('pick-run'),
        },
      })
    ).toThrow(/before|future|registered/i);
  });
});
