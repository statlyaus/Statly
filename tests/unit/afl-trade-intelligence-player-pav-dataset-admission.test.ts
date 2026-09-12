import { beforeAll, describe, expect, it } from 'vitest';

import { AflTradeValuationDatasetAdmissionService } from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { fullPlayerPavDatasetAdmissionFixture } from '../testUtils/playerPavDatasetAdmissionFixture';
import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { selectAflTradePlayerPavDatasetObservations } from '@/server/aflTradeIntelligence/modeling/playerPavDatasetSelection';

type Fixture = Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>>;

function withRows(
  fixture: Fixture,
  rows: Fixture['dataset']['content']['rows'],
  overrides: Partial<Fixture['dataset']['content']> = {}
) {
  const datasetArtifact = createAflTradeCanonicalJsonArtifactRef(
    rows,
    fixture.dataset.content.createdAt
  );
  const dataset = createAflTradeValuationDatasetCandidate({
    ...fixture.dataset.content,
    ...overrides,
    rows,
    datasetArtifact,
  });
  const authority = (receipt: Fixture['evidence']['analyticalAuthority']) => {
    const content = { ...receipt.content, datasetId: dataset.datasetId };
    return {
      receiptId: createAflTradeContentAddress('architecture-operation-receipt', content),
      content,
    };
  };
  return {
    dataset,
    evidence: {
      ...fixture.evidence,
      rowAuthorities: rows.map(({ rowId, content }) => ({
        rowId,
        identity: content.identity,
        ...content.lineage,
      })),
      artifactBytes: [
        ...fixture.evidence.artifactBytes.filter(
          ({ artifactId }) => artifactId !== fixture.dataset.content.datasetArtifact.artifactId
        ),
        {
          artifactId: datasetArtifact.artifactId,
          bytes: new TextEncoder().encode(canonicalizeAflTradeJson(rows)),
        },
      ],
      analyticalAuthority: authority(fixture.evidence.analyticalAuthority),
      operationalAuthorization: authority(fixture.evidence.operationalAuthorization),
    },
  };
}

describe('governed player-PAV dataset admission', () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await fullPlayerPavDatasetAdmissionFixture();
  }, 30_000);

  it('admits the original three-season PAV observations without scalar metric substitutes', async () => {
    const service = new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => fixture.evidence,
    });
    const result = await service.admit({
      dataset: fixture.dataset,
      admittedAt: fixture.evidence.authenticatedAt,
    });
    expect(result.status, JSON.stringify(result)).toBe('admitted');
    expect(fixture.evidence.pavObservationSet.content.observations).toHaveLength(16);
    expect(fixture.dataset.content.rows).toHaveLength(4);
    expect(
      fixture.dataset.content.rows.every(({ content }) =>
        [...content.featureInputs, ...content.targetInputs].every(
          ({ kind }) => kind === 'hpn_pav_measurement'
        )
      )
    ).toBe(true);
  });

  it('rejects a re-addressed row substituting the original player measurement hash', async () => {
    const rows = fixture.dataset.content.rows.map((row, index) =>
      index === 0
        ? createAflTradeValuationDatasetRow({
            ...row.content,
            featureInputs: row.content.featureInputs.map((input, ordinal) =>
              ordinal === 0 ? { ...input, recordSha256: 'f'.repeat(64) } : input
            ),
          })
        : row
    );
    const changed = withRows(fixture, rows);
    const result = await new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => changed.evidence,
    }).admit({ dataset: changed.dataset, admittedAt: changed.evidence.authenticatedAt });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'FACTUAL_MEMBERSHIP_MISMATCH' }],
    });
  });

  it('keeps selected player/spell/partition membership independent of coherently re-addressed target values', () => {
    const original = fixture.evidence.pavObservationSet;
    const changed = createAflTradePlayerPavObservationSet({
      ...original.content,
      observations: original.content.observations.map((observation) => {
        if (observation.outcome.state !== 'mature_observed')
          throw new Error('Expected mature fixture observation');
        return createAflTradePlayerPavObservation({
          ...observation,
          targetValues: observation.targetValues.map((value) => ({
            ...value,
            offensivePav: value.offensivePav + 1,
            totalPav: value.totalPav + 1,
          })),
          outcome: {
            ...observation.outcome,
            contribution: observation.outcome.contribution + observation.targetValues.length,
          },
        });
      }),
    });
    const reference = fixture.dataset.content.specification.content.inclusionPolicy;
    const policy = JSON.parse(
      new TextDecoder().decode(
        fixture.evidence.artifactBytes.find(
          ({ artifactId }) => artifactId === reference.artifactId
        )!.bytes
      )
    );
    const selectedKeys = (observationSet: typeof original) => {
      const result = selectAflTradePlayerPavDatasetObservations({
        observationSet,
        corpusLineage: fixture.evidence.corpusLineage,
        inclusionPolicy: { ...policy, observationSetId: observationSet.observationSetId },
      });
      const included = new Set(result.includedObservationIds);
      return observationSet.content.observations
        .filter(({ observationId }) => included.has(observationId))
        .map(({ playerId, acquisitionSpell, partition }) => [
          playerId,
          acquisitionSpell.spellVersionId,
          partition,
        ]);
    };
    expect(changed.observationSetId).not.toBe(original.observationSetId);
    expect(selectedKeys(changed)).toEqual(selectedKeys(original));
    expect(selectedKeys(changed)).toHaveLength(4);
  });

  it('requires training-rights evidence for the league-wide match-result denominator', async () => {
    const resultCapture = fixture.pav.sourceDocuments.find(({ rows }) =>
      rows.some(({ kind }) => kind === 'completed_match_result')
    )!.run.captureId;
    const evidence = {
      ...fixture.evidence,
      sourceRights: fixture.evidence.sourceRights.filter(
        ({ captureId }) => captureId !== resultCapture
      ),
    };
    const result = await new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => evidence,
    }).admit({ dataset: fixture.dataset, admittedAt: evidence.authenticatedAt });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        {
          code: 'SOURCE_RIGHTS_INCOMPLETE',
          subject: fixture.evidence.factualCandidate.candidateId,
          message: expect.any(String),
        },
      ]),
    });
  });

  it('rejects retained inputs whose calculation head revision is no longer current', async () => {
    const evidence = {
      ...fixture.evidence,
      pavMeasurements: fixture.evidence.pavMeasurements.map((proof, index) =>
        index === 0 ? { ...proof, headRevision: proof.headRevision + 1 } : proof
      ),
    };
    const result = await new AflTradeValuationDatasetAdmissionService({
      authenticate: async () => evidence,
    }).admit({ dataset: fixture.dataset, admittedAt: evidence.authenticatedAt });
    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'FACTUAL_MEMBERSHIP_MISMATCH' }],
    });
  });

  it.each(['inclusionPolicy', 'exclusionReport'] as const)(
    'rejects a re-addressed %s that changes the committed selection',
    async (role) => {
      const original =
        role === 'inclusionPolicy'
          ? fixture.dataset.content.specification.content.inclusionPolicy
          : fixture.dataset.content.exclusionReport;
      const bytes = fixture.evidence.artifactBytes.find(
        ({ artifactId }) => artifactId === original.artifactId
      )!.bytes;
      const content = JSON.parse(new TextDecoder().decode(bytes));
      if (role === 'inclusionPolicy') content.selectionRule = 'target_contribution_rank';
      else content.excludedObservations = content.excludedObservations.slice(1);
      const reference = createAflTradeCanonicalJsonArtifactRef(content, original.createdAt);
      const changed = withRows(
        fixture,
        fixture.dataset.content.rows,
        role === 'inclusionPolicy'
          ? {
              specification: createAflTradeValuationDatasetSpecification({
                ...fixture.dataset.content.specification.content,
                inclusionPolicy: reference,
              }),
            }
          : { exclusionReport: reference }
      );
      changed.evidence.artifactBytes = [
        ...changed.evidence.artifactBytes.filter(
          ({ artifactId }) => artifactId !== original.artifactId
        ),
        {
          artifactId: reference.artifactId,
          bytes: new TextEncoder().encode(canonicalizeAflTradeJson(content)),
        },
      ];
      const result = await new AflTradeValuationDatasetAdmissionService({
        authenticate: async () => changed.evidence,
      }).admit({ dataset: changed.dataset, admittedAt: changed.evidence.authenticatedAt });
      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'FACTUAL_MEMBERSHIP_MISMATCH' }],
      });
    }
  );
});
