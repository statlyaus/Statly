import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeAdmittedPlayerRunStartReceipts } from '@/server/aflTradeIntelligence/development/localPostgresAdmittedPlayerPreparation';
import {
  createAflTradeAdmittedPlayerContributionExecutor,
  loadGovernedScalarTransform,
  materializeAflTradeAdmittedPlayerContributionSet,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';

import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';

const transform = {
  schemaVersion: 'afl-trade-player-scalar-transform/v1' as const,
  valueUnitId: 'afl-contribution-index',
  weights: { brownlow_votes: 2, coaches_votes: 1.5, games: 1, goals: 0.5 },
};

function executableArtifact(reference: ReturnType<typeof createAflTradeCanonicalJsonArtifactRef>) {
  return {
    artifactId: reference.artifactId,
    bytes: new TextEncoder().encode(canonicalizeAflTradeJson(transform)),
  };
}

describe('admitted player contribution candidate', () => {
  it('loads only the scalar transform bound to the protocol value unit', async () => {
    const reference = createAflTradeCanonicalJsonArtifactRef(transform, '2026-08-26T00:00:00.000Z');
    const protocol = {
      content: {
        valueUnit: { valueUnitId: transform.valueUnitId },
        scalarValueTransformArtifact: reference,
      },
    } as never;

    expect(
      loadGovernedScalarTransform({
        protocol,
        executableArtifacts: [executableArtifact(reference)],
      })
    ).toEqual(transform);
  });

  it('rejects a transform whose governed unit differs from the protocol', async () => {
    const reference = createAflTradeCanonicalJsonArtifactRef(transform, '2026-08-26T00:00:00.000Z');
    const protocol = {
      content: {
        valueUnit: { valueUnitId: 'different-unit' },
        scalarValueTransformArtifact: reference,
      },
    } as never;

    expect(() =>
      loadGovernedScalarTransform({
        protocol,
        executableArtifacts: [executableArtifact(reference)],
      })
    ).toThrow('does not match the model value unit');
  });

  it('rejects an admitted observation that omits a scalar feature metric', () => {
    const fixture = admittedRunFixture('non_production');
    const first = fixture.observationSet.content.observations[0]!;
    const featureArtifactId = fixture.protocol.content.pointInTimeFeatureValuesArtifact!.artifactId;
    const featureArtifact = fixture.evidence.executableArtifacts.find(
      ({ artifactId }) => artifactId === featureArtifactId
    )!;
    const omittedMemberId = first.featureInputs[0]!.memberId;
    const featureSet = JSON.parse(new TextDecoder().decode(featureArtifact.bytes));
    featureSet.rows = featureSet.rows.map((row: { datasetRowId: string; values: unknown[] }) =>
      row.datasetRowId === first.datasetRowId
        ? {
            ...row,
            values: row.values.filter(
              (value) => (value as { memberId: string }).memberId !== omittedMemberId
            ),
          }
        : row
    );

    expect(() =>
      materializeAflTradeAdmittedPlayerContributionSet({
        observationSet: {
          ...fixture.observationSet,
          content: {
            ...fixture.observationSet.content,
            observations: [
              {
                ...first,
                featureInputs: first.featureInputs.filter(
                  ({ memberId }) => memberId !== omittedMemberId
                ),
              },
              ...fixture.observationSet.content.observations.slice(1),
            ],
          },
        } as never,
        transform,
        featureSet,
        spellMetrics: fixture.evidence.spellMetrics,
      })
    ).toThrow(
      /Every scalar feature metric requires one authenticated complete or explicit-zero fact/u
    );
  });

  it('retains the complete accepted candidate ancestry when declared thresholds pass', async () => {
    const fixture = admittedRunFixture('non_production', undefined, {
      predictiveFeatures: true,
    });
    const retained = new Map<string, Uint8Array>();
    const repository = {
      assurance: 'local_non_production_filesystem' as const,
      artifactClass: 'derived_private' as const,
      custodyProfile: null,
      async putIfAbsent(reference: { artifactId: string }, bytes: Uint8Array) {
        retained.set(reference.artifactId, bytes);
        return { status: 'stored' as const, reference };
      },
      async loadExact(reference: { artifactId: string }) {
        const bytes = retained.get(reference.artifactId);
        return bytes === undefined ? null : { reference, bytes };
      },
    };
    const times = [
      '2026-08-10T00:03:01.000Z',
      '2026-08-10T00:03:02.000Z',
      '2026-08-10T00:03:03.000Z',
    ];
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: repository as never,
      maximumArtifactBytes: 4 * 1024 * 1024,
      now: () => times.shift()!,
    });

    const result = await executor.execute({
      intent: fixture.intent,
      authorization: {} as never,
      protocol: fixture.protocol,
      observationSet: fixture.observationSet,
      spellMetrics: fixture.evidence.spellMetrics,
      executableArtifacts: fixture.evidence.executableArtifacts,
    });

    expect(result).toMatchObject({
      candidateLockedAt: '2026-08-10T00:03:01.000Z',
      finalTestEvaluatedAt: '2026-08-10T00:03:02.000Z',
      finishedAt: '2026-08-10T00:03:03.000Z',
      outcome: { status: 'succeeded' },
    });
    if (result.outcome.status !== 'succeeded') throw new Error('Expected an accepted fit.');
    const model = JSON.parse(
      new TextDecoder().decode(retained.get(result.outcome.modelArtifact.artifactId))
    );
    expect(model).toMatchObject({
      schemaVersion: 'afl-trade-admitted-player-candidate/v1',
      sourceObservationSetId: fixture.observationSet.observationSetId,
      scalarTransformArtifactId: fixture.protocol.content.scalarValueTransformArtifact.artifactId,
      pointInTimeFeatureValuesArtifactId:
        fixture.protocol.content.pointInTimeFeatureValuesArtifact?.artifactId,
      configurationArtifactId: fixture.intent.content.configurationArtifact.artifactId,
      trainingPartition: 'train',
      finalTestRetuning: 'prohibited',
    });
    const selectionReport = JSON.parse(
      new TextDecoder().decode(
        retained.get(result.outcome.selectionValidationReportArtifact!.artifactId)
      )
    );
    expect(selectionReport).toMatchObject({
      validationReportId: expect.stringMatching(/^player-validation-report:/u),
      content: {
        evaluatedPartition: 'validation',
        acceptanceOutcome: 'meets_declared_predictive_thresholds',
      },
    });
    expect(retained).toHaveLength(11);
  });

  it('retains a failed run and does not accept a candidate below declared thresholds', async () => {
    const fixture = admittedRunFixture('non_production');
    const configurationReference = fixture.intent.content.configurationArtifact;
    const configurationArtifact = fixture.evidence.executableArtifacts.find(
      ({ artifactId }) => artifactId === configurationReference.artifactId
    )!;
    const configuration = JSON.parse(new TextDecoder().decode(configurationArtifact.bytes));
    configuration.validation.minimumRelativeMaeImprovement = 1;
    configuration.validation.minimumRelativeRmseImprovement = 1;
    const changedReference = createAflTradeCanonicalJsonArtifactRef(
      configuration,
      configurationReference.createdAt
    );
    const changedBytes = new TextEncoder().encode(canonicalizeAflTradeJson(configuration));
    const retained = new Map<string, Uint8Array>();
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: {
        assurance: 'local_non_production_filesystem',
        artifactClass: 'derived_private',
        custodyProfile: null,
        async putIfAbsent(reference, bytes) {
          retained.set(reference.artifactId, bytes);
          return { status: 'stored' as const, reference };
        },
        async loadExact(reference) {
          const bytes = retained.get(reference.artifactId);
          return bytes === undefined ? null : { reference, bytes };
        },
      },
      maximumArtifactBytes: 4 * 1024 * 1024,
      now: () => '2026-08-10T00:03:01.000Z',
    });

    const result = await executor.execute({
      intent: {
        ...fixture.intent,
        content: { ...fixture.intent.content, configurationArtifact: changedReference },
      },
      authorization: {} as never,
      protocol: fixture.protocol,
      observationSet: fixture.observationSet,
      spellMetrics: fixture.evidence.spellMetrics,
      executableArtifacts: fixture.evidence.executableArtifacts
        .filter(({ artifactId }) => artifactId !== configurationReference.artifactId)
        .concat({ artifactId: changedReference.artifactId, bytes: changedBytes }),
    });

    expect(result).toMatchObject({
      candidateLockedAt: null,
      finalTestEvaluatedAt: null,
      outcome: { status: 'failed', failureClassification: 'validation_failure' },
    });
    expect(retained).toHaveLength(2);
    if (result.outcome.status !== 'failed') throw new Error('Expected a rejected candidate.');
    const failure = JSON.parse(
      new TextDecoder().decode(retained.get(result.outcome.failureArtifact.artifactId))
    );
    expect(failure.content.acceptanceOutcome).toBe('does_not_meet_declared_predictive_thresholds');
  });

  it('rejects a hash-correct feature artifact whose value differs from its factual body', async () => {
    const fixture = admittedRunFixture('non_production');
    const featureReference = fixture.protocol.content.pointInTimeFeatureValuesArtifact!;
    const featureArtifact = fixture.evidence.executableArtifacts.find(
      ({ artifactId }) => artifactId === featureReference.artifactId
    )!;
    const featureDocument = JSON.parse(new TextDecoder().decode(featureArtifact.bytes));
    featureDocument.rows[0].values[0].numericValue = '999';
    const changedReference = createAflTradeCanonicalJsonArtifactRef(
      featureDocument,
      featureReference.createdAt
    );
    const changedBytes = new TextEncoder().encode(canonicalizeAflTradeJson(featureDocument));
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: {
        assurance: 'local_non_production_filesystem',
        artifactClass: 'derived_private',
        custodyProfile: null,
        async putIfAbsent(reference) {
          return { status: 'stored' as const, reference };
        },
        async loadExact() {
          return null;
        },
      } as never,
      maximumArtifactBytes: 4 * 1024 * 1024,
      now: () => '2026-08-10T00:03:01.000Z',
    });

    await expect(
      executor.execute({
        intent: fixture.intent,
        authorization: {} as never,
        protocol: {
          ...fixture.protocol,
          content: {
            ...fixture.protocol.content,
            pointInTimeFeatureValuesArtifact: changedReference,
          },
        },
        observationSet: fixture.observationSet,
        spellMetrics: fixture.evidence.spellMetrics,
        executableArtifacts: fixture.evidence.executableArtifacts
          .filter(({ artifactId }) => artifactId !== featureReference.artifactId)
          .concat({ artifactId: changedReference.artifactId, bytes: changedBytes }),
      })
    ).rejects.toThrow('does not match its exact authenticated metric fact');
  });

  it('rejects an executor build that does not bind its declared commit', async () => {
    const fixture = admittedRunFixture('non_production');
    const sourceReference = fixture.intent.content.sourceCodeArtifact;
    const sourceArtifact = fixture.evidence.executableArtifacts.find(
      ({ artifactId }) => artifactId === sourceReference.artifactId
    )!;
    const sourceDocument = JSON.parse(new TextDecoder().decode(sourceArtifact.bytes));
    sourceDocument.codeCommitSha = 'b'.repeat(64);
    const changedReference = createAflTradeCanonicalJsonArtifactRef(
      sourceDocument,
      sourceReference.createdAt
    );
    const changedBytes = new TextEncoder().encode(canonicalizeAflTradeJson(sourceDocument));
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: {} as never,
      maximumArtifactBytes: 4 * 1024 * 1024,
      now: () => '2026-08-10T00:03:01.000Z',
    });

    await expect(
      executor.execute({
        intent: {
          ...fixture.intent,
          content: { ...fixture.intent.content, sourceCodeArtifact: changedReference },
        },
        authorization: {} as never,
        protocol: fixture.protocol,
        observationSet: fixture.observationSet,
        spellMetrics: fixture.evidence.spellMetrics,
        executableArtifacts: fixture.evidence.executableArtifacts
          .filter(({ artifactId }) => artifactId !== sourceReference.artifactId)
          .concat({ artifactId: changedReference.artifactId, bytes: changedBytes }),
      })
    ).rejects.toThrow('does not bind the declared execution ancestry');
  });

  it('issues one run-start rights receipt when admitted captures share exact proposal ancestry', () => {
    const fixture = admittedRunFixture();
    const first = fixture.admission.content.sourceRightsEvaluations[0]!;
    const evaluations = [
      first,
      {
        ...first,
        captureId: 'capture:second-source-capture',
        sourceSnapshotId: createAflTradeContentAddress('source-snapshot', 'second-source-snapshot'),
        consumedFieldSetId: createAflTradeContentAddress(
          'consumed-field-set',
          'second-consumed-field-set'
        ),
      },
    ].sort((left, right) => left.captureId.localeCompare(right.captureId));

    const receipts = createAflTradeAdmittedPlayerRunStartReceipts({
      evaluations,
      admissionReceipts: fixture.evidence.admissionEvaluationReceipts,
      proposals: fixture.evidence.sourceRightsProposals,
      gateLedger: fixture.evidence.gateDecisionLedger,
      startedAt: '2026-08-10T00:03:00.000Z',
    });

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.content.request.evaluatedAt).toBe('2026-08-10T00:03:00.000Z');
  });

  it('rejects captures that share a proposal but disagree on retained request ancestry', () => {
    const fixture = admittedRunFixture();
    const proposal = fixture.evidence.sourceRightsProposals[0]!;
    const original = fixture.evidence.admissionEvaluationReceipts[0]!;
    const conflicting = createAflTradeGate0AReceipt(
      fixture.evidence.gateDecisionLedger,
      proposal,
      {
        ...original.content.request,
        metadataRetentionDays: 364,
        evaluatedAt: '2026-08-10T00:01:01.000Z',
      },
      '2026-08-10T00:01:01.000Z'
    );
    const first = fixture.admission.content.sourceRightsEvaluations[0]!;

    expect(() =>
      createAflTradeAdmittedPlayerRunStartReceipts({
        evaluations: [
          first,
          {
            ...first,
            captureId: 'capture:conflicting-source-capture',
            sourceSnapshotId: createAflTradeContentAddress(
              'source-snapshot',
              'conflicting-source-snapshot'
            ),
            consumedFieldSetId: createAflTradeContentAddress(
              'consumed-field-set',
              'conflicting-consumed-field-set'
            ),
            admissionEvaluationReceiptId: conflicting.receiptId,
            admissionEvaluatedAt: conflicting.content.request.evaluatedAt,
          },
        ].sort((left, right) => left.captureId.localeCompare(right.captureId)),
        admissionReceipts: [original, conflicting],
        proposals: [proposal],
        gateLedger: fixture.evidence.gateDecisionLedger,
        startedAt: '2026-08-10T00:03:00.000Z',
      })
    ).toThrow('source-rights ancestry is inconsistent');
  });
});
