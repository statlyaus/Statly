import { describe, expect, it } from 'vitest';

import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createLocalAflTradePrivateValuationQualificationRegistrar } from '@/server/aflTradeIntelligence/development/localPrivateValuationQualification';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

describe('local private qualification installation', () => {
  it('rejects an unaddressed policy selection before accessing authority', () => {
    const client: AflOutcomeSqlClient = {
      query: async () => {
        throw new Error('Unexpected database access');
      },
      transaction: async () => {
        throw new Error('Unexpected database access');
      },
    };
    expect(() =>
      createLocalAflTradePrivateValuationQualificationRegistrar({
        client,
        artifactRepository: createAflTradeFixtureArtifactRepository({
          artifactClass: 'derived_private',
        }),
        maximumArtifactBytes: 1024 * 1024,
        policyArtifactId: 'latest-policy',
      })
    ).toThrow(/artifact/iu);
  });
});
