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
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { createLocalAflTradeDockerFitzRoyCaptureExecutor } from './localDockerFitzRoyCaptureExecutor';
import { createLocalAflTradeDockerFitzRoyDecodeExecutor } from './localDockerFitzRoyDecodeExecutor';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';
import { LOCAL_AFL_TRADE_FITZROY_RUNTIME } from './localFiveSeasonAflTablesStaging';
import { createLocalAflTradeOfficialAfl2026Authority } from './localOfficialAfl2026Authority';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from './localOutcomesRuntimeIdentity';
import {
  inspectLocalOfficialAfl2026SamFlandersEvidence,
  type LocalOfficialAflPlayerAppearanceEvidence,
} from './localOfficialAfl2026Review';

export type { LocalOfficialAflPlayerAppearanceEvidence } from './localOfficialAfl2026Review';

export interface LocalAflTradeOfficialAfl2026StagingOptions {
  artifactRootDirectory: string;
  expectedRuntimeNonce: string;
  imageReference?: string;
}

interface ExistingOfficialCaptureRow {
  capture_id: string;
  normalization_run_id: string;
  source_row_count: number;
  status: 'staged' | 'needs_review';
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
        'Approve the exact official AFL fitzRoy 1.7.0 schema for the disposable local 2026 load.',
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

export async function stageLocalAflTradeOfficialAfl2026Outcomes(
  client: AflOutcomeSqlClient,
  options: LocalAflTradeOfficialAfl2026StagingOptions
) {
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    client,
    requireLocalAflTradeOutcomesRuntimeNonce(options.expectedRuntimeNonce)
  );
  const imageReference = options.imageReference ?? LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest;
  if (imageReference !== LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest) {
    throw new TypeError('The official 2026 local load requires the exact reviewed fitzRoy image.');
  }
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2026)
     ON CONFLICT DO NOTHING`
  );
  await client.query(
    `INSERT INTO outcome_metric_definition
      (metric_code,definition_version,display_name,value_type,canonical_unit,
       non_negative,definition_json,status)
     VALUES
       ('goals','goals/v1','Goals','numeric','goals',true,'{}'::jsonb,'approved'),
       ('games','games/v1','Games','numeric','games',true,'{}'::jsonb,'approved')
     ON CONFLICT DO NOTHING`
  );
  const artifactRootDirectory = resolve(options.artifactRootDirectory);
  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'official-afl-2026-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 128 * 1024 * 1024,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'official-afl-2026-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 16 * 1024 * 1024,
  });
  const authority = createLocalAflTradeOfficialAfl2026Authority();
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  let gateLedger = await gateRepository.load();
  if (
    !gateLedger.ledger.decisions.some(({ decisionId }) => decisionId === authority.gateDecisionId)
  ) {
    gateLedger = await gateRepository.append({
      expectedRevision: gateLedger.revision,
      sourceRights: authority.capture.sourceRights,
      proposal: authority.capture.ledger.proposals[0]!,
      decision: authority.capture.ledger.decisions[0]!,
    });
  }
  await ensureFieldMapReview(client, authority.fieldMap);
  const existing = await client.query<ExistingOfficialCaptureRow>(
    `SELECT capture.capture_id,run.normalization_run_id,run.source_row_count,run.status
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run USING (capture_id)
      WHERE capture.environment='non_production'
        AND capture.provider='official_afl'
        AND capture.capability_id='official-afl-player-stats'
        AND capture.anchor_season_year=2026
        AND capture.status='staged'
        AND run.status IN ('staged','needs_review')
        AND run.finalized_at IS NOT NULL
      ORDER BY capture.captured_at DESC
      LIMIT 1`
  );
  let staged = existing.rows[0];
  if (!staged) {
    const egressPolicyEvidenceId = authority.capture.sourceRights.content.conditions.find(
      ({ conditionId }) => conditionId === 'provider-egress-control'
    )?.verificationEvidenceIds[0];
    if (!egressPolicyEvidenceId) {
      throw new TypeError('The official AFL authority is missing its egress policy evidence.');
    }
    const signingKeyId = 'local-official-afl-2026-fitzroy-capture';
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const egressExecutionVerifier = createAflTradeEd25519EgressExecutionVerifier({
      [signingKeyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
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
          executor: createLocalAflTradeDockerFitzRoyCaptureExecutor({
            imageReference,
            runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
            admittedPolicy: {
              upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
              cacheSeconds: 3_600,
              egressPolicyEvidenceId,
            },
            signingKey: { keyId: signingKeyId, privateKey },
          }),
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
          sourceCaptureRepository: new PostgresAflTradeSourceCaptureRepository(client),
          providerObservationRepository: new PostgresAflTradeProviderObservationRepository(client),
          decoderExecutor: createLocalAflTradeDockerFitzRoyDecodeExecutor({ imageReference }),
          clock: { now: exactNow },
          dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
          imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
          timeoutMs: 180_000,
          maximumSourceBytes: 128 * 1024 * 1024,
          maximumRows: 20_000,
          maximumFields: 120,
          maximumCells: 2_000_000,
          maximumCellBytes: 8_192,
          maximumOutputBytes: 256 * 1024 * 1024,
          egressExecutionVerifier,
        },
        clock: { now: exactNow },
      }
    );
    staged = {
      capture_id: ingestion.staging.capture.captureId,
      normalization_run_id: ingestion.staging.normalization.normalizationRunId,
      source_row_count: ingestion.staging.normalization.rowCount,
      status: ingestion.staging.normalization.status,
    };
  }
  const samFlanders: LocalOfficialAflPlayerAppearanceEvidence =
    await inspectLocalOfficialAfl2026SamFlandersEvidence(
      client,
      staged.capture_id,
      staged.normalization_run_id
    );
  return {
    captureId: staged.capture_id,
    normalizationRunId: staged.normalization_run_id,
    rowCount: staged.source_row_count,
    status: staged.status,
    samFlanders,
  };
}
