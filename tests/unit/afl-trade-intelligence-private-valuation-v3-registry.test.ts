// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationAuthorityV3Registry } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationAuthorityV3Registry';
import { inspectPostgresPrivateValuationAuthorityV3 } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationAuthorityV3Inspection';

function repository(
  assurance: AflTradeImmutableArtifactRepository['assurance'] =
    'local_non_production_filesystem'
): AflTradeImmutableArtifactRepository {
  return {
    assurance,
    artifactClass: 'derived_private',
    custodyProfile: null,
    async putIfAbsent(reference) {
      return { status: 'stored', reference };
    },
    async loadExact() {
      return null;
    },
  };
}

const missingTransaction: AflOutcomeSqlTransaction = {
  async query<Row>(): Promise<AflOutcomeSqlQueryResult<Row>> {
    return { rows: [], rowCount: 0 };
  },
};

describe('private valuation v3 registry', () => {
  it('rejects non-private or unbounded artifact custody', () => {
    expect(
      () =>
        new PostgresAflTradePrivateValuationAuthorityV3Registry(
          repository('durable_object_storage'),
          1_000_000
        )
    ).toThrow(/private local artifact custody/i);
    expect(
      () => new PostgresAflTradePrivateValuationAuthorityV3Registry(repository(), 0)
    ).toThrow(/bounded/i);
  });

  it('returns null for an absent v3 bundle and exposes no raw persistence path', async () => {
    const registry = new PostgresAflTradePrivateValuationAuthorityV3Registry(
      repository(),
      1_000_000
    );

    await expect(
      registry.loadAuthenticated(missingTransaction, {
        valuationBundleId: `valuation-bundle:${'a'.repeat(64)}`,
        bundleGate3DecisionId: `gate-decision:${'b'.repeat(64)}`,
        trustedAt: '2026-08-18T02:00:00.000Z',
      })
    ).resolves.toBeNull();
    expect('persist' in registry).toBe(false);
  });

  it('classifies absent v3 evidence separately from external Gate and model authority', async () => {
    const inspection = await inspectPostgresPrivateValuationAuthorityV3(
      missingTransaction,
      {
        valuationScopeKey: 'aflm-private-trade-v3',
        trustedAt: '2026-08-18T02:00:00.000Z',
        registry: new PostgresAflTradePrivateValuationAuthorityV3Registry(
          repository(),
          1_000_000
        ),
      }
    );

    expect(inspection.state).toBe('unavailable');
    expect(inspection.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'evaluation_evidence_bundle_unavailable',
          classification: 'internal_evidence',
        }),
        expect.objectContaining({
          code: 'evaluation_evidence_gate3_not_approved',
          classification: 'external_authority',
        }),
      ])
    );
  });
});
