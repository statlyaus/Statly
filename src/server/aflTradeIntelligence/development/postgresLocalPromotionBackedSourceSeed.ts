import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeLocalFixtureExecutionReceipt } from '../source/externalDraftTradeIngestion';
import { PostgresAflTradeExternalEvidenceRepository } from '../source/postgresExternalEvidenceRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '../source/postgresExternalReconciliationRepository';
import { createLocalAflTradePromotionBackedEvidence } from './localPromotionBackedEvidenceFixture';

export interface LocalAflTradeSourceAuthorityReference {
  readonly sourceRightsArtifactId: string;
  readonly gateDecisionId: string;
  readonly gateDecisionKey: string;
  readonly ledgerRevision: number;
}

async function seedCaptureRoots(
  client: AflOutcomeSqlClient,
  authority: LocalAflTradeSourceAuthorityReference
): Promise<void> {
  const source = createLocalAflTradePromotionBackedEvidence();
  const seasonYears = [
    ...new Set([
      ...source.fixture.trades.map(({ seasonYear }) => seasonYear),
      ...source.fixture.trades.flatMap(({ assets }) =>
        assets.flatMap((asset) =>
          asset.kind === 'current_pick' || asset.kind === 'future_pick'
            ? [asset.draftSeasonYear]
            : []
        )
      ),
    ]),
  ].sort((left, right) => left - right);
  await client.transaction(async (transaction) => {
    for (const seasonYear of seasonYears) {
      await transaction.query(
        `INSERT INTO outcome_competition_season (competition,season_year)
         VALUES ('AFLM',$1) ON CONFLICT DO NOTHING`,
        [seasonYear]
      );
    }
    for (const club of source.fixture.clubs) {
      await transaction.query(
        `INSERT INTO outcome_club (club_id,current_name,abbreviation,status)
         VALUES ($1,$2,$3,'approved') ON CONFLICT (club_id) DO NOTHING`,
        [
          club.id,
          club.name,
          club.slug === 'gws'
            ? 'GWS'
            : club.slug === 'western-bulldogs'
              ? 'WB'
              : `LC${club.slug.slice(-2)}`,
        ]
      );
    }
    const players = [
      ...new Map(
        source.fixture.trades
          .flatMap(({ assets }) =>
            assets.flatMap((asset) =>
              asset.kind === 'current_pick' || asset.kind === 'player'
                ? [{ playerId: asset.selectedPlayerId, displayName: asset.selectedPlayer }]
                : []
            )
          )
          .map((player) => [player.playerId, player])
      ).values(),
    ];
    for (const player of players) {
      await transaction.query(
        `INSERT INTO outcome_player (player_id,display_name,status)
         VALUES ($1,$2,'approved') ON CONFLICT (player_id) DO NOTHING`,
        [player.playerId, player.displayName]
      );
    }
    for (const batch of source.sourceBatches) {
      const capture = batch.content.evidence[0]?.content.capture;
      if (!capture) throw new TypeError('Local evidence batch has no source capture.');
      const provider = batch.content.provider;
      if (provider === 'fitzroy_official_afl_player_details') {
        throw new TypeError(
          'Local transaction evidence cannot use the fitzRoy player-details lane.'
        );
      }
      if (provider !== 'statly_local_fixture') {
        throw new TypeError('The generated local archive cannot claim an external provider.');
      }
      const capabilityId = 'statly-local-generated-fixture';
      const attemptId = `local-fixture-attempt-${capture.contentSha256.slice(0, 16)}`;
      const executionReceipt = createAflTradeLocalFixtureExecutionReceipt({
        schemaVersion: 'statly-local-fixture-execution/v1',
        environment: 'test_fixture',
        fixtureOnly: true,
        liveSourceAccessed: false,
        providerRightsExpanded: false,
        rightsArtifactId: authority.sourceRightsArtifactId,
        gateDecisionId: authority.gateDecisionId,
        gateDecisionKey: authority.gateDecisionKey,
        ledgerRevision: authority.ledgerRevision,
        provider,
        capabilityId,
        parserVersion: capture.parserVersion,
        fieldManifestSha256: capture.fieldManifestSha256,
        fixtureEvidenceId: createAflTradeContentAddress('artifact', {
          fixture: true,
          provider,
          kind: 'generated-fixture-contract',
        }),
      });
      await transaction.query(
        `INSERT INTO outcome_artifact_custody
          (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
           environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,1,'raw_source','test_fixture',$5,$5,$6::jsonb)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          capture.artifactId,
          capture.contentSha256,
          `artifact://sha256/${capture.contentSha256}`,
          capture.mediaType,
          capture.capturedAt,
          canonicalizeAflTradeJson({ fixture: true, sourceUrl: capture.sourceUrl }),
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_source_capture_attempt
          (attempt_id,environment,provider,dataset,capability_id,status,started_at,completed_at,
           attempt_json)
         VALUES ($1,'test_fixture',$2,$3,$4,'captured',$5,$5,$6::jsonb)
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          attemptId,
          provider,
          capabilityId,
          capabilityId,
          capture.capturedAt,
          canonicalizeAflTradeJson({ fixture: true, sourceUrl: capture.sourceUrl }),
        ]
      );
      const sourceSnapshotId = createAflTradeContentAddress('source-snapshot', {
        provider,
        captureId: capture.captureId,
      });
      await transaction.query(
        `INSERT INTO outcome_source_capture
          (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,
           dataset,dataset_version,access_mechanism,capability_id,competition,anchor_season_year,
           effective_at,captured_at,status,manifest_json)
         VALUES ($1,$2,$3,$4,'test_fixture',$5,$6,'local-v2','manual_review',$6,'AFLM',2025,
                 $7,$8,'approved',$9::jsonb)
         ON CONFLICT (capture_id) DO NOTHING`,
        [
          capture.captureId,
          attemptId,
          sourceSnapshotId,
          capture.artifactId,
          provider,
          capabilityId,
          capture.effectiveAt,
          capture.capturedAt,
          canonicalizeAflTradeJson({ sourceUrl: capture.sourceUrl, executionReceipt }),
        ]
      );
      for (const seasonYear of seasonYears) {
        await transaction.query(
          `INSERT INTO outcome_source_capture_season (capture_id,competition,season_year)
           SELECT $1,'AFLM',$2
            WHERE NOT EXISTS (
              SELECT 1 FROM outcome_source_capture_season
               WHERE capture_id=$1 AND competition='AFLM' AND season_year=$2
            )`,
          [capture.captureId, seasonYear]
        );
      }
    }
    for (const resolution of source.identityResolutions) {
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,canonical_record_type,
           canonical_record_id,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'external_provider_identity_fixture',$2,'approved',$3,$4,$5,$6::jsonb,
                 'local-fixture-reviewer',$7)
         ON CONFLICT (decision_id) DO NOTHING`,
        [
          resolution.content.reviewDecisionId,
          resolution.resolutionId,
          resolution.content.entityKind,
          resolution.content.canonicalId,
          'Approve the deterministic local external identity mapping.',
          canonicalizeAflTradeJson({ fixture: true, resolutionId: resolution.resolutionId }),
          resolution.content.decidedAt,
        ]
      );
    }
  });
}

export async function seedLocalAflTradePromotionBackedSource(
  client: AflOutcomeSqlClient,
  authority: LocalAflTradeSourceAuthorityReference
) {
  const source = createLocalAflTradePromotionBackedEvidence();
  await seedCaptureRoots(client, authority);
  const evidenceRepository = new PostgresAflTradeExternalEvidenceRepository(client);
  const evidenceReceipts = [];
  for (const batch of source.sourceBatches) {
    evidenceReceipts.push(await evidenceRepository.persist({ batch, issues: [] }));
  }
  const reconciliation = await new PostgresAflTradeExternalReconciliationRepository(
    client
  ).persistCandidate({
    candidate: source.candidate,
    identityResolutions: source.identityResolutions,
  });
  return {
    ...source,
    evidenceReceipts,
    reconciliation,
    idempotentReplay:
      evidenceReceipts.every(({ idempotentReplay }) => idempotentReplay) &&
      reconciliation.idempotentReplay,
  };
}
