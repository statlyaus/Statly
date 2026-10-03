import { beforeAll, describe, expect, it } from 'vitest';
import { loadAflTradeCurrentAdmittedPavMeasurements } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetEvidenceAuthenticator';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { fullPlayerPavDatasetAdmissionFixture } from '../testUtils/playerPavDatasetAdmissionFixture';
import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';

describe('current admitted PAV measurement loader', () => {
  let fixture: Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>>;
  beforeAll(async () => {
    fixture = await fullPlayerPavDatasetAdmissionFixture();
  }, 120_000);

  it('leaves scalar datasets without PAV parents unchanged', async () => {
    const client: AflOutcomeSqlClient = {
      async query() {
        throw new Error('A scalar dataset must not query PAV authority.');
      },
      async transaction() {
        throw new Error('A scalar dataset must not open a PAV transaction.');
      },
    };
    await expect(
      loadAflTradeCurrentAdmittedPavMeasurements(
        client,
        {
          async loadExactWithObservation() {
            throw new Error('No PAV artifacts for scalar datasets.');
          },
        },
        admittedRunFixture().datasetCandidate,
        []
      )
    ).resolves.toEqual({});
  });

  it('rejects an unavailable private original rather than trusting the admitted reference', async () => {
    // Database boundary fixture only: all repository/schema authority checks remain real.
    const client: AflOutcomeSqlClient = {
      async query() {
        return { rows: [], rowCount: 0 };
      },
      async transaction(work) {
        return work(client);
      },
    };
    await expect(
      loadAflTradeCurrentAdmittedPavMeasurements(
        client,
        {
          async loadExactWithObservation() {
            throw new Error('No artifact read before original authority.');
          },
        },
        fixture.dataset,
        fixture.evidence.consumedFieldSets
      )
    ).rejects.toThrow('Player-PAV observation set is absent or not finalized.');
  });
});
