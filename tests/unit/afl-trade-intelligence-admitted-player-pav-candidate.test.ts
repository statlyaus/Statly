import { beforeAll, describe, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import {
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import {
  fitAflTradeAdmittedPlayerPavCandidate,
  restoreAflTradeAdmittedPlayerPavCandidate,
} from '@/server/aflTradeIntelligence/modeling/admittedPlayerPavCandidate';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';

describe('native admitted PAV numerical candidate', () => {
  let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;
  beforeAll(async () => {
    fixture = await admittedPavModelRunFixture();
  }, 30_000);

  function parents() {
    const configuration = {
      schemaVersion: 'afl-trade-admitted-player-pav-fit-config/v1',
      candidate: { kind: 'ridge', historySeasons: 1, penalty: 1 },
    };
    const configurationBytes = new TextEncoder().encode(canonicalizeAflTradeJson(configuration));
    const intent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      configurationArtifact: createAflTradeCanonicalJsonArtifactRef(
        configuration,
        fixture.startedAt
      ),
    });
    return {
      intent,
      protocol: fixture.protocol,
      datasetCandidate: fixture.base.dataset,
      observationSet: fixture.observationSet,
      pavObservationSet: fixture.evidence.pavObservationSet,
      hpnMethod: fixture.evidence.hpnMethod,
      configurationBytes,
    };
  }

  it('fits only the selected training observation and restores the same annual predictions', () => {
    const input = parents();
    const candidate = fitAflTradeAdmittedPlayerPavCandidate(input);
    const train = fixture.observationSet.content.observations.filter(
      ({ pavObservation }) => pavObservation.partition === 'train'
    );
    expect(candidate.content.trainingObservationIds).toEqual(
      train.map(({ pavObservation }) => pavObservation.observationId)
    );
    expect(candidate.content.trainingObservationIds).toHaveLength(1);
    expect(candidate.content.pavObservationSetId).toBe(
      fixture.evidence.pavObservationSet.observationSetId
    );
    expect(candidate.content.authorityBoundary).toBe(
      'numerical_fit_only_no_execution_or_qualification_authority'
    );
    const restored = restoreAflTradeAdmittedPlayerPavCandidate(
      JSON.parse(JSON.stringify(candidate)),
      input
    );
    const prediction = restored.predict(train[0]!.pavObservation.observationId);
    expect(prediction.annualPav).toEqual(
      train[0]!.pavObservation.targetValues.map(({ totalPav }) => totalPav)
    );
    expect(prediction.totalPav).toBeCloseTo(
      train[0]!.pavObservation.outcome.state === 'mature_observed'
        ? train[0]!.pavObservation.outcome.contribution
        : NaN
    );
    expect(() => restored.predict('unselected-observation')).toThrow(/selected/);
    for (const { pavObservation } of input.observationSet.content.observations) {
      const selectedPrediction = restored.predict(pavObservation.observationId);
      expect(selectedPrediction.annualPav).toHaveLength(3);
      expect(Number.isFinite(selectedPrediction.totalPav)).toBe(true);
    }
  });

  it('keeps the fitted state unchanged when unselected observations and nontraining targets change', () => {
    const input = parents();
    const trainingIds = new Set(
      input.observationSet.content.observations
        .filter(({ pavObservation }) => pavObservation.partition === 'train')
        .map(({ pavObservation }) => pavObservation.observationId)
    );
    // Re-address complete synthetic parents; this numerical test does not issue new admission.
    const changedObservations = input.pavObservationSet.content.observations.map((observation) => {
      if (trainingIds.has(observation.observationId)) return observation;
      if (observation.outcome.state !== 'mature_observed')
        throw new Error('Expected mature fixture');
      return createAflTradePlayerPavObservation({
        ...observation,
        targetValues: observation.targetValues.map((value) => ({
          ...value,
          offensivePav: value.offensivePav + 100,
          totalPav: value.totalPav + 100,
        })),
        outcome: {
          ...observation.outcome,
          contribution: observation.outcome.contribution + observation.targetValues.length * 100,
        },
      });
    });
    const replacementIds = new Map(
      input.pavObservationSet.content.observations.map((observation, index) => [
        observation.observationId,
        changedObservations[index]!.observationId,
      ])
    );
    const pavObservationSet = createAflTradePlayerPavObservationSet({
      ...input.pavObservationSet.content,
      observations: changedObservations,
    });
    const originalArtifact = createAflTradeCanonicalJsonArtifactRef(
      pavObservationSet,
      pavObservationSet.content.createdAt
    );
    const rows = input.datasetCandidate.content.rows.map((row) =>
      createAflTradeValuationDatasetRow({
        ...row.content,
        pavObservationId: replacementIds.get(row.content.pavObservationId!)!,
      })
    );
    const datasetCandidate = createAflTradeValuationDatasetCandidate({
      ...input.datasetCandidate.content,
      rows,
      datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
        rows,
        input.datasetCandidate.content.createdAt
      ),
      pavObservationSet: {
        ...input.datasetCandidate.content.pavObservationSet!,
        observationSetId: pavObservationSet.observationSetId,
        artifact: originalArtifact,
      },
    });
    const protocol = createAflTradePlayerPavModelProtocol({
      ...input.protocol.content,
      datasetId: datasetCandidate.datasetId,
      sourceObservationSet: {
        observationSetId: pavObservationSet.observationSetId,
        artifact: originalArtifact,
      },
    });
    const observationSet = createAflTradePlayerObservationSetV3({
      candidate: datasetCandidate,
      datasetAdmissionId: input.intent.content.datasetAdmissionId,
      modelProtocolId: protocol.protocolId,
      pavObservationSet,
    });
    const intent = createAflTradeModelRunIntent({
      ...input.intent.content,
      datasetId: datasetCandidate.datasetId,
      modelProtocolId: protocol.protocolId,
      observationSetId: observationSet.observationSetId,
    });
    const changed = {
      ...input,
      intent,
      protocol,
      datasetCandidate,
      observationSet,
      pavObservationSet,
    };
    const originalFit = fitAflTradeAdmittedPlayerPavCandidate(input);
    const changedFit = fitAflTradeAdmittedPlayerPavCandidate(changed);
    expect(changedFit.content.fitState).toEqual(originalFit.content.fitState);
    expect(changedFit.content.trainingObservationIds).toEqual(
      originalFit.content.trainingObservationIds
    );
    expect(changedFit.candidateId).not.toBe(originalFit.candidateId);
    expect(changedFit.content.pavObservationSetId).not.toBe(
      originalFit.content.pavObservationSetId
    );
  });

  it('rejects changed configuration bytes and stale original content addresses', () => {
    const input = parents();
    expect(() =>
      fitAflTradeAdmittedPlayerPavCandidate({
        ...input,
        configurationBytes: new TextEncoder().encode('{}'),
      })
    ).toThrow(/configuration bytes/);
    const changed = structuredClone(input);
    changed.pavObservationSet.content.createdAt = '2026-09-03T00:00:00.000Z';
    expect(() => fitAflTradeAdmittedPlayerPavCandidate(changed)).toThrow();
  });

  it('rejects fitted state tampering and restoration against a different exact intent', () => {
    const input = parents();
    const candidate = fitAflTradeAdmittedPlayerPavCandidate(input);
    const changed = structuredClone(candidate);
    if (changed.content.fitState.content.kind !== 'ridge') throw new Error('Expected ridge');
    changed.content.fitState.content.targetMeans[0] += 1;
    expect(() => restoreAflTradeAdmittedPlayerPavCandidate(changed, input)).toThrow();
    const intent = createAflTradeModelRunIntent({
      ...input.intent.content,
      seed: input.intent.content.seed + 1,
    });
    expect(() =>
      restoreAflTradeAdmittedPlayerPavCandidate(candidate, { ...input, intent })
    ).toThrow(/exact parents/);
  });
});
