import { generateKeyPairSync } from 'node:crypto';
import { resolve } from 'node:path';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeEd25519EgressExecutionVerifier } from '../source/fitzRoyHttpEgressExecutor';
import {
  createAflTradeFitzRoyFieldMapSha256,
  type AflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { createLocalAflTradeDockerFitzRoyCaptureExecutor } from './localDockerFitzRoyCaptureExecutor';
import { createLocalAflTradeDockerFitzRoyDecodeExecutor } from './localDockerFitzRoyDecodeExecutor';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from './localFiveSeasonAflTablesAuthority';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from './localOutcomesRuntimeIdentity';
import {
  LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
  assertLocalAflTradeFiveSeasonPostgresStagingCoverage,
  type LocalAflTradeFiveSeasonStagedCapture,
} from './localFiveSeasonFitzRoyOutcomeLoad';

export const LOCAL_AFL_TRADE_FITZROY_RUNTIME = {
  rVersion: '4.5.1' as const,
  dependencyLockSha256: '061c2ff232be7bd262ae64b29100a773d437748471fb96936f2c768d0ab9c24a',
  imageDigest: 'sha256:aae92ffaaf657de99be3cfd86e10a091ebdb516ed7a188ee09bcecd9035e0348' as const,
};

export interface LocalAflTradeFiveSeasonStagingOptions {
  artifactRootDirectory: string;
  expectedRuntimeNonce: string;
  imageReference?: string;
}

interface ExistingStagedCaptureRow {
  capture_id: string;
  normalization_run_id: string;
  anchor_season_year: number;
  observed_seasons: string[];
}

async function ensureFieldMapReview(
  client: AflOutcomeSqlClient,
  fieldMap: AflTradeFitzRoyFieldMap
): Promise<void> {
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  const existing = await client.query(
    `SELECT decision_id FROM outcome_review_decision WHERE decision_id=$1`,
    [fieldMap.approvalDecisionId]
  );
  if (existing.rows.length === 0) {
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'provider_field_map',$2,'approved',$3,
               jsonb_build_object('fieldMapSha256',$4::text),$5,$6)`,
      [
        fieldMap.approvalDecisionId,
        fieldMap.mapId,
        'Approve the exact AFL Tables 1.7.0 schema for this disposable local season load.',
        fieldMapSha256,
        'local-source-governance-reviewer',
        fieldMap.approvedAt,
      ]
    );
  }
  await client.query(
    `INSERT INTO outcome_provider_field_map
      (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
       field_map_sha256,approval_decision_id,approved_at,map_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (field_map_id) DO NOTHING`,
    [
      fieldMap.mapId,
      fieldMap.capabilityId,
      fieldMap.fitzRoyVersion,
      fieldMap.sourceSchemaSha256,
      fieldMapSha256,
      fieldMap.approvalDecisionId,
      fieldMap.approvedAt,
      canonicalizeAflTradeJson(fieldMap),
    ]
  );
}

function exactNow(): string {
  return new Date().toISOString();
}

export async function stageLocalAflTradeFiveSeasonAflTablesOutcomes(
  client: AflOutcomeSqlClient,
  options: LocalAflTradeFiveSeasonStagingOptions
) {
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    client,
    requireLocalAflTradeOutcomesRuntimeNonce(options.expectedRuntimeNonce)
  );
  const imageReference = options.imageReference ?? LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest;
  if (imageReference !== LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest) {
    throw new TypeError('The five-season local load requires the exact reviewed fitzRoy image.');
  }
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     SELECT 'AFLM',season_year
       FROM unnest($1::smallint[]) AS seasons(season_year)
     ON CONFLICT DO NOTHING`,
    [[...LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW]]
  );
  await client.query(
    `INSERT INTO outcome_metric_definition
      (metric_code,definition_version,display_name,value_type,canonical_unit,
       non_negative,definition_json,status)
     VALUES
       ('goals','goals/v1','Goals','numeric','goals',true,'{}'::jsonb,'approved'),
       ('games','games/v1','Games','numeric','games',true,'{}'::jsonb,'approved'),
       ('brownlow_votes','brownlow-votes/v1','Brownlow votes','numeric','votes',true,'{}'::jsonb,'approved')
     ON CONFLICT DO NOTHING`
  );
  const artifactRootDirectory = resolve(options.artifactRootDirectory);
  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'five-season-afl-tables-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 128 * 1024 * 1024,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'five-season-afl-tables-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 16 * 1024 * 1024,
  });
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const firstAuthority = createLocalAflTradeFiveSeasonAflTablesAuthority(
    LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW[0]
  );
  let gateLedger = await gateRepository.load();
  if (
    !gateLedger.ledger.decisions.some(
      ({ decisionId }) => decisionId === firstAuthority.gateDecisionId
    )
  ) {
    gateLedger = await gateRepository.append({
      expectedRevision: gateLedger.revision,
      sourceRights: firstAuthority.capture.sourceRights,
      proposal: firstAuthority.capture.ledger.proposals[0]!,
      decision: firstAuthority.capture.ledger.decisions[0]!,
    });
  }
  const egressPolicyEvidenceId = firstAuthority.capture.sourceRights.content.conditions.find(
    ({ conditionId }) => conditionId === 'provider-egress-control'
  )?.verificationEvidenceIds[0];
  if (!egressPolicyEvidenceId) {
    throw new TypeError('The local AFL Tables authority is missing its egress policy evidence.');
  }
  const signingKeyId = 'local-five-season-fitzroy-capture';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const egressExecutionVerifier = createAflTradeEd25519EgressExecutionVerifier({
    [signingKeyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  const captureExecutor = createLocalAflTradeDockerFitzRoyCaptureExecutor({
    imageReference,
    runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
    admittedPolicy: {
      upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
      cacheSeconds: 86_400,
      egressPolicyEvidenceId,
    },
    signingKey: { keyId: signingKeyId, privateKey },
  });
  const decoderExecutor = createLocalAflTradeDockerFitzRoyDecodeExecutor({ imageReference });
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);
  const existing = await client.query<ExistingStagedCaptureRow>(
    `SELECT DISTINCT ON (capture.anchor_season_year)
            capture.capture_id,run.normalization_run_id,capture.anchor_season_year,
            array_agg(DISTINCT row.season_year::text ORDER BY row.season_year::text)
              AS observed_seasons
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run USING (capture_id)
       JOIN outcome_provider_decoded_row row USING (capture_id,normalization_run_id)
      WHERE capture.environment='non_production'
        AND capture.provider='afl_tables'
        AND capture.capability_id='afl-tables-player-stats'
        AND capture.anchor_season_year=ANY($1::smallint[])
        AND capture.status='staged'
        AND run.status='needs_review'
        AND run.finalized_at IS NOT NULL
        AND run.field_map_id=
            'afl-tables-player-stats-local-' || capture.anchor_season_year::text || '-v2'
      GROUP BY capture.capture_id,run.normalization_run_id,capture.anchor_season_year,
               capture.captured_at
      ORDER BY capture.anchor_season_year,capture.captured_at DESC`,
    [[...LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW]]
  );
  const captures: LocalAflTradeFiveSeasonStagedCapture[] = existing.rows.map((row) => ({
    authorizationSeason: row.anchor_season_year,
    observedSeasonValues: row.observed_seasons,
    captureId: row.capture_id,
    normalizationRunId: row.normalization_run_id,
  }));

  for (const season of LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW) {
    if (captures.some(({ authorizationSeason }) => authorizationSeason === season)) continue;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(season);
    await ensureFieldMapReview(client, authority.fieldMap);
    const ingestion = await ingestAuthorizedAflTradeFitzRoyProviderSeason(
      {
        capture: authority.capture,
        fieldMapId: authority.fieldMap.mapId,
        fieldMap: authority.fieldMap,
        effectiveAt: exactNow(),
      },
      {
        capture: {
          rawArtifactRepository,
          metadataArtifactRepository,
          executor: captureExecutor,
          egressExecutionVerifier,
          authorizationResolver: {
            resolveAuthorization: (rightsArtifactId) =>
              gateRepository.resolveAuthorization(rightsArtifactId),
          },
          clock: { now: exactNow },
          runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
          timeoutMs: 180_000,
          maximumSourceBytes: 128 * 1024 * 1024,
          maximumDiagnosticsBytes: 4 * 1024 * 1024,
        },
        staging: {
          rawArtifactRepository,
          sourceCaptureRepository,
          providerObservationRepository,
          decoderExecutor,
          clock: { now: exactNow },
          dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
          imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
          timeoutMs: 180_000,
          maximumSourceBytes: 128 * 1024 * 1024,
          maximumRows: 20_000,
          maximumFields: 100,
          maximumCells: 2_000_000,
          maximumCellBytes: 8_192,
          maximumOutputBytes: 192 * 1024 * 1024,
          egressExecutionVerifier,
        },
        clock: { now: exactNow },
      }
    );
    captures.push({
      authorizationSeason: season,
      observedSeasonValues: ingestion.receipt.content.diagnostics.observedSeasonValues,
      captureId: ingestion.staging.capture.captureId,
      normalizationRunId: ingestion.staging.normalization.normalizationRunId,
    });
  }
  const coverage = await assertLocalAflTradeFiveSeasonPostgresStagingCoverage(client, captures);
  return { captures, coverage };
}
