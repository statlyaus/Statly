import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  authenticateGovernedNativeComponentExecution,
  loadGovernedNativeComponentValidationReport,
} from '@/server/aflTradeIntelligence/valuation/internal/governedNativeComponentExecution';
import { createGovernedValuationComponentRunManifest } from '@/server/aflTradeIntelligence/valuation/internal/governedValuationComponentRunManifest';
import { beforeAll } from 'vitest';

import { governedNativePlayerPavComponentFixture } from '../testUtils/governedNativePlayerPavComponentFixture';
import { createGovernedPickPavModelExecutionFixture } from '../testUtils/governedPickPavModelExecutionFixture';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

async function pickFixture() {
  const value = createGovernedPickPavModelExecutionFixture();
  const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
  const nativeArtifact = createAflTradeCanonicalJsonArtifactRef(
    value.execution,
    value.execution.content.completedAt
  );
  await artifacts.putIfAbsent(
    nativeArtifact,
    new TextEncoder().encode(canonicalizeAflTradeJson(value.execution))
  );
  const component = createGovernedValuationComponentRunManifest({
    environment: 'non_production',
    role: 'draft_pick_and_future_pick_distribution',
    nativeExecution: {
      kind: 'governed_pick_pav_model_execution',
      executionId: value.execution.executionId,
      artifact: nativeArtifact,
    },
    protocolId: value.execution.content.protocolId,
    protocolArtifact: value.execution.content.protocolArtifact,
    datasetId: value.execution.content.datasetId,
    datasetArtifact: value.execution.content.datasetArtifact,
    datasetAdmissionId: value.execution.content.datasetAdmissionId,
    datasetAdmissionArtifact: value.execution.content.datasetAdmissionArtifact,
    datasetAdmissionGateLedgerRevision: value.execution.content.datasetAdmissionGateLedgerRevision,
    registeredAt: '2015-01-03T00:00:02.000Z',
  });
  return { ...value, artifacts, component };
}

type NativePlayerFixture = Awaited<ReturnType<typeof governedNativePlayerPavComponentFixture>>;
let retainedV4: NativePlayerFixture;
let retainedV5: NativePlayerFixture;
let retainedV5CustodyTampered: NativePlayerFixture;
let retainedV5SelectionTampered: NativePlayerFixture;

beforeAll(async () => {
  const source = await nativePavModelRunSqlFixture();
  retainedV4 = await governedNativePlayerPavComponentFixture({
    manifestVersion: 'v4',
    finalEvidenceVersion: 'v1',
    source,
  });
  retainedV5 = await governedNativePlayerPavComponentFixture({
    manifestVersion: 'v5',
    finalEvidenceVersion: 'v2',
    source,
  });
  retainedV5CustodyTampered = await governedNativePlayerPavComponentFixture({
    manifestVersion: 'v5',
    finalEvidenceVersion: 'v2',
    source,
    tamper: 'custody_parents',
  });
  retainedV5SelectionTampered = await governedNativePlayerPavComponentFixture({
    manifestVersion: 'v5',
    finalEvidenceVersion: 'v2',
    source,
    tamper: 'outcome_selection_validation',
  });
}, 120_000);

describe('governed native component execution authentication', () => {
  it('authenticates the exact retained governed pick execution', async () => {
    const value = await pickFixture();
    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: value.component,
        artifactRepository: value.artifacts,
        maximumArtifactBytes: 1024 * 1024,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects wrapper ancestry substitution and substituted native bytes', async () => {
    const value = await pickFixture();
    const wrongDataset = createGovernedValuationComponentRunManifest({
      ...value.component.content,
      datasetId: `dataset:${'0'.repeat(64)}`,
    });
    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: wrongDataset,
        artifactRepository: value.artifacts,
        maximumArtifactBytes: 1024 * 1024,
      })
    ).rejects.toThrow(/ancestry|dataset|native/i);

    await expect(
      authenticateGovernedNativeComponentExecution({
        manifest: value.component,
        artifactRepository: {
          ...value.artifacts,
          loadExact: async (reference) => ({
            reference,
            bytes: new TextEncoder().encode('substituted'),
          }),
        },
        maximumArtifactBytes: 1024 * 1024,
      })
    ).rejects.toThrow(/bytes|artifact|native/i);
  });

  it('authenticates retained V4 native player-PAV v1 evidence without qualifying it', async () => {
    const result = await loadGovernedNativeComponentValidationReport({
      manifest: retainedV4.component,
      artifactRepository: retainedV4.artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
    });
    expect(result).toMatchObject({
      kind: 'player_pav_final_evidence',
      execution: retainedV4.execution,
      finalEvidence: retainedV4.finalEvidence,
      qualificationState: 'not_evaluated',
    });
    if (result.kind !== 'player_pav_final_evidence') throw new Error('Expected native PAV.');
    expect(result.finalEvidence.content.schemaVersion).toBe(
      'afl-trade-native-pav-final-evaluation/v1'
    );
  });

  it('authenticates retained V5 native player-PAV v2 evidence and preserves paired scores', async () => {
    const result = await loadGovernedNativeComponentValidationReport({
      manifest: retainedV5.component,
      artifactRepository: retainedV5.artifactRepository,
      maximumArtifactBytes: 16 * 1024 * 1024,
    });
    expect(result.kind).toBe('player_pav_final_evidence');
    if (result.kind !== 'player_pav_final_evidence') throw new Error('Expected native PAV.');
    expect(result.qualificationState).toBe('not_evaluated');
    expect(result.finalEvidence).toEqual(retainedV5.finalEvidence);
    expect(result.finalEvidence.content.schemaVersion).toBe(
      'afl-trade-native-pav-final-evaluation/v2'
    );
    if (result.finalEvidence.content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2')
      throw new Error('Expected v2 final evidence.');
    expect(
      result.finalEvidence.content.baselineComparisons[0]!.pairedScores.length
    ).toBeGreaterThan(0);
  });

  it('rejects a native wrapper with different dataset ancestry', async () => {
    const component = createGovernedValuationComponentRunManifest({
      ...retainedV5.component.content,
      datasetId: `dataset:${'0'.repeat(64)}`,
    });
    await expect(
      loadGovernedNativeComponentValidationReport({
        manifest: component,
        artifactRepository: retainedV5.artifactRepository,
        maximumArtifactBytes: 16 * 1024 * 1024,
      })
    ).rejects.toThrow(/ancestry|dataset|native/i);
  });

  it('rejects missing retained native numerical parents', async () => {
    const missingArtifactId = retainedV5.finalEvidence.content.preFinalArtifact.artifactId;
    await expect(
      loadGovernedNativeComponentValidationReport({
        manifest: retainedV5.component,
        artifactRepository: {
          ...retainedV5.artifactRepository,
          loadExact: (reference, maximumBytes) =>
            reference.artifactId === missingArtifactId
              ? Promise.resolve(null)
              : retainedV5.artifactRepository.loadExact(reference, maximumBytes),
        },
        maximumArtifactBytes: 16 * 1024 * 1024,
      })
    ).rejects.toThrow(/artifact|bytes|native/i);
  });

  it('rejects a missing exact candidate-custody artifact', async () => {
    const custodyArtifactId = retainedV5.execution.content.recovery.checkpoints.find(
      (checkpoint) => checkpoint.content.stage === 'candidate_locked'
    )!.content.evidenceArtifact!.artifactId;
    await expect(
      loadGovernedNativeComponentValidationReport({
        manifest: retainedV5.component,
        artifactRepository: {
          ...retainedV5.artifactRepository,
          loadExact: (reference, maximumBytes) =>
            reference.artifactId === custodyArtifactId
              ? Promise.resolve(null)
              : retainedV5.artifactRepository.loadExact(reference, maximumBytes),
        },
        maximumArtifactBytes: 16 * 1024 * 1024,
      })
    ).rejects.toThrow(/artifact|bytes|custody/i);
  });

  it('rejects missing progress and completion custody artifacts', async () => {
    const required = [
      ...retainedV5.execution.content.recovery.checkpoints
        .filter((checkpoint) =>
          [
            'candidate_fitted',
            'pre_final_retained',
            'validation_plan_retained',
            'final_test_completed',
          ].includes(checkpoint.content.stage)
        )
        .map((checkpoint) => ({
          value: retainedV5,
          artifactId: checkpoint.content.evidenceArtifact!.artifactId,
        })),
      {
        value: retainedV4,
        artifactId: retainedV4.execution.content.recovery.checkpoints.find(
          (checkpoint) => checkpoint.content.stage === 'final_test_completed'
        )!.content.evidenceArtifact!.artifactId,
      },
    ];
    expect(required).toHaveLength(5);
    for (const { value, artifactId: missingArtifactId } of required) {
      await expect(
        loadGovernedNativeComponentValidationReport({
          manifest: value.component,
          artifactRepository: {
            ...value.artifactRepository,
            loadExact: (reference, maximumBytes) =>
              reference.artifactId === missingArtifactId
                ? Promise.resolve(null)
                : value.artifactRepository.loadExact(reference, maximumBytes),
          },
          maximumArtifactBytes: 16 * 1024 * 1024,
        })
      ).rejects.toThrow(/artifact|bytes|custody/i);
    }
  });

  it('rejects exact custody that freezes different pre-final and validation-plan parents', async () => {
    await expect(
      loadGovernedNativeComponentValidationReport({
        manifest: retainedV5CustodyTampered.component,
        artifactRepository: retainedV5CustodyTampered.artifactRepository,
        maximumArtifactBytes: 16 * 1024 * 1024,
      })
    ).rejects.toThrow(/custody|ancestry/i);
  });

  it('rejects an outcome that selects a different validation report', async () => {
    await expect(
      loadGovernedNativeComponentValidationReport({
        manifest: retainedV5SelectionTampered.component,
        artifactRepository: retainedV5SelectionTampered.artifactRepository,
        maximumArtifactBytes: 16 * 1024 * 1024,
      })
    ).rejects.toThrow(/ancestry|validation/i);
  });
});
