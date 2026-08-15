import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { PostgresAflTradePromotionBackedCorpusRepository } from '../artifacts/postgresPromotionBackedCorpusRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '../outcomes/outcomeReadService';
import { createPostgresAflDraftTradeOutcomeReleaseRepository } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePromotionBackedFactualReleaseRepository } from '../outcomes/postgresPromotionBackedFactualReleaseRepository';
import { PostgresAflTradePromotionBackedGate2Repository } from '../outcomes/postgresPromotionBackedGate2Repository';
import { PostgresAflTradePromotionBackedPublicArchiveRepository } from '../outcomes/postgresPromotionBackedPublicArchiveRepository';
import { prepareAflTradePromotionBackedFactualPublication } from '../outcomes/preparePromotionBackedFactualPublication';
import { aflTradePromotionBackedFactualReleaseSchema } from '../outcomes/promotionBackedFactualReleaseContracts';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '../source/externalCanonicalPromotionContracts';
import { PostgresAflTradeExternalCanonicalPromotionRepository } from '../source/postgresExternalCanonicalPromotionRepository';
import {
  createLocalAflTradeCanonicalPromotionAuthority,
  createLocalAflTradePromotionBackedPublicationAuthority,
} from './localPromotionBackedAuthority';
import { createLocalAflTradeOutcomeReleaseAuthority } from './localOutcomeReleaseAuthority';
import {
  persistLocalAflTradeCanonicalPromotionAuthority,
  persistLocalAflTradePromotionBackedPublicationAuthority,
} from './postgresLocalPromotionBackedAuthority';
import { seedLocalAflTradePromotionBackedSource } from './postgresLocalPromotionBackedSourceSeed';

const CORPUS_CUTOFF = '2026-08-09T09:00:03.000Z';
const CORPUS_CREATED_AT = '2026-08-09T09:00:05.000Z';
const RELEASE_CREATED_AT = '2026-08-09T09:00:06.000Z';
const LINEAGE_CREATED_AT = '2026-08-09T09:00:07.000Z';
const ARCHIVE_CREATED_AT = '2026-08-09T09:00:08.000Z';

const evidenceId = (action: string) =>
  createAflTradeContentAddress('artifact', { fixture: true, action });

async function loadReleaseManifest(client: AflOutcomeSqlClient, releaseId: string) {
  const stored = await client.query<{ manifest_json: unknown }>(
    'SELECT manifest_json FROM outcome_release_manifest WHERE release_id=$1',
    [releaseId]
  );
  if (stored.rows.length !== 1) {
    throw new TypeError('The prepared local factual release manifest is unavailable.');
  }
  return aflTradePromotionBackedFactualReleaseSchema.parse(stored.rows[0]!.manifest_json);
}

export async function seedLocalAflTradeOutcomeArchive(client: AflOutcomeSqlClient) {
  const sourceAuthority = createLocalAflTradeOutcomeReleaseAuthority();
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  const initialGate = await gateRepository.load();
  const sourceGate = await gateRepository.append({
    expectedRevision: initialGate.revision,
    sourceRights: sourceAuthority.sourceRights,
    proposal: sourceAuthority.rights.proposal,
    decision: sourceAuthority.rights.decision,
  });
  const source = await seedLocalAflTradePromotionBackedSource(client, {
    sourceRightsArtifactId: sourceAuthority.sourceRights.rightsArtifactId,
    gateDecisionId: sourceAuthority.rights.decision.decisionId,
    gateDecisionKey: sourceAuthority.rights.decision.content.decisionKey,
    ledgerRevision: sourceGate.revision,
  });
  const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate: source.candidate,
    proposedAt: '2026-08-09T09:00:01.000Z',
    draftEvents: [
      {
        draftYear: 2025,
        draftType: 'national',
        officialName: '2025 AFL National Draft',
        eventDate: '2025-11-19',
      },
    ],
  });
  const promotionAuthority = createLocalAflTradeCanonicalPromotionAuthority({
    proposal,
    competition: 'AFLM',
    validFromSeason: 1988,
    validThroughSeason: 2025,
  });
  const promotionReview = await persistLocalAflTradeCanonicalPromotionAuthority({
    client,
    candidate: source.candidate,
    authority: promotionAuthority,
  });
  const promotion = await new PostgresAflTradeExternalCanonicalPromotionRepository(client).promote({
    candidateId: source.candidate.candidateId,
    approvalDecisionId: promotionAuthority.decision.decisionId,
  });
  const corpus = await new PostgresAflTradePromotionBackedCorpusRepository(client).build({
    environment: 'test_fixture',
    competition: 'AFLM',
    knowledgeCutoffAt: CORPUS_CUTOFF,
    createdAt: CORPUS_CREATED_AT,
  });
  const releaseRepository = new PostgresAflTradePromotionBackedFactualReleaseRepository(client);
  const gate2Repository = new PostgresAflTradePromotionBackedGate2Repository(client);
  const archiveRepository = new PostgresAflTradePromotionBackedPublicArchiveRepository(client);
  const preparation = await prepareAflTradePromotionBackedFactualPublication(
    {
      corpusId: corpus.corpusId,
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      releaseCreatedAt: RELEASE_CREATED_AT,
      lineageCreatedAt: LINEAGE_CREATED_AT,
      archiveCreatedAt: ARCHIVE_CREATED_AT,
    },
    { releaseRepository, gate2Repository, archiveRepository }
  );
  const archive = await archiveRepository.build({
    releaseId: preparation.releaseId,
    createdAt: ARCHIVE_CREATED_AT,
  });
  const publicationAuthority = createLocalAflTradePromotionBackedPublicationAuthority({
    scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2025,
    corpusId: corpus.corpusId,
    factualCandidateId: preparation.factualCandidateId,
    lineageId: preparation.lineageId,
    releaseId: preparation.releaseId,
    projectionId: archive.projection.projectionId,
    parityReportArtifactId: archive.projection.content.parityReport.artifact.artifactId,
    expectedActivationRegistryRevision: 3,
  });
  const publication = await persistLocalAflTradePromotionBackedPublicationAuthority({
    client,
    authority: publicationAuthority,
  });
  const admission = await gate2Repository.admit({
    lineageId: preparation.lineageId,
    evaluatedAt: '2026-08-09T09:00:09.000Z',
  });
  const manifest = await loadReleaseManifest(client, preparation.releaseId);
  const registryRepository = createPostgresAflDraftTradeOutcomeReleaseRepository(client);
  let registry = await registryRepository.loadRegistry();
  const alreadyPublished =
    registry.activeByScope[AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE]?.releaseId ===
    preparation.releaseId;
  if (!registry.releases[preparation.releaseId]) {
    registry = await registryRepository.register({
      expectedRevision: registry.revision,
      manifest,
      actor: 'local-fixture-seeder',
      evidenceId: evidenceId('register'),
      occurredAt: '2026-08-09T09:00:15.000Z',
    });
  }
  let state = registry.releases[preparation.releaseId]?.state;
  if (state === 'candidate') {
    registry = await registryRepository.apply({
      action: 'validate',
      releaseId: preparation.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-09T09:00:16.000Z',
      actor: 'local-fixture-seeder',
      evidenceId: evidenceId('validate'),
      environment: 'test_fixture',
      projectionManifest: archive.projection,
      gateDecisionLedger: publication.gateLedger,
    });
    state = 'validated';
  }
  if (state === 'validated') {
    registry = await registryRepository.apply({
      action: 'approve',
      releaseId: preparation.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-09T09:00:17.000Z',
      actor: 'local-fixture-seeder',
      evidenceId: evidenceId('approve'),
      environment: 'test_fixture',
      gateDecisionId: publicationAuthority.review.decision.decisionId,
      gateDecisionLedger: publication.gateLedger,
    });
    state = 'approved';
  }
  if (state === 'approved') {
    registry = await registryRepository.apply({
      action: 'activate',
      releaseId: preparation.releaseId,
      expectedRevision: registry.revision,
      occurredAt: '2026-08-09T09:00:18.000Z',
      actor: 'local-fixture-seeder',
      evidenceId: evidenceId('activate'),
      environment: 'test_fixture',
      gateDecisionId: publicationAuthority.operation.decision.decisionId,
      gateDecisionLedger: publication.gateLedger,
      sourceRightsDecisionLedger: publication.gateLedger,
      factualReviewDecisionLedger: publication.gateLedger,
      activationAuthorization: publicationAuthority.activation,
    });
    state = 'published';
  }
  if (state !== 'published') {
    throw new TypeError(`Local factual release could not be activated from ${String(state)}.`);
  }
  const sourceShapedTrade = source.candidate.content.transactions.find(
    ({ providerEventId }) => providerEventId === 'local-trade-2025-gws-western-bulldogs'
  );
  if (!sourceShapedTrade) {
    throw new TypeError('The source-shaped local factual rehearsal trade is unavailable.');
  }
  return {
    releaseId: preparation.releaseId,
    factualCandidateId: preparation.factualCandidateId,
    lineageId: preparation.lineageId,
    projectionId: preparation.projectionId,
    publicArchiveId: preparation.publicArchiveId,
    corpusId: corpus.corpusId,
    sourceCandidateId: source.candidate.candidateId,
    promotionId: promotion.promotionId,
    gate2DecisionKey: preparation.gate2DecisionKey,
    gate2AffectedArtifacts: preparation.gate2AffectedArtifacts,
    gate2AdmissionId: admission.admissionId,
    gate2DecisionId: admission.gate2DecisionId,
    tradeId: sourceShapedTrade.transactionId,
    archivedTradeCount: source.candidate.content.transactions.length,
    factualReleaseManifest: manifest,
    publicArchive: archive.archive,
    outcomeProjection: archive.projection,
    idempotentReplay:
      alreadyPublished &&
      sourceGate.idempotentReplay &&
      source.idempotentReplay &&
      promotionReview.idempotentReplay &&
      promotion.idempotentReplay &&
      corpus.idempotentReplay &&
      preparation.idempotentReplay &&
      archive.idempotentReplay &&
      publication.idempotentReplay &&
      admission.idempotentReplay,
  };
}
