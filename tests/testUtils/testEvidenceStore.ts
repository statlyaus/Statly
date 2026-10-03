import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { AflTradeEvidenceStoreBinding } from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { bindLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

const TEST_STORE_ID = 'test-reviewed-evidence-store';

/**
 * Binds reviewed-registration evidence to the schema's one local non-production store, registering
 * it in a temporary directory the first time. Non-production reviewed registration writes evidence
 * first, so tests in that environment need a real store.
 */
export async function bindTestEvidenceStore(pool: Pool): Promise<AflTradeEvidenceStoreBinding> {
  const client = createPgAflOutcomeSqlClient(pool);
  const existing = await pool.query<{ store_id: string }>(
    `SELECT store_id FROM outcome_artifact_store
      WHERE environment='non_production' AND assurance='local_non_production_filesystem'`
  );
  const storeId = existing.rows[0]?.store_id ?? TEST_STORE_ID;
  if (existing.rows.length === 0) {
    await registerLocalAflTradeArtifactStore(client, {
      storeId,
      rootDirectory: await mkdtemp(join(tmpdir(), 'statly-test-evidence-store-')),
    });
  }
  return bindLocalAflTradeArtifactStore(client, {
    storeId,
    repositoryId: 'reviewed-registration-evidence',
    artifactClass: 'raw_source',
    maximumObjectBytes: 64 * 1024 * 1024,
  });
}
