import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import { PostgresAflTradeExternalCanonicalPromotionReviewRepository } from '../source/postgresExternalCanonicalPromotionReviewRepository';
import type {
  createLocalAflTradeCanonicalPromotionAuthority,
  createLocalAflTradePromotionBackedAuthority,
  createLocalAflTradePromotionBackedPublicationAuthority,
} from './localPromotionBackedAuthority';

type LocalAuthority = ReturnType<typeof createLocalAflTradePromotionBackedAuthority>;
type LocalPromotionAuthority = ReturnType<typeof createLocalAflTradeCanonicalPromotionAuthority>;
type LocalPublicationAuthority = ReturnType<
  typeof createLocalAflTradePromotionBackedPublicationAuthority
>;

interface StoredAuthorityRow extends Record<string, unknown> {
  reference_sha256: string;
  evidence_canonical_json: string;
  principal_ref: string;
  role: string;
  scope_key: string;
  provider: string;
  capability_id: string;
  competition: string;
  valid_from_season: number;
  valid_through_season: number;
}

interface StoredApprovalRow extends Record<string, unknown> {
  decision_id: string;
  decision: string;
  rationale: string;
  evidence_json: unknown;
  decided_by: string;
  decided_at: Date | string;
}

async function seedPromotionReviewerAuthority(
  client: AflOutcomeSqlClient,
  promotion: LocalPromotionAuthority
): Promise<void> {
  const authorityCanonical = canonicalizeAflTradeJson(promotion.authorityPayload);
  await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,'application/json',$4,'derived_private','test_fixture',$5,$6,$7::jsonb)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        promotion.authorityArtifactId,
        promotion.authoritySha256,
        `artifact://sha256/${promotion.authoritySha256}`,
        Buffer.byteLength(authorityCanonical),
        '2026-08-09T08:58:00.000Z',
        '2026-08-09T08:59:00.000Z',
        canonicalizeAflTradeJson({ fixture: true, authorityId: promotion.authorityId }),
      ]
    );
    const approvalRationale =
      'Approve the deterministic local canonical-promotion reviewer authority.';
    const approvalEvidence = { referenceSha256: promotion.authoritySha256 };
    const approvalEvidenceCanonical = canonicalizeAflTradeJson(approvalEvidence);
    const approval = await transaction.query<StoredApprovalRow>(
      `SELECT decision_id,decision,rationale,evidence_json,decided_by,decided_at
         FROM outcome_review_decision
        WHERE subject_type='governed_evidence_reference' AND subject_id=$1
        FOR SHARE`,
      [promotion.authorityId]
    );
    if (approval.rows.length === 0) {
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'governed_evidence_reference',$2,'approved',$3,$4::jsonb,
                 'local-fixture-governance-reviewer',$5)`,
        [
          promotion.authorityApprovalId,
          promotion.authorityId,
          approvalRationale,
          approvalEvidenceCanonical,
          '2026-08-09T08:59:00.000Z',
        ]
      );
    } else {
      const existing = approval.rows[0];
      if (
        approval.rows.length !== 1 ||
        !existing ||
        existing.decision_id !== promotion.authorityApprovalId ||
        existing.decision !== 'approved' ||
        existing.rationale !== approvalRationale ||
        canonicalizeAflTradeJson(existing.evidence_json) !== approvalEvidenceCanonical ||
        existing.decided_by !== 'local-fixture-governance-reviewer' ||
        new Date(existing.decided_at).toISOString() !== '2026-08-09T08:59:00.000Z'
      ) {
        throw new TypeError('Stored local promotion authority approval differs from the fixture.');
      }
    }
    await transaction.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6,$7::jsonb)
       ON CONFLICT (reference_id) DO NOTHING`,
      [
        promotion.authorityId,
        promotion.authoritySha256,
        promotion.authorityArtifactId,
        promotion.authorityApprovalId,
        '2026-08-09T08:59:00.000Z',
        authorityCanonical,
        authorityCanonical,
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_operational_principal_authority
        (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,
         valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES ($1,$2,'afl_trade_canonical_promoter','public-afl-draft-trade-outcomes',
               'multi_source','external_candidate_promotion',$3,$4,$5,$6,NULL)
       ON CONFLICT (authority_evidence_id) DO NOTHING`,
      [
        promotion.authorityId,
        promotion.principalRef,
        promotion.authorityPayload.competition,
        promotion.authorityPayload.validFromSeason,
        promotion.authorityPayload.validThroughSeason,
        '2026-01-01T00:00:00.000Z',
      ]
    );
    const stored = await transaction.query<StoredAuthorityRow>(
      `SELECT evidence.reference_sha256,evidence.evidence_canonical_json,
              authority.principal_ref,authority.role,authority.scope_key,authority.provider,
              authority.capability_id,authority.competition,authority.valid_from_season,
              authority.valid_through_season
         FROM outcome_governed_evidence_reference evidence
         JOIN outcome_operational_principal_authority authority
           ON authority.authority_evidence_id=evidence.reference_id
        WHERE evidence.reference_id=$1 FOR SHARE OF evidence,authority`,
      [promotion.authorityId]
    );
    const row = stored.rows[0];
    if (
      stored.rows.length !== 1 ||
      !row ||
      row.reference_sha256 !== promotion.authoritySha256 ||
      row.evidence_canonical_json !== authorityCanonical ||
      row.principal_ref !== promotion.principalRef ||
      row.role !== promotion.authorityPayload.role ||
      row.scope_key !== promotion.authorityPayload.scopeKey ||
      row.provider !== promotion.authorityPayload.provider ||
      row.capability_id !== promotion.authorityPayload.capabilityId ||
      row.competition !== promotion.authorityPayload.competition ||
      row.valid_from_season !== promotion.authorityPayload.validFromSeason ||
      row.valid_through_season !== promotion.authorityPayload.validThroughSeason
    ) {
      throw new TypeError('Stored local promotion reviewer authority differs from the fixture.');
    }
  });
}

export async function persistLocalAflTradeCanonicalPromotionAuthority(input: {
  client: AflOutcomeSqlClient;
  candidate: AflTradeExternalReconciliationCandidateRecord;
  authority: LocalPromotionAuthority;
}) {
  await seedPromotionReviewerAuthority(input.client, input.authority);
  const promotionRepository = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(
    input.client
  );
  const promotionReview = await promotionRepository.persistDecision({
    candidate: input.candidate,
    proposal: input.authority.decision.content.proposal,
    decision: input.authority.decision,
  });
  return {
    promotionReview,
    idempotentReplay: promotionReview.idempotentReplay,
    authoritySha256: sha256AflTradeCanonicalJson(input.authority),
  };
}

export async function persistLocalAflTradePromotionBackedPublicationAuthority(input: {
  client: AflOutcomeSqlClient;
  authority: LocalPublicationAuthority;
}) {
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(input.client);
  const gateReplays: boolean[] = [];
  for (const gate of [input.authority.gate2, input.authority.review, input.authority.operation]) {
    const current = await gateRepository.load();
    const appended = await gateRepository.appendDecision({
      expectedRevision: current.revision,
      proposal: gate.proposal,
      decision: gate.decision,
    });
    gateReplays.push(appended.idempotentReplay);
  }
  const stored = await gateRepository.load();
  return {
    gateLedger: stored.ledger,
    gateLedgerRevision: stored.revision,
    idempotentReplay: gateReplays.every((replay) => replay),
    authoritySha256: sha256AflTradeCanonicalJson(input.authority),
  };
}

export async function persistLocalAflTradePromotionBackedAuthority(input: {
  client: AflOutcomeSqlClient;
  candidate: AflTradeExternalReconciliationCandidateRecord;
  authority: LocalAuthority;
}) {
  const promotion = await persistLocalAflTradeCanonicalPromotionAuthority({
    client: input.client,
    candidate: input.candidate,
    authority: input.authority.promotion,
  });
  const publication = await persistLocalAflTradePromotionBackedPublicationAuthority({
    client: input.client,
    authority: input.authority,
  });
  return {
    promotionReview: promotion.promotionReview,
    gateLedger: publication.gateLedger,
    gateLedgerRevision: publication.gateLedgerRevision,
    idempotentReplay: promotion.idempotentReplay && publication.idempotentReplay,
    authoritySha256: sha256AflTradeCanonicalJson(input.authority),
  };
}
