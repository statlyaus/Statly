import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { PostgresAflTradeExternalEvidenceRepository } from '@/server/aflTradeIntelligence/source/postgresExternalEvidenceRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { OFFICIAL_AFL_COMPENSATION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/officialAflCompensationPdfFacts';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schema = `compensation_staging_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const hash = (value: string) => value.repeat(64);
const at = '2026-09-14T00:00:00.000Z';
const url = 'https://www.afl.com.au/news/103376/statement-suns-giants-activate-compo-draft-picks';
const cases = [
  {
    key: 'a',
    claim: {
      kind: 'compensation_activation_reference',
      useYear: 2014,
      recordedPlayer: 'Gary Ablett',
      recordedHolder: 'Gold Coast',
      selectionPosition: 'first_round',
    },
  },
  {
    key: 'b',
    claim: {
      kind: 'compensation_rule_reference',
      scheme: 'gold_coast_expansion_compensation',
      awardYear: 2010,
      expiresAfterYear: 2014,
      nomination: 'before_season',
      initialYearNoticeDeadline: null,
      tradeable: true,
      windowYears: 5,
    },
  },
] as const;

describe('compensation reference PostgreSQL staging', () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('schema', schema);
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
    await pool.query(
      "INSERT INTO outcome_competition_season(competition,season_year) VALUES ('AFLM',2014)"
    );
    await pool.query(
      `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
      VALUES ($1,$2,$3,'text/html',1,'raw_source','test_fixture',$4,$4,'{}')`,
      [`artifact:${hash('1')}`, hash('1'), `artifact://sha256/${hash('1')}`, at]
    );
    for (const { key } of cases) {
      await pool.query(
        `INSERT INTO outcome_source_capture_attempt
        (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,attempt_json)
        VALUES ($1,'test_fixture','official_afl','compensation','official-afl-compensation-lifecycle','captured',$2,$2,'{}')`,
        [key, at]
      );
      await pool.query(
        `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
         access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
        VALUES ($1,$2,$3,$4,'test_fixture','official_afl','compensation','2014','automated_web',
         'official-afl-compensation-lifecycle','AFLM',2014,$5,$5,'approved',$6::jsonb)`,
        [
          `source-capture:${hash(key)}`,
          key,
          `source-snapshot:${hash(key)}`,
          `artifact:${hash('1')}`,
          at,
          JSON.stringify({ sourceUrl: url, syntheticFixture: true }),
        ]
      );
    }
  });
  afterAll(async () => {
    await pool.end();
    try {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  it.each(cases)(
    'persists and replays $claim.kind without creating a lifecycle registration',
    async ({ key, claim }) => {
      const captureId = `source-capture:${hash(key)}`;
      const evidence = createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        publicationEligible: false,
        capture: {
          captureId,
          artifactId: `artifact:${hash('1')}`,
          contentSha256: hash('1'),
          mediaType: 'text/html',
          sourceUrl: url,
          capturedAt: at,
          effectiveAt: at,
          parserVersion: OFFICIAL_AFL_COMPENSATION_PARSER_VERSION,
          fieldManifestSha256: hash('2'),
        },
        sourceRow: { ordinal: 1, sourceKey: key },
        claim,
      });
      const batch = createAflTradeExternalEvidenceBatch({
        schemaVersion: 'afl-trade-external-evidence-batch/v1',
        provider: 'official_afl',
        captureId,
        evidence: [evidence],
        finalizedAt: at,
        publicationEligible: false,
      });
      const repository = new PostgresAflTradeExternalEvidenceRepository(
        createPgAflOutcomeSqlClient(pool)
      );
      expect(await repository.persist({ batch, issues: [] })).toEqual({
        batchId: batch.batchId,
        idempotentReplay: false,
      });
      expect(await repository.persist({ batch, issues: [] })).toEqual({
        batchId: batch.batchId,
        idempotentReplay: true,
      });
      const rows = await pool.query(
        `SELECT row.claim_kind,row.evidence_json,capture.anchor_season_year,batch.status
      FROM outcome_external_evidence_row row JOIN outcome_external_evidence_batch batch USING(batch_id)
      JOIN outcome_source_capture capture USING(capture_id) WHERE row.evidence_id=$1`,
        [evidence.evidenceId]
      );
      expect(rows.rows).toEqual([
        {
          claim_kind: claim.kind,
          evidence_json: evidence,
          anchor_season_year: 2014,
          status: 'finalized',
        },
      ]);
      await expect(
        pool.query(
          'UPDATE outcome_external_evidence_row SET evidence_json=$1 WHERE evidence_id=$2',
          [JSON.stringify({}), evidence.evidenceId]
        )
      ).rejects.toThrow(/append-only/);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM outcome_special_entitlement_award'))
          .rows[0].count
      ).toBe(0);
    }
  );
});
