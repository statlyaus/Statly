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
import { createLocalAflTradeAflcaCoachesVotesAuthority } from './localAflcaCoachesVotesAuthority';
import { createLocalAflTradeDockerFitzRoyCaptureExecutor } from './localDockerFitzRoyCaptureExecutor';
import { createLocalAflTradeDockerFitzRoyDecodeExecutor } from './localDockerFitzRoyDecodeExecutor';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';
import { LOCAL_AFL_TRADE_FITZROY_RUNTIME } from './localFiveSeasonAflTablesStaging';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from './localOutcomesRuntimeIdentity';

export const LOCAL_AFLCA_COACHES_VOTES_SEASONS = [2021, 2022, 2023, 2024, 2025] as const;

export const LOCAL_AFLCA_COACHES_VOTES_READINESS = {
  state: 'blocked' as const,
  blockerCode: 'fitzroy_aflca_award_scope_ambiguous' as const,
  retainedEvidenceEligible: true,
  playerContributionEvaluationEligible: false,
  reason:
    'Pinned fitzRoy 1.7.0 combines home-and-away and finals award requests from round 19, omits the award-scope discriminator, and excludes non-finals rounds above 23.',
  requiredRemedy:
    'Capture each AFLCA award scope with an authenticated discriminator and prove requested-round coverage against the reviewed AFL match universe before factual promotion.',
} as const;

export interface LocalAflcaCoachesVotesStagedCapture {
  readonly seasonYear: number;
  readonly captureId: string;
  readonly normalizationRunId: string;
  readonly observedSeasonValues: readonly string[];
  readonly observedRoundValues: readonly string[];
}

export interface LocalAflcaCoachesVotesStagingOptions {
  readonly artifactRootDirectory: string;
  readonly expectedRuntimeNonce: string;
  readonly imageReference?: string;
}

interface ExistingCaptureRow {
  readonly capture_id: string;
  readonly normalization_run_id: string;
  readonly anchor_season_year: number;
  readonly observed_seasons: string[];
  readonly observed_rounds: string[];
}

function exactNow(): string {
  return new Date().toISOString();
}

async function ensureFieldMapReview(
  client: AflOutcomeSqlClient,
  fieldMap: AflTradeFitzRoyFieldMap
): Promise<void> {
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',$3,
             jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      fieldMap.approvalDecisionId,
      fieldMap.mapId,
      'Approve the exact AFLCA fitzRoy 1.7.0 schema map for retained source-quality analysis; factual use requires a separate current decision.',
      fieldMapSha256,
      'statly-product-owner-source-review',
      fieldMap.approvedAt,
    ]
  );
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

async function recordStructuralFieldMapBlocker(
  client: Pick<AflOutcomeSqlClient, 'query'>,
  fieldMap: AflTradeFitzRoyFieldMap,
  season: number
): Promise<void> {
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  const decisionId = `local-aflca-coaches-votes-structural-blocker-${season}-v1`;
  const rationale = LOCAL_AFLCA_COACHES_VOTES_READINESS.reason;
  const decidedBy = 'statly-source-boundary-review';
  const decidedAt = '2026-09-02T00:00:04.000Z';
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
       evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'rejected',$3,$4,
             jsonb_build_object(
               'blockerCode','fitzroy_aflca_award_scope_ambiguous',
               'fieldMapSha256',$5::text,
               'playerContributionEvaluationEligible',false
             ),$6,$7)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      decisionId,
      fieldMap.mapId,
      fieldMap.approvalDecisionId,
      rationale,
      fieldMapSha256,
      decidedBy,
      decidedAt,
    ]
  );
  const exact = await client.query<{ exact: boolean }>(
    `SELECT subject_type='provider_field_map'
            AND subject_id=$2
            AND decision='rejected'
            AND supersedes_decision_id=$3
            AND rationale=$4
            AND evidence_json=jsonb_build_object(
              'blockerCode','fitzroy_aflca_award_scope_ambiguous',
              'fieldMapSha256',$5::text,
              'playerContributionEvaluationEligible',false
            )
            AND decided_by=$6
            AND decided_at=$7::timestamptz AS exact
       FROM outcome_review_decision
      WHERE decision_id=$1`,
    [
      decisionId,
      fieldMap.mapId,
      fieldMap.approvalDecisionId,
      rationale,
      fieldMapSha256,
      decidedBy,
      decidedAt,
    ]
  );
  if (exact.rows.length !== 1 || exact.rows[0]?.exact !== true) {
    throw new TypeError('The AFLCA structural field-map blocker is absent or inconsistent.');
  }
}

function assertCoverage(
  captures: readonly LocalAflcaCoachesVotesStagedCapture[]
): readonly LocalAflcaCoachesVotesStagedCapture[] {
  if (
    captures.length !== LOCAL_AFLCA_COACHES_VOTES_SEASONS.length ||
    new Set(captures.map(({ seasonYear }) => seasonYear)).size !== captures.length
  ) {
    throw new TypeError(
      'AFLCA staging requires exactly one capture for every season from 2021 through 2025.'
    );
  }
  for (const capture of captures) {
    if (
      !LOCAL_AFLCA_COACHES_VOTES_SEASONS.includes(
        capture.seasonYear as (typeof LOCAL_AFLCA_COACHES_VOTES_SEASONS)[number]
      ) ||
      capture.observedSeasonValues.length !== 1 ||
      capture.observedSeasonValues[0] !== String(capture.seasonYear) ||
      capture.observedRoundValues.length === 0
    ) {
      throw new TypeError(
        `The AFLCA season ${capture.seasonYear} capture is incomplete or out of scope.`
      );
    }
  }
  return [...captures].sort((left, right) => left.seasonYear - right.seasonYear);
}

export async function stageLocalAflcaCoachesVotes(
  client: AflOutcomeSqlClient,
  options: LocalAflcaCoachesVotesStagingOptions
) {
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    client,
    requireLocalAflTradeOutcomesRuntimeNonce(options.expectedRuntimeNonce)
  );
  const imageReference = options.imageReference ?? LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest;
  if (imageReference !== LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest) {
    throw new TypeError('AFLCA staging requires the exact reviewed fitzRoy image.');
  }
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     SELECT 'AFLM',season_year FROM unnest($1::smallint[]) seasons(season_year)
     ON CONFLICT DO NOTHING`,
    [[...LOCAL_AFLCA_COACHES_VOTES_SEASONS]]
  );
  await client.query(
    `INSERT INTO outcome_metric_definition
      (metric_code,definition_version,display_name,value_type,canonical_unit,
       non_negative,definition_json,status)
     VALUES ('coaches_votes','coaches-votes/v1','Coaches votes','numeric','votes',true,'{}'::jsonb,'approved')
     ON CONFLICT DO NOTHING`
  );

  const artifactRootDirectory = resolve(options.artifactRootDirectory);
  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'aflca-coaches-votes-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 32 * 1024 * 1024,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'aflca-coaches-votes-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const firstAuthority = createLocalAflTradeAflcaCoachesVotesAuthority(2021);
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
  const rate = firstAuthority.capture.sourceRights.content.automatedAccess.rateLimit;
  if (egressPolicyEvidenceId === undefined || rate === null) {
    throw new TypeError('AFLCA staging is missing exact egress authority.');
  }

  const signingKeyId = 'local-aflca-coaches-votes-capture';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const egressExecutionVerifier = createAflTradeEd25519EgressExecutionVerifier({
    [signingKeyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  const captureExecutor = createLocalAflTradeDockerFitzRoyCaptureExecutor({
    imageReference,
    runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
    admittedPolicy: {
      upstreamRate: rate,
      cacheSeconds: firstAuthority.capture.gateRequest.cacheSeconds ?? 0,
      egressPolicyEvidenceId,
    },
    signingKey: { keyId: signingKeyId, privateKey },
  });
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);
  const decoderExecutor = createLocalAflTradeDockerFitzRoyDecodeExecutor({ imageReference });
  const existing = await client.query<ExistingCaptureRow>(
    `SELECT DISTINCT ON (capture.anchor_season_year)
            capture.capture_id,run.normalization_run_id,capture.anchor_season_year,
            array_agg(DISTINCT row.season_year::text ORDER BY row.season_year::text)
              AS observed_seasons,
            array_agg(DISTINCT match.round_label ORDER BY match.round_label)
              AS observed_rounds
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run USING (capture_id)
       JOIN outcome_provider_decoded_row row USING (capture_id,normalization_run_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
      WHERE capture.environment='non_production'
        AND capture.provider='afl_coaches_association'
        AND capture.capability_id='aflca-coaches-votes'
        AND capture.anchor_season_year=ANY($1::smallint[])
        AND capture.status='staged'
        AND run.status IN ('staged','needs_review')
        AND run.finalized_at IS NOT NULL
        AND run.field_map_id=
            'aflca-coaches-votes-local-' || capture.anchor_season_year::text || '-v2'
      GROUP BY capture.capture_id,run.normalization_run_id,capture.anchor_season_year,capture.captured_at
      ORDER BY capture.anchor_season_year,capture.captured_at DESC`,
    [[...LOCAL_AFLCA_COACHES_VOTES_SEASONS]]
  );
  const captures: LocalAflcaCoachesVotesStagedCapture[] = existing.rows.map((row) => ({
    seasonYear: row.anchor_season_year,
    captureId: row.capture_id,
    normalizationRunId: row.normalization_run_id,
    observedSeasonValues: row.observed_seasons ?? [],
    observedRoundValues: row.observed_rounds ?? [],
  }));
  for (const capture of captures) {
    const authority = createLocalAflTradeAflcaCoachesVotesAuthority(capture.seasonYear);
    await recordStructuralFieldMapBlocker(client, authority.fieldMap, capture.seasonYear);
  }

  for (const season of LOCAL_AFLCA_COACHES_VOTES_SEASONS) {
    if (captures.some(({ seasonYear }) => seasonYear === season)) continue;
    const authority = createLocalAflTradeAflcaCoachesVotesAuthority(season);
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
          authorizationResolver: gateRepository,
          clock: { now: exactNow },
          runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
          timeoutMs: 180_000,
          maximumSourceBytes: 32 * 1024 * 1024,
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
          maximumSourceBytes: 32 * 1024 * 1024,
          maximumRows: 10_000,
          maximumFields: 20,
          maximumCells: 200_000,
          maximumCellBytes: 4_096,
          maximumOutputBytes: 64 * 1024 * 1024,
          egressExecutionVerifier,
          afterObservationPersist: ({ transaction }) =>
            recordStructuralFieldMapBlocker(transaction, authority.fieldMap, season),
        },
        clock: { now: exactNow },
      }
    );
    captures.push({
      seasonYear: season,
      captureId: ingestion.staging.capture.captureId,
      normalizationRunId: ingestion.staging.normalization.normalizationRunId,
      observedSeasonValues: ingestion.receipt.content.diagnostics.observedSeasonValues,
      observedRoundValues: ingestion.receipt.content.diagnostics.observedRoundValues,
    });
  }
  return {
    captures: assertCoverage(captures),
    readiness: LOCAL_AFLCA_COACHES_VOTES_READINESS,
  };
}
