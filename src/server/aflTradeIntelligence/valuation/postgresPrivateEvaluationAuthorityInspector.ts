import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflDraftTradeOutcomeAnyReleaseManifestSchema } from '../outcomes/outcomeReleaseContracts';
import { authenticateAflTradePrivateWorkbookTransactionPromotion } from '../source/postgresPrivateWorkbookTransactionPromotionRepository';
import { parseAflTradePrivateValuationEvaluationDecision } from './privateValuationEvaluationDecision';
import type {
  GovernedPrivateEvaluationSelector,
  PrivateEvaluationInspectionBlocker,
} from './governedPrivateTradeEvaluationContracts';
import type {
  PrivateEvaluationAuthorityInspection,
  PrivateEvaluationAuthorityInspector,
} from './postgresPrivateEvaluationInspectionStore';
import { inspectPostgresPrivateValuationAuthorityV3 } from './postgresPrivateValuationAuthorityV3Inspection';
import type {
  AflTradeAuthenticatedPrivateValuationAuthorityV3Chain,
  PostgresAflTradePrivateValuationAuthorityV3Registry,
} from './postgresPrivateValuationAuthorityV3Registry';
import { aflTradeValuationSourceQualificationReportSchema } from './valuationSourceQualificationReport';

interface HeadRow {
  readonly generation_id: string | null;
  readonly revision: number | string;
  readonly status: 'active' | 'withdrawn';
  readonly valuation_scope_key: string | null;
}

interface PromotionRow {
  readonly promotion_id: string;
  readonly review_set_id: string;
  readonly decision_id: string;
  readonly decision_json: unknown;
  readonly receipt_json: unknown;
  readonly source_artifact_sha256: string;
}

interface AuthorityRootRow {
  readonly factual_release_id: string;
  readonly factual_release_scope_key: string;
  readonly release_created_at: Date | string;
  readonly release_manifest_json: unknown;
  readonly qualification_report_json: unknown;
  readonly private_decision_json: unknown | null;
  readonly private_decision_status: 'authorized' | 'withdrawn' | null;
}

function confirmedResultBlocker(): PrivateEvaluationInspectionBlocker {
  return {
    code: 'confirmed_result_not_promoted',
    authorityClass: 'confirmed_result',
    classification: 'internal_evidence',
    assetId: null,
    message: 'No active confirmed transaction promotion exists for this trade.',
    evidenceRefs: [],
  };
}

function blocker(
  code:
    | 'source_use_not_authorized'
    | 'factual_release_not_active'
    | 'private_evaluation_not_authorized'
    | 'player_model_run_not_authorized'
    | 'pick_model_run_not_authorized'
    | 'player_gate3_not_approved'
    | 'pick_gate3_not_approved'
    | 'valuation_bundle_not_authorized',
  authorityClass: PrivateEvaluationInspectionBlocker['authorityClass'],
  message: string
): PrivateEvaluationInspectionBlocker {
  return {
    code,
    authorityClass,
    classification: 'external_authority',
    assetId: null,
    message,
    evidenceRefs: [],
  };
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation authority requires valid retained chronology.');
  }
  return parsed.toISOString();
}

function exactArtifactLists(
  left: readonly Parameters<typeof doAflTradeArtifactRefsExactlyMatch>[0][],
  right: readonly Parameters<typeof doAflTradeArtifactRefsExactlyMatch>[1][]
): boolean {
  return (
    left.length === right.length &&
    left.every((artifact, index) =>
      doAflTradeArtifactRefsExactlyMatch(artifact, right[index]!)
    )
  );
}

async function loadHead(
  transaction: AflOutcomeSqlTransaction,
  selector: GovernedPrivateEvaluationSelector
): Promise<PrivateEvaluationAuthorityInspection['expectedHead']> {
  const result = await transaction.query<HeadRow>(
    `SELECT head.generation_id,head.revision,head.status,
            generation.valuation_scope_key
       FROM outcome_local_private_trade_evaluation_head head
      LEFT JOIN outcome_local_private_trade_evaluation_generation generation
         ON generation.generation_id=head.generation_id
      WHERE head.trade_id=$1
      FOR KEY SHARE OF head`,
    [selector.tradeId]
  );
  if (result.rows.length === 0) {
    return { generationId: null, revision: 0, status: 'absent' };
  }
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    !row ||
    !Number.isSafeInteger(Number(row.revision)) ||
    Number(row.revision) <= 0 ||
    (row.status === 'active' &&
      (row.generation_id === null || row.valuation_scope_key !== selector.valuationScopeKey)) ||
    (row.status === 'withdrawn' && row.generation_id !== null)
  ) {
    throw new TypeError('Private evaluation lifecycle head failed exact authentication.');
  }
  return {
    generationId: row.generation_id,
    revision: Number(row.revision),
    status: row.status,
  };
}

export interface PostgresPrivateEvaluationAuthorityAuthentication {
  readonly inspection: PrivateEvaluationAuthorityInspection;
  readonly chain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain | null;
}

export async function authenticatePostgresPrivateEvaluationAuthority(
  transaction: AflOutcomeSqlTransaction,
  selector: GovernedPrivateEvaluationSelector,
  trustedAt: string,
  v3Registry: PostgresAflTradePrivateValuationAuthorityV3Registry
): Promise<PostgresPrivateEvaluationAuthorityAuthentication> {
  const expectedHead = await loadHead(transaction, selector);
  const promotion = await transaction.query<PromotionRow>(
    `SELECT promotion.promotion_id,promotion.review_set_id,promotion.decision_id,
            promotion.decision_json,promotion.receipt_json,review_set.source_artifact_sha256
       FROM outcome_private_workbook_transaction_promotion promotion
       JOIN outcome_workbook_transaction_review_set review_set
         ON review_set.review_set_id=promotion.review_set_id
      WHERE promotion.workbook_trade_id=$1 AND promotion.status='active'
      FOR KEY SHARE OF promotion,review_set`,
    [selector.tradeId]
  );
  if (promotion.rows.length === 0) {
    return {
      chain: null,
      inspection: {
        promotedWorkbookSha256: null,
        expectedHead,
        validThrough: null,
        evidence: [],
        blockers: [confirmedResultBlocker()],
      },
    };
  }
  const promotionRow = promotion.rows[0];
  if (promotion.rows.length !== 1 || !promotionRow) {
    throw new TypeError('Private transaction promotion is ambiguous.');
  }
  const authenticatedPromotion = authenticateAflTradePrivateWorkbookTransactionPromotion({
    workbookTradeId: selector.tradeId,
    reviewSetId: promotionRow.review_set_id,
    promotionId: promotionRow.promotion_id,
    decisionId: promotionRow.decision_id,
    decisionDocument: promotionRow.decision_json,
    receiptDocument: promotionRow.receipt_json,
  });
  const roots = await transaction.query<AuthorityRootRow>(
    `SELECT qualification.factual_release_id,
            qualification.factual_release_scope_key,
            release.created_at AS release_created_at,
            release.manifest_json AS release_manifest_json,
            qualification.report_json AS qualification_report_json,
            private_head.status AS private_decision_status,
            private_decision.decision_json AS private_decision_json
       FROM outcome_valuation_source_qualification_report qualification
       JOIN outcome_release_manifest release
         ON release.release_id=qualification.factual_release_id
        AND release.scope_key=qualification.factual_release_scope_key
        AND release.environment='non_production'
       JOIN outcome_active_release active
         ON active.release_id=release.release_id AND active.scope_key=release.scope_key
  LEFT JOIN outcome_private_valuation_evaluation_head private_head
         ON private_head.valuation_scope_key=qualification.valuation_scope_key
        AND private_head.factual_release_id=qualification.factual_release_id
  LEFT JOIN outcome_private_valuation_evaluation_decision private_decision
         ON private_decision.decision_id=private_head.decision_id
        AND private_decision.factual_release_id=private_head.factual_release_id
      WHERE qualification.valuation_scope_key=$1
        AND qualification.finalized_at IS NOT NULL
      ORDER BY qualification.evaluated_at DESC,qualification.qualification_report_id DESC
      LIMIT 1
      FOR KEY SHARE OF qualification,release,active`,
    [selector.valuationScopeKey]
  );
  const blockers: PrivateEvaluationInspectionBlocker[] = [];
  let evaluatedTradeAuthority: {
    factualReleaseId: string;
    transactionEventVersionId: string;
    assetVersionIds: readonly string[];
  } | null = null;
  const evidence: PrivateEvaluationAuthorityInspection['evidence'][number][] = [
    {
      role: 'transaction_promotion',
      source: 'postgres_json',
      document: authenticatedPromotion.decision,
      createdAt: authenticatedPromotion.decision.content.decidedAt,
    },
    {
      role: 'confirmed_result',
      source: 'postgres_json',
      document: authenticatedPromotion.receipt,
      createdAt: authenticatedPromotion.decision.content.decidedAt,
    },
  ];
  const authority = roots.rows[0];
  if (roots.rows.length === 0) {
    blockers.push(
      blocker(
        'factual_release_not_active',
        'factual_release',
        'No current non-production factual release is bound to this valuation scope.'
      ),
      blocker(
        'source_use_not_authorized',
        'source_use',
        'No current source-use qualification authorizes this trade and factual release.'
      ),
      blocker(
        'private_evaluation_not_authorized',
        'private_evaluation',
        'No current private evaluation decision authorizes an exact factual release.'
      )
    );
  } else {
    if (roots.rows.length !== 1 || !authority) {
      throw new TypeError('Private evaluation authority roots are ambiguous.');
    }
    const release = aflDraftTradeOutcomeAnyReleaseManifestSchema.parse(
      authority.release_manifest_json
    );
    const qualification = aflTradeValuationSourceQualificationReportSchema.parse(
      authority.qualification_report_json
    );
    const releaseCreatedAt = iso(authority.release_created_at);
    const canonicalMembers = (release.content as { canonicalMembers?: unknown }).canonicalMembers;
    if (!Array.isArray(canonicalMembers)) {
      throw new TypeError('Qualified factual release lacks exact canonical membership.');
    }
    const releaseArtifact = createAflTradeCanonicalJsonArtifactRef(release, releaseCreatedAt);
    const membershipArtifact = createAflTradeCanonicalJsonArtifactRef(
      canonicalMembers,
      releaseCreatedAt
    );
    if (
      release.releaseId !== authority.factual_release_id ||
      release.content.scopeKey !== authority.factual_release_scope_key ||
      release.content.environment !== 'non_production' ||
      release.content.createdAt !== releaseCreatedAt ||
      qualification.content.valuationScopeKey !== selector.valuationScopeKey ||
      qualification.content.factualReleaseId !== release.releaseId ||
      qualification.content.factualReleaseScopeKey !== release.content.scopeKey ||
      !qualification.content.releaseTradeIds.includes(
        authenticatedPromotion.receipt.canonicalTransaction.eventVersionId
      ) ||
      !doAflTradeArtifactRefsExactlyMatch(
        qualification.content.factualReleaseArtifact,
        releaseArtifact
      ) ||
      !doAflTradeArtifactRefsExactlyMatch(
        qualification.content.releaseMembershipArtifact,
        membershipArtifact
      )
    ) {
      throw new TypeError('Private evaluation source-use ancestry failed exact authentication.');
    }
    evidence.push(
      {
        role: 'factual_release',
        source: 'postgres_json',
        document: release,
        createdAt: releaseCreatedAt,
      },
      {
        role: 'source_use',
        source: 'postgres_json',
        document: qualification,
        createdAt: qualification.content.evaluatedAt,
      }
    );
    if (qualification.content.decision.state !== 'eligible_for_dataset_admission') {
      blockers.push(
        blocker(
          'source_use_not_authorized',
          'source_use',
          'The current source-use qualification blocks this trade or factual release.'
        )
      );
    }
    if (authority.private_decision_status !== 'authorized') {
      blockers.push(
        blocker(
          'private_evaluation_not_authorized',
          'private_evaluation',
          'No current private evaluation decision authorizes the selected factual release.'
        )
      );
    } else {
      const privateDecision = parseAflTradePrivateValuationEvaluationDecision(
        authority.private_decision_json
      );
      if (
        privateDecision.content.status !== 'authorized' ||
        privateDecision.content.valuationScopeKey !== selector.valuationScopeKey ||
        privateDecision.content.factualReleaseId !== release.releaseId ||
        privateDecision.content.factualReleaseScopeKey !== release.content.scopeKey ||
        !doAflTradeArtifactRefsExactlyMatch(
          privateDecision.content.factualReleaseArtifact,
          releaseArtifact
        ) ||
        !doAflTradeArtifactRefsExactlyMatch(
          privateDecision.content.releaseMembershipArtifact,
          membershipArtifact
        ) ||
        !exactArtifactLists(
          privateDecision.content.sourceRightsEvidenceRefs,
          qualification.content.sourceRightsEvidenceRefs
        )
      ) {
        throw new TypeError(
          'Private valuation evaluation decision failed exact release authentication.'
        );
      }
      evidence.push({
        role: 'private_evaluation',
        source: 'postgres_json',
        document: privateDecision,
        createdAt: privateDecision.content.decidedAt,
      });
      if (qualification.content.decision.state === 'eligible_for_dataset_admission') {
        evaluatedTradeAuthority = {
          factualReleaseId: release.releaseId,
          transactionEventVersionId:
            authenticatedPromotion.receipt.canonicalTransaction.eventVersionId,
          assetVersionIds: authenticatedPromotion.receipt.canonicalTransaction.assets
            .map(({ assetVersionId }) => assetVersionId)
            .sort(),
        };
      }
    }
  }
  let validThrough: string | null = null;
  let authenticatedChain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain | null = null;
  if (blockers.length === 0 && evaluatedTradeAuthority !== null) {
    const v3Authority = await inspectPostgresPrivateValuationAuthorityV3(transaction, {
      valuationScopeKey: selector.valuationScopeKey,
      trustedAt,
      registry: v3Registry,
    });
    evidence.push(...v3Authority.evidence);
    blockers.push(...v3Authority.blockers);
    validThrough = v3Authority.validThrough;
    if (v3Authority.state === 'ready') {
      authenticatedChain = v3Authority.chain;
      const evaluated = v3Authority.chain.bundle.content.evaluatedTrade;
      if (
        evaluated.factualReleaseId !== evaluatedTradeAuthority.factualReleaseId ||
        evaluated.transactionEventVersionId !==
          evaluatedTradeAuthority.transactionEventVersionId ||
        evaluated.assetVersionIds.length !== evaluatedTradeAuthority.assetVersionIds.length ||
        evaluated.assetVersionIds.some(
          (assetVersionId, index) =>
            assetVersionId !== evaluatedTradeAuthority.assetVersionIds[index]
        ) ||
        v3Authority.chain.evidenceBundle.content.tradeId !== selector.tradeId
      ) {
        throw new TypeError(
          'Private valuation v3 authority escaped the exact promoted transaction.'
        );
      }
    }
  } else {
    blockers.push(
      {
        code: 'evaluation_evidence_bundle_unavailable',
        authorityClass: 'evaluation_evidence',
        classification: 'internal_evidence',
        assetId: null,
        message:
          'No complete retained v3 evaluation-evidence bundle covers every exact trade asset.',
        evidenceRefs: [],
      },
      {
        code: 'evaluation_evidence_gate3_not_approved',
        authorityClass: 'gate_3',
        classification: 'external_authority',
        assetId: null,
        message:
          'No current external Gate 3 decision approves an exact v3 evaluation-evidence bundle.',
        evidenceRefs: [],
      },
      blocker(
        'player_model_run_not_authorized',
        'model_run',
        'No succeeded governed player model run is bound to the selected factual release.'
      ),
      blocker(
        'pick_model_run_not_authorized',
        'model_run',
        'No governed pick model candidate is bound to the selected factual release.'
      ),
      blocker(
        'player_gate3_not_approved',
        'gate_3',
        'No current non-production Gate 3 decision approves the governed player model run.'
      ),
      blocker(
        'pick_gate3_not_approved',
        'gate_3',
        'No current non-production Gate 3 decision approves the governed pick model candidate.'
      ),
      blocker(
        'valuation_bundle_not_authorized',
        'valuation_bundle',
        'No current governed valuation bundle and Gate 3 decision are retained.'
      )
    );
  }
  return {
    chain: authenticatedChain,
    inspection: {
      promotedWorkbookSha256: promotionRow.source_artifact_sha256,
      expectedHead,
      validThrough: blockers.length === 0 ? validThrough : null,
      evidence,
      blockers,
    },
  };
}

export function createPostgresPrivateEvaluationAuthorityInspector(dependencies: {
  readonly v3Registry: PostgresAflTradePrivateValuationAuthorityV3Registry;
}): PrivateEvaluationAuthorityInspector {
  return async (transaction, selector, trustedAt) =>
    (
      await authenticatePostgresPrivateEvaluationAuthority(
        transaction,
        selector,
        trustedAt,
        dependencies.v3Registry
      )
    ).inspection;
}
