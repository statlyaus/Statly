import { beforeAll, describe, expect, it } from 'vitest';
import { loadAflTradeCurrentAdmittedPavMeasurements } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetEvidenceAuthenticator';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { currentAdmittedPavSourceFixture } from '../testUtils/currentAdmittedPavSourceFixture';

describe('current PAV loader with coherent synthetic source parents', () => {
  let fixture: Awaited<ReturnType<typeof currentAdmittedPavSourceFixture>>;
  beforeAll(async () => {
    fixture = await currentAdmittedPavSourceFixture();
  }, 30_000);
  it('loads all eighteen current measurements and the exact method after actual dataset admission', async () => {
    expect(fixture.admission.status).toBe('admitted');
    const loaded = await loadAflTradeCurrentAdmittedPavMeasurements(
      fixture.client,
      fixture.artifacts,
      fixture.graph.dataset,
      fixture.graph.evidence.consumedFieldSets
    );
    expect(loaded.pavObservationSet).toEqual(fixture.graph.pav.pavObservationSet);
    expect(loaded.pavObservationSet?.content.environment).toBe('non_production');
    expect(loaded.pavObservationSet?.content.observations).toHaveLength(16);
    expect(loaded.pavMeasurements).toHaveLength(18);
    expect(loaded.pavMeasurements).toEqual(fixture.graph.pav.pavMeasurements);
    expect(loaded.hpnMethod).toEqual(fixture.graph.pav.method);
  }, 30_000);

  it('rejects a missing current calculation head despite retained exact original artifacts', async () => {
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql: string, parameters: readonly unknown[] = []) {
        if (sql.includes('SELECT head.revision,head.calculation_id')) {
          return { rows: [] as Row[], rowCount: 0 };
        }
        return fixture.client.query<Row>(sql, parameters);
      },
      async transaction(work) {
        return work(client);
      },
    };
    await expect(
      loadAflTradeCurrentAdmittedPavMeasurements(
        client,
        fixture.artifacts,
        fixture.graph.dataset,
        fixture.graph.evidence.consumedFieldSets
      )
    ).rejects.toThrow('current finalized HPN calculation head');
  });
});
