import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import {
  LOCAL_FITZROY_REHEARSAL_INSTANTS,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeFitzRoyFieldMapSha256 } from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';

// Explicitly synthetic upstream capture/review authority, constructed through the
// existing source owners. No factual, HPN, private-release or claim guard is replaced.
export async function stageSourceFirstSupplementalHpnFixture(client: AflOutcomeSqlClient) {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({ provider: 'afl_tables' });
  const source = fixture.command.capture;
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: source.sourceRights,
        proposal: source.ledger.proposals[0]!,
        decision: source.ledger.decisions[0]!,
      },
    ],
  });
  const fieldMap = fixture.command.fieldMap;
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  await client.query(`INSERT INTO outcome_competition_season (competition,season_year)
    VALUES ('AFLM',2026) ON CONFLICT DO NOTHING`);
  await client.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES ($1,'provider_field_map',$2,'approved',$3,jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
    ON CONFLICT (decision_id) DO NOTHING`,
    [
      fieldMap.approvalDecisionId,
      fieldMap.mapId,
      'Explicit synthetic supplemental source field-map review; not genuine source approval.',
      fieldMapSha256,
      'local-staging-fixture-reviewer',
      fieldMap.approvedAt,
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_field_map
    (field_map_id,capability_id,fitzroy_version,source_schema_sha256,field_map_sha256,approval_decision_id,approved_at,map_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (field_map_id) DO NOTHING`,
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
  const ingestion = await ingestAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    staging: {
      rawArtifactRepository: fixture.rawArtifactRepository,
      sourceCaptureRepository: new PostgresAflTradeSourceCaptureRepository(client),
      providerObservationRepository: new PostgresAflTradeProviderObservationRepository(client),
      decoderExecutor: fixture.decoderExecutor,
      clock: {
        now: () =>
          normalizationTimes.shift() ?? LOCAL_FITZROY_REHEARSAL_INSTANTS.normalizationCompletedAt,
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
  const consumedSourceFields =
    ingestion.receipt.content.authorizationReceipt.content.request.fieldUses
      .map(({ sourceField }) => sourceField)
      .sort();
  const consumedFieldSet = consumedSourceFields.map((sourceField) => ({
    sourceField,
    uses: ['derived_feature', 'model_training'] as const,
  }));
  const factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client, {
    provider: 'afl_tables',
  });
  const requestId = await client.transaction(async (transaction) => {
    await transaction.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const result = await transaction.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch($1,'ad_hoc',$2::timestamptz,$3)
        AS request_id`,
      ['afl-men:2026-trades', '2026-08-12T00:00:05.000Z', 'synthetic-supplemental-source-admission']
    );
    if (result.rows.length !== 1 || !result.rows[0]?.request_id) {
      throw new TypeError('Synthetic supplemental source request was not retained exactly.');
    }
    return result.rows[0].request_id;
  });
  const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
  const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
  if (claim === null) throw new TypeError('Synthetic supplemental source request was not claimed.');
  await new PostgresAflTradePrivateValuationCaptureBindingRepository(client).accept({
    request: claim.request,
    claim: { claimId: claim.claimId, leaseToken: claim.leaseToken },
    normalizationRunId: ingestion.staging.normalization.normalizationRunId,
  });
  const sourceAdmission = await new PostgresAflTradePrivateValuationSourceAdmission(client).admit({
    requestId,
    claim: { claimId: claim.claimId, leaseToken: claim.leaseToken },
  });
  // Source admission is complete, not the entire valuation request. Release the
  // attempt through its owner without fabricating a successful terminal valuation.
  await schedule.reschedule({ ...claim, state: 'retry_pending' });
  const auxiliaryRequest = await schedule.load(requestId);
  if (auxiliaryRequest?.status !== 'pending') {
    throw new TypeError('Synthetic source-only request did not release its unfinished claim.');
  }
  return {
    ingestion,
    factualRunId: factual.receipt.factualRunId,
    sourceAdmission,
    auxiliaryRequest: { requestId, ...auxiliaryRequest },
    supplementalSource: {
      member: {
        ordinal: 1,
        recordSha256: sha256AflTradeCanonicalJson({
          captureId: ingestion.staging.capture.captureId,
        }),
        recordedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.candidateCreatedAt,
        captureId: ingestion.staging.capture.captureId,
        sourceSnapshotId: ingestion.snapshotId,
        gate0aDecisionId: fixture.gateDecisionId,
        consumedFieldSetSha256: sha256AflTradeCanonicalJson(consumedFieldSet),
      },
      rights: {
        sourceSnapshotId: ingestion.snapshotId,
        sourceRightsArtifactId: source.sourceRights.rightsArtifactId,
        gateDecisionId: fixture.gateDecisionId,
        sourceRightsProposal: source.sourceRights,
        gate0aReceipt: ingestion.receipt.content.authorizationReceipt,
        consumedSourceFields,
      },
    },
  };
}
