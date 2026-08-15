import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_local_capture_custody_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 1,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

async function insertCustody(input: {
  label: string;
  environment: 'test_fixture' | 'non_production' | 'production';
  custodyProfileId?: string | null;
  custody: unknown;
}) {
  const sha256 = digest(input.label);
  return outcomesPool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'application/octet-stream',1,'raw_source',$4,$5,
             '2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z',$6::jsonb)`,
    [
      `artifact:${sha256}`,
      sha256,
      `artifact://sha256/${sha256}`,
      input.environment,
      input.custodyProfileId ?? null,
      JSON.stringify(input.custody),
    ]
  );
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
});

afterAll(async () => {
  await outcomesPool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('local non-production capture custody constraint', () => {
  const localCustody = {
    content: {
      repositoryAssurance: 'local_non_production_filesystem',
      custodyEnvironment: 'non_production',
      custodyProfileId: null,
      custodyProfile: null,
    },
  };

  it('admits only the exact profileless local shape outside test fixtures', async () => {
    await expect(
      insertCustody({
        label: 'valid-local-non-production',
        environment: 'non_production',
        custody: localCustody,
      })
    ).resolves.toMatchObject({ rowCount: 1 });

    await expect(
      insertCustody({
        label: 'malformed-local-non-production',
        environment: 'non_production',
        custody: {
          content: { ...localCustody.content, custodyEnvironment: 'production' },
        },
      })
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      insertCustody({
        label: 'prohibited-profileless-production',
        environment: 'production',
        custody: localCustody,
      })
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      insertCustody({
        label: 'fixture-profileless-custody',
        environment: 'test_fixture',
        custody: {},
      })
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
