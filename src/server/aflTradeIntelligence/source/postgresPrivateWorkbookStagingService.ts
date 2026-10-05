import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { PersistedAflTradeWorkbookPackage } from './workbookImportContracts';
import {
  AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM,
  AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
  AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
  PostgresAflTradeWorkbookStagingRepository,
} from './postgresWorkbookStagingRepository';

interface ExactCaptureRow {
  source_artifact_id: string;
  environment: string;
  provider: string;
  dataset: string;
  dataset_version: string;
  access_mechanism: string;
  competition: string;
  anchor_season_year: number;
  effective_at: Date | string;
  captured_at: Date | string;
  status: string;
  manifest_json: unknown;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('PostgreSQL returned invalid time.');
  return parsed.toISOString();
}

export class PostgresAflTradePrivateWorkbookStagingService {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly rawArtifacts: AflTradeImmutableArtifactRepository
  ) {
    if (
      rawArtifacts.artifactClass !== 'raw_source' ||
      rawArtifacts.assurance !== 'local_non_production_filesystem'
    ) {
      throw new TypeError('Private workbook staging requires local non-production raw custody.');
    }
  }

  async stage(input: {
    sourceArtifact: AflTradeArtifactRef;
    sourceBytes: Uint8Array;
    originalFilename: string;
    seasonYears: readonly number[];
  }): Promise<PersistedAflTradeWorkbookPackage> {
    if (
      !doesAflTradeArtifactRefMatchBytes(
        input.sourceArtifact,
        input.sourceBytes,
        input.sourceArtifact.mediaType
      )
    ) {
      throw new TypeError('Private workbook source bytes do not match their immutable reference.');
    }
    const seasonYears = [...new Set(input.seasonYears)].sort((left, right) => left - right);
    if (
      seasonYears.length === 0 ||
      seasonYears.some((seasonYear) => !Number.isInteger(seasonYear) || seasonYear < 1897)
    ) {
      throw new TypeError('Private workbook staging requires its exact AFL season scope.');
    }
    await this.rawArtifacts.putIfAbsent(input.sourceArtifact, input.sourceBytes);
    const retained = await this.rawArtifacts.loadExact(
      input.sourceArtifact,
      input.sourceArtifact.byteLength
    );
    if (
      retained === null ||
      !doAflTradeArtifactRefsExactlyMatch(retained.reference, input.sourceArtifact)
    ) {
      throw new TypeError('Private workbook artifact failed exact local readback.');
    }
    const captureContent = {
      schemaVersion: 'afl-trade-private-workbook-capture/v1',
      environment: 'test_fixture',
      provider: AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
      dataset: AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
      datasetVersion: input.sourceArtifact.contentSha256,
      accessMechanism: AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM,
      competition: 'AFL',
      seasonYears,
      sourceArtifact: input.sourceArtifact,
      publicationEligible: false,
      publicationProhibited: true,
      limitation:
        'Pinned private local workbook capture for disposable non-production review only; no publication or production authority.',
    } as const;
    const attemptId = createAflTradeContentAddress('private-workbook-capture-attempt', {
      sourceArtifactId: input.sourceArtifact.artifactId,
      environment: captureContent.environment,
    });
    const captureId = createAflTradeContentAddress('private-workbook-capture', captureContent);
    const sourceSnapshotId = `private-workbook-source-snapshot:${input.sourceArtifact.contentSha256}`;
    const anchorSeasonYear = seasonYears.at(-1)!;

    await this.client.transaction(async (transaction) => {
      const trusted = await transaction.query<{ trusted_at: Date | string }>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
      );
      const trustedAt = iso(trusted.rows[0]!.trusted_at);
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'raw_source','test_fixture',$6,$7,$8::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          input.sourceArtifact.artifactId,
          input.sourceArtifact.contentSha256,
          input.sourceArtifact.storageUri,
          input.sourceArtifact.mediaType,
          input.sourceArtifact.byteLength,
          input.sourceArtifact.createdAt,
          trustedAt,
          canonicalizeAflTradeJson({
            reference: input.sourceArtifact,
            repositoryAssurance: this.rawArtifacts.assurance,
            publicationEligible: false,
            publicationProhibited: true,
          }),
        ]
      );
      const custody = await transaction.query<{
        content_sha256: string;
        storage_uri: string;
        media_type: string;
        byte_length: string | number;
        artifact_class: string;
        environment: string;
        created_at: Date | string;
      }>(
        `SELECT content_sha256,storage_uri,media_type,byte_length,artifact_class,
                environment,created_at
           FROM outcome_artifact_custody
          WHERE artifact_id=$1`,
        [input.sourceArtifact.artifactId]
      );
      const custodyRow = custody.rows[0];
      if (
        custody.rows.length !== 1 ||
        !custodyRow ||
        custodyRow.content_sha256 !== input.sourceArtifact.contentSha256 ||
        custodyRow.storage_uri !== input.sourceArtifact.storageUri ||
        custodyRow.media_type !== input.sourceArtifact.mediaType ||
        Number(custodyRow.byte_length) !== input.sourceArtifact.byteLength ||
        custodyRow.artifact_class !== 'raw_source' ||
        custodyRow.environment !== 'test_fixture' ||
        iso(custodyRow.created_at) !== input.sourceArtifact.createdAt
      ) {
        throw new TypeError('Private workbook artifact conflicts with PostgreSQL custody.');
      }
      await transaction.query(
        `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,status,started_at,completed_at,attempt_json)
         VALUES ($1,'test_fixture',$2,$3,'captured',$4,$4,$5::jsonb)
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          attemptId,
          AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
          AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
          input.sourceArtifact.createdAt,
          canonicalizeAflTradeJson({
            attemptId,
            sourceArtifactId: input.sourceArtifact.artifactId,
            publicationEligible: false,
            publicationProhibited: true,
          }),
        ]
      );
      for (const seasonYear of seasonYears) {
        await transaction.query(
          `INSERT INTO outcome_competition_season (competition,season_year)
           VALUES ('AFL',$1) ON CONFLICT DO NOTHING`,
          [seasonYear]
        );
      }
      await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
           dataset_version,access_mechanism,competition,anchor_season_year,effective_at,captured_at,
           status,manifest_json)
         VALUES ($1,$2,$3,$4,'test_fixture',$5,$6,$7,$8,'AFL',$9,$10,$10,'approved',$11::jsonb)
         ON CONFLICT (capture_id) DO NOTHING`,
        [
          captureId,
          attemptId,
          sourceSnapshotId,
          input.sourceArtifact.artifactId,
          AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
          AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
          input.sourceArtifact.contentSha256,
          AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM,
          anchorSeasonYear,
          input.sourceArtifact.createdAt,
          canonicalizeAflTradeJson(captureContent),
        ]
      );
      for (const seasonYear of seasonYears) {
        await transaction.query(
          `INSERT INTO outcome_source_capture_season (capture_id,competition,season_year)
           VALUES ($1,'AFL',$2) ON CONFLICT DO NOTHING`,
          [captureId, seasonYear]
        );
      }
      const capture = await transaction.query<ExactCaptureRow>(
        `SELECT source_artifact_id,environment,provider,dataset,dataset_version,
                access_mechanism,competition,anchor_season_year,effective_at,captured_at,
                status,manifest_json
           FROM outcome_source_capture WHERE capture_id=$1`,
        [captureId]
      );
      const row = capture.rows[0];
      if (
        capture.rows.length !== 1 ||
        !row ||
        row.source_artifact_id !== input.sourceArtifact.artifactId ||
        row.environment !== 'test_fixture' ||
        row.provider !== AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER ||
        row.dataset !== AFL_TRADE_WORKBOOK_CAPTURE_DATASET ||
        row.dataset_version !== input.sourceArtifact.contentSha256 ||
        row.access_mechanism !== AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM ||
        row.competition !== 'AFL' ||
        row.anchor_season_year !== anchorSeasonYear ||
        iso(row.effective_at) !== input.sourceArtifact.createdAt ||
        iso(row.captured_at) !== input.sourceArtifact.createdAt ||
        row.status !== 'approved' ||
        canonicalizeAflTradeJson(row.manifest_json) !== canonicalizeAflTradeJson(captureContent)
      ) {
        throw new TypeError('Private workbook capture conflicts with exact replay.');
      }
      const scopes = await transaction.query<{ season_year: number }>(
        `SELECT season_year FROM outcome_source_capture_season
          WHERE capture_id=$1 AND competition='AFL' ORDER BY season_year`,
        [captureId]
      );
      if (
        scopes.rows.length !== seasonYears.length ||
        scopes.rows.some(({ season_year }, index) => season_year !== seasonYears[index])
      ) {
        throw new TypeError('Private workbook capture season scope is incomplete.');
      }
    });

    return new PostgresAflTradeWorkbookStagingRepository(
      this.client,
      this.rawArtifacts
    ).persistPackage({
      captureId,
      environment: 'test_fixture',
      sourceArtifact: input.sourceArtifact,
      originalFilename: input.originalFilename,
      startedAt: input.sourceArtifact.createdAt,
      completedAt: input.sourceArtifact.createdAt,
    });
  }
}
