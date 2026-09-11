import { beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { createAflTradePlayerObservationSetV3 } from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import { fullPlayerPavDatasetAdmissionFixture } from '../testUtils/playerPavDatasetAdmissionFixture';

describe('admitted PAV observation projection', () => {
  let fixture: Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>>;
  let datasetAdmissionId: string;
  const modelProtocolId = createAflTradeContentAddress('model-protocol', {
    syntheticProjectionReference: 'no-model-approval',
  });

  beforeAll(async () => {
    fixture = await fullPlayerPavDatasetAdmissionFixture();
    const admitted = await new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => fixture.evidence,
    }).admit({ dataset: fixture.dataset, admittedAt: fixture.evidence.authenticatedAt });
    if (admitted.status !== 'admitted') throw new Error(JSON.stringify(admitted));
    datasetAdmissionId = admitted.receipt.admissionId;
  });

  it.each(['featureInputs', 'targetInputs'] as const)(
    'rejects a re-addressed row with an altered %s measurement',
    (field) => {
      const rows = fixture.dataset.content.rows.map((row, index) =>
        index === 0
          ? createAflTradeValuationDatasetRow({
              ...row.content,
              [field]: row.content[field].map((input, ordinal) =>
                ordinal === 0 ? { ...input, recordSha256: 'a'.repeat(64) } : input
              ),
            })
          : row
      );
      const candidate = createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        rows,
        datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
          rows,
          fixture.dataset.content.createdAt
        ),
      });
      expect(() =>
        createAflTradePlayerObservationSetV3({
          candidate,
          datasetAdmissionId,
          modelProtocolId,
          pavObservationSet: fixture.evidence.pavObservationSet,
        })
      ).toThrow(/exact original PAV measurements/);
    }
  );

  it('does not relabel retrospective original observations as point-in-time knowledge', () => {
    const specification = createAflTradeValuationDatasetSpecification({
      ...fixture.dataset.content.specification.content,
      featurePolicy: {
        ...fixture.dataset.content.specification.content.featurePolicy,
        knowledgeJoin: 'point_in_time_as_known_at_prediction_cutoff',
      },
    });
    const content = {
      ...fixture.dataset.content,
      specification,
    };
    const candidate = {
      datasetId: createAflTradeContentAddress('dataset', content),
      content,
    };
    expect(() =>
      createAflTradePlayerObservationSetV3({
        candidate,
        datasetAdmissionId,
        modelProtocolId,
        pavObservationSet: fixture.evidence.pavObservationSet,
      })
    ).toThrow(/Rows must match the candidate competition and factual cutoff/);
  });

  it('rejects a same-player observation from a different prediction origin', () => {
    const first = fixture.dataset.content.rows[0]!;
    const otherOrigin = fixture.evidence.pavObservationSet.content.observations.find(
      (observation) =>
        observation.playerId === first.content.identity.playerId &&
        observation.predictionSeason !== first.content.seasonYear
    );
    expect(otherOrigin).toBeDefined();
    const rows = [
      createAflTradeValuationDatasetRow({
        ...first.content,
        pavObservationId: otherOrigin!.observationId,
      }),
      ...fixture.dataset.content.rows.slice(1),
    ];
    const candidate = createAflTradeValuationDatasetCandidate({
      ...fixture.dataset.content,
      rows,
      datasetArtifact: createAflTradeCanonicalJsonArtifactRef(
        rows,
        fixture.dataset.content.createdAt
      ),
    });
    expect(() =>
      createAflTradePlayerObservationSetV3({
        candidate,
        datasetAdmissionId,
        modelProtocolId,
        pavObservationSet: fixture.evidence.pavObservationSet,
      })
    ).toThrow(/exact original observation/);
  });

  it('projects the four admitted rows without replacing the complete original PAV set', () => {
    const original = structuredClone(fixture.evidence.pavObservationSet);
    const projected = createAflTradePlayerObservationSetV3({
      candidate: fixture.dataset,
      datasetAdmissionId,
      modelProtocolId,
      pavObservationSet: original,
    });
    expect(projected.content.pavObservationSetId).toBe(original.observationSetId);
    expect(projected.content.datasetRowSetSha256).toBe(fixture.dataset.content.rowSetSha256);
    expect(
      projected.content.observations.map(({ pavObservation }) => [
        pavObservation.playerId,
        pavObservation.partition,
        pavObservation.predictionSeason,
      ])
    ).toEqual([
      ['player:a1', 'train', 2005],
      ['player:a2', 'calibration', 2009],
      ['player:b1', 'validation', 2013],
      ['player:b2', 'final_test', 2017],
    ]);
    expect(
      projected.content.observations.map(({ datasetRowId, rowOrdinal }) => [
        datasetRowId,
        rowOrdinal,
      ])
    ).toEqual(fixture.dataset.content.rows.map(({ rowId, content }) => [rowId, content.ordinal]));
    expect(original).toEqual(fixture.evidence.pavObservationSet);
    expect(original.content.observations).toHaveLength(16);
    expect(
      createAflTradePlayerObservationSetV3({
        candidate: fixture.dataset,
        datasetAdmissionId,
        modelProtocolId,
        pavObservationSet: original,
      })
    ).toEqual(projected);
  });
});
