import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeProjectionFreshnessHighWaterStore } from './projectionArtifactReadRepository';

interface HighWaterRow extends Record<string, unknown> {
  projection_id: string;
  evaluated_at: Date | string;
}

export function createPostgresAflTradeProjectionFreshnessHighWaterStore(
  client: AflOutcomeSqlClient
): AflTradeProjectionFreshnessHighWaterStore {
  return {
    async advance(projectionId, evaluatedAt) {
      const result = await client.query<HighWaterRow>(
        `INSERT INTO outcome_projection_freshness_high_water (
           projection_id, evaluated_at, revision
         ) VALUES ($1,$2,1)
         ON CONFLICT (projection_id) DO UPDATE
         SET evaluated_at = EXCLUDED.evaluated_at,
             revision = outcome_projection_freshness_high_water.revision + 1
         WHERE outcome_projection_freshness_high_water.evaluated_at <= EXCLUDED.evaluated_at
         RETURNING projection_id, evaluated_at`,
        [projectionId, evaluatedAt]
      );
      if (result.rows.length !== 1 || result.rows[0].projection_id !== projectionId) {
        throw new Error('Projection freshness high-water mark rejected a clock rollback.');
      }
      const stored = new Date(result.rows[0].evaluated_at).toISOString();
      if (stored !== evaluatedAt) {
        throw new Error('Projection freshness high-water mark did not preserve the exact instant.');
      }
    },
  };
}
