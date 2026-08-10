// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeCustodiedProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import { persistPostgresAflTradeProjectionRelease } from '@/server/aflTradeIntelligence/publication/postgresProjectionReleaseCustody';

import {
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

function durablePublicProjectionRepository() {
  const delegate = createAflTradeFixtureArtifactRepository({
    artifactClass: 'public_projection',
  });
  return {
    ...delegate,
    assurance: 'durable_object_storage' as const,
    custodyProfile: createAflTradeArtifactCustodyProfile({
      schemaVersion: 'afl-trade-artifact-custody-profile/v1',
      subject: 'afl-trade-intelligence',
      contractRole: 'requirements_only_not_readiness_or_authorization',
      repositoryId: 'projection-release-custody-test',
      environment: 'non_production',
      artifactClass: 'public_projection',
      maximumObjectBytes: 128 * 1024 * 1024,
      keyDerivation: 'profile_sha256_two_level_fanout_v1',
      conditionalCreate: 'if_none_match_star_required',
      encryption: {
        inTransit: 'tls_required',
        atRest: { mode: 'customer_managed', keyReferenceSha256: 'a'.repeat(64) },
      },
      retention: {
        deletion: {
          kind: 'no_scheduled_deletion',
          maximumDays: null,
          enforcement: 'not_applicable',
        },
        deleteOnWithdrawal: false,
        worm: { mode: 'compliance', minimumDays: 365 },
      },
      residency: {
        allowedJurisdictions: ['Australia'],
        crossJurisdictionTransfer: 'prohibited',
      },
      infrastructureEvidenceIds: [`storage-policy:${'b'.repeat(64)}`],
    }),
  };
}

class ProjectionCustodySqlFixture implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  custody: Record<string, unknown> | null = null;
  private clockIndex = 0;

  transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.includes("date_trunc('milliseconds',clock_timestamp())")) {
      const trustedAt = new Date(
        Date.parse('2026-08-08T02:00:00.000Z') + this.clockIndex++ * 1_000
      ).toISOString();
      return { rows: [{ trusted_at: trustedAt }] as Row[], rowCount: 1 };
    }
    if (compact.startsWith('SELECT pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 1 };
    }
    if (compact.includes('FROM outcome_artifact_custody')) {
      return {
        rows: (this.custody === null ? [] : [structuredClone(this.custody)]) as Row[],
        rowCount: this.custody === null ? 0 : 1,
      };
    }
    if (compact.startsWith('INSERT INTO outcome_artifact_custody')) {
      this.custody ??= {
        artifact_id: values[0],
        content_sha256: values[1],
        storage_uri: values[2],
        media_type: values[3],
        byte_length: values[4],
        artifact_class: values[5],
        environment: values[6],
        custody_profile_id: values[7],
        created_at: values[8],
        verified_at: values[9],
        custody_json: JSON.parse(values[10] as string),
      };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected projection-custody SQL: ${compact}`);
  }
}

describe('PostgreSQL projection release custody', () => {
  it('stores, reads back, records, and exactly replays the public release envelope', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const fixture = createAflTradeCustodiedProjectionManifestFixture(custodyIndexVerification);
    const input = {
      ...createAflTradeProjectionManifestMaterializationInput(fixture),
      custodyIndexVerification,
    };
    const verification = {
      ...input,
      output: createAflTradeCustodiedProjectionManifestMaterialization(input),
    };
    const client = new ProjectionCustodySqlFixture();
    const repository = durablePublicProjectionRepository();

    const first = await persistPostgresAflTradeProjectionRelease(
      { verification },
      { client, artifactRepository: repository }
    );
    const replay = await persistPostgresAflTradeProjectionRelease(
      { verification },
      { client, artifactRepository: repository }
    );

    expect(first.idempotentReplay).toBe(false);
    expect(first.readback.content).toMatchObject({
      artifact: first.releaseArtifact.artifactRef,
      repositoryAssurance: 'durable_object_storage',
      artifactClass: 'public_projection',
      custodyEnvironment: 'non_production',
      status: 'passed',
    });
    expect(client.custody).toMatchObject({
      artifact_id: first.releaseArtifact.artifactRef.artifactId,
      artifact_class: 'public_projection',
      environment: 'non_production',
    });
    expect(replay).toMatchObject({
      idempotentReplay: true,
      releaseArtifact: { artifactRef: first.releaseArtifact.artifactRef },
      readback: first.readback,
    });
  }, 30_000);
});
