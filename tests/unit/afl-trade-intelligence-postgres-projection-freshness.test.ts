import { describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradeProjectionFreshnessHighWaterStore } from '@/server/aflTradeIntelligence/publication/postgresProjectionFreshnessHighWaterStore';

const projectionId = `projection:${'a'.repeat(64)}`;
const evaluatedAt = '2026-08-08T01:00:00.000Z';

describe('PostgreSQL projection freshness high-water store', () => {
  it('atomically advances one exact projection instant', async () => {
    const query = vi.fn(async () => ({
      rows: [{ projection_id: projectionId, evaluated_at: evaluatedAt }],
      rowCount: 1,
    }));
    const store = createPostgresAflTradeProjectionFreshnessHighWaterStore({
      query,
    } as unknown as AflOutcomeSqlClient);

    await store.advance(projectionId, evaluatedAt);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'outcome_projection_freshness_high_water.evaluated_at <= EXCLUDED.evaluated_at'
      ),
      [projectionId, evaluatedAt]
    );
  });

  it('fails closed when PostgreSQL rejects a clock rollback', async () => {
    const store = createPostgresAflTradeProjectionFreshnessHighWaterStore({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as AflOutcomeSqlClient);

    await expect(store.advance(projectionId, evaluatedAt)).rejects.toThrow(/clock rollback/i);
  });
});
