import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  recordAflTradeEvidenceLocations,
  storeAndReadBackAflTradeEvidence,
  type AflTradeEvidenceStoreBinding,
} from '@/server/aflTradeIntelligence/artifacts/artifactStoreLocation';
import { registerLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { bindLocalAflTradeArtifactStore } from '@/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import { readBackLocalAflTradeArtifactCustody } from '@/server/aflTradeIntelligence/development/localArtifactCustodyReadback';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const TEST_STORE_ID = 'test-reviewed-evidence-store';
const TEST_EVIDENCE_CREATED_AT = '2026-01-01T00:00:00.000Z';

function sqlClient(target: Pool | AflOutcomeSqlClient): AflOutcomeSqlClient {
  return 'transaction' in target ? target : createPgAflOutcomeSqlClient(target);
}

/**
 * Binds reviewed-registration evidence to the schema's one local non-production store, registering
 * it in a temporary directory the first time. Non-production reviewed registration writes evidence
 * first and requires healthy custody, so tests in that environment need a real store and a clean
 * readback of it; one runs whenever the schema's custody is not already healthy.
 */
export async function bindTestEvidenceStore(
  target: Pool | AflOutcomeSqlClient
): Promise<AflTradeEvidenceStoreBinding> {
  const client = sqlClient(target);
  const existing = await client.query<{ store_id: string }>(
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
  const health = await client.query<{ healthy: boolean }>(
    `SELECT outcome_artifact_custody_healthy('non_production') AS healthy`
  );
  if (health.rows[0]?.healthy !== true) {
    await readBackLocalAflTradeArtifactCustody({ client, storeId });
  }
  return bindLocalAflTradeArtifactStore(client, {
    storeId,
    repositoryId: 'reviewed-registration-evidence',
    artifactClass: 'raw_source',
    maximumObjectBytes: 64 * 1024 * 1024,
  });
}

/**
 * Retains a synthetic evidence record the way a non-production Gate decision must cite one: its
 * bytes are written to the registered store and read back, then its custody row and location are
 * recorded. Returns the `artifact:` id. The same label always yields the same artifact, and
 * retaining it again is a no-op.
 */
export async function retainTestGateEvidence(
  target: Pool | AflOutcomeSqlClient,
  label: string
): Promise<string> {
  const client = sqlClient(target);
  const store = await bindTestEvidenceStore(client);
  const bytes = new TextEncoder().encode(`synthetic gate evidence: ${label}`);
  const reference = createAflTradeByteArtifactRef(bytes, 'text/plain', TEST_EVIDENCE_CREATED_AT);
  await storeAndReadBackAflTradeEvidence(store, [{ reference, bytes }]);
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'raw_source','non_production',NULL,$6,$6,$7::jsonb)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        reference.artifactId,
        reference.contentSha256,
        `artifact://sha256/${reference.contentSha256}`,
        reference.mediaType,
        reference.byteLength,
        TEST_EVIDENCE_CREATED_AT,
        JSON.stringify({
          content: {
            repositoryAssurance: 'local_non_production_filesystem',
            custodyEnvironment: 'non_production',
            custodyProfileId: null,
            custodyProfile: null,
          },
        }),
      ]
    );
    await recordAflTradeEvidenceLocations(transaction, store, [reference]);
  });
  return reference.artifactId;
}
