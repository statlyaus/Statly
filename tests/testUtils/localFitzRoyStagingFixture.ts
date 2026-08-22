import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeFitzRoyFieldMapSha256 } from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository';

export async function stageLocalAflTradeFitzRoyFixture(client: AflOutcomeSqlClient) {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const fieldMap = fixture.command.fieldMap;
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  await client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFLM',2026) ON CONFLICT DO NOTHING`
  );
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',$3,
             jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      fieldMap.approvalDecisionId,
      fieldMap.mapId,
      'Source-independent local staging fixture field map.',
      fieldMapSha256,
      'local-staging-fixture-reviewer',
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

  const normalizationTimes = [
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationStartedAt,
    LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
  ];
  return ingestAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    staging: {
      rawArtifactRepository: fixture.rawArtifactRepository,
      sourceCaptureRepository: new PostgresAflTradeSourceCaptureRepository(client),
      providerObservationRepository: new PostgresAflTradeProviderObservationRepository(client),
      decoderExecutor: fixture.decoderExecutor,
      clock: {
        now: () =>
          normalizationTimes.shift() ??
          LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
      },
      dependencyLockSha256: LOCAL_FITZROY_REHEARSAL_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_FITZROY_REHEARSAL_RUNTIME.imageDigest,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumRows: 10,
      maximumFields: 20,
      maximumCells: 200,
      maximumCellBytes: 1_024,
      maximumOutputBytes: 65_536,
      egressExecutionVerifier: fixture.captureDependencies.egressExecutionVerifier,
    },
    clock: { now: () => LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt },
  });
}
