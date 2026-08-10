import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  type AflTradeExternalIdentityResolution,
} from './externalEvidenceReconciliation';
import {
  aflTradeExternalIdentityReviewDecisionSchema,
  aflTradeExternalIdentityReviewPackageSchema,
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  type AflTradeExternalIdentityReviewDecision,
  type AflTradeExternalIdentityReviewPackage,
} from './externalIdentityReviewContracts';

export interface PersistAflTradeExternalIdentityReviewInput {
  reviewPackage: unknown;
  decision: unknown;
}

export interface PersistedAflTradeExternalIdentityReview {
  subjectId: string;
  decisionId: string;
  revision: number;
  status: 'approved' | 'rejected' | 'withdrawn';
  idempotentReplay: boolean;
}

export class AflTradeExternalIdentityReviewPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DECISION'
      | 'PACKAGE_MISMATCH'
      | 'STALE_REVISION'
      | 'TARGET_UNAVAILABLE'
      | 'AUTHORITY_UNAVAILABLE'
      | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalIdentityReviewPersistenceError';
  }
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function parseInput(input: PersistAflTradeExternalIdentityReviewInput): {
  reviewPackage: AflTradeExternalIdentityReviewPackage;
  decision: AflTradeExternalIdentityReviewDecision;
} {
  try {
    const reviewPackage = aflTradeExternalIdentityReviewPackageSchema.parse(input.reviewPackage);
    const decision = aflTradeExternalIdentityReviewDecisionSchema.parse(input.decision);
    const membership = reviewPackage.content.items.find(
      ({ subjectId }) => subjectId === decision.content.subject.subjectId
    );
    if (
      decision.content.reviewPackageId !== reviewPackage.packageId ||
      decision.content.reviewPackageSha256 !== reviewPackage.packageId.split(':')[1] ||
      membership?.workItemId !== decision.content.workItemId ||
      !exactJson(membership?.workItem, decision.content.workItem) ||
      decision.content.subject.content.environment !== reviewPackage.content.environment ||
      decision.content.subject.content.competition !== reviewPackage.content.competition ||
      Date.parse(decision.content.decidedAt) < Date.parse(reviewPackage.content.completedAt)
    ) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'PACKAGE_MISMATCH',
        'Identity decision does not bind one exact work item in the reviewed completion package.'
      );
    }
    return { reviewPackage, decision };
  } catch (error) {
    if (error instanceof AflTradeExternalIdentityReviewPersistenceError) throw error;
    throw new AflTradeExternalIdentityReviewPersistenceError(
      'INVALID_DECISION',
      error instanceof Error ? error.message : 'External identity decision is invalid.'
    );
  }
}

interface HeadRow {
  subject_id: string;
  revision: number | string;
  decision_id: string;
  status: string;
  updated_at: string | Date;
}

function instant(value: string | Date): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

async function loadHead(
  transaction: AflOutcomeSqlTransaction,
  subjectId: string
): Promise<HeadRow | null> {
  const result = await transaction.query<HeadRow>(
    `SELECT head.subject_id,head.revision,head.decision_id,head.status,head.updated_at
       FROM outcome_external_identity_resolution_head head
      WHERE head.subject_id=$1
      FOR UPDATE`,
    [subjectId]
  );
  if (result.rows.length > 1) {
    throw new AflTradeExternalIdentityReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'External identity subject has more than one current head.'
    );
  }
  return result.rows[0] ?? null;
}

async function requireTarget(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeExternalIdentityReviewDecision
): Promise<void> {
  const target = decision.content.canonicalTarget;
  if (target === null) return;
  const table = target.entityKind === 'club' ? 'outcome_club' : 'outcome_player';
  const idColumn = target.entityKind === 'club' ? 'club_id' : 'player_id';
  const labelColumn = target.entityKind === 'club' ? 'current_name' : 'display_name';
  const result = await transaction.query<{
    canonical_id: string;
    recorded_label: string;
    status: string;
  }>(
    `SELECT ${idColumn} AS canonical_id,${labelColumn} AS recorded_label,status::text AS status
       FROM ${table}
      WHERE ${idColumn}=$1
      FOR SHARE`,
    [target.canonicalId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.canonical_id !== target.canonicalId ||
    row.recorded_label !== target.recordedLabel ||
    row.status !== 'approved'
  ) {
    throw new AflTradeExternalIdentityReviewPersistenceError(
      'TARGET_UNAVAILABLE',
      'External identity decision target is absent, unapproved, or differs from its snapshot.'
    );
  }
}

async function requireAuthority(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeExternalIdentityReviewDecision
): Promise<void> {
  const content = decision.content;
  const subject = content.subject.content;
  const result = await transaction.query<{ authority_evidence_id: string }>(
    `SELECT authority.authority_evidence_id
       FROM outcome_operational_principal_authority authority
       JOIN outcome_governed_evidence_reference evidence
         ON evidence.reference_id=authority.authority_evidence_id
       JOIN outcome_review_decision approval
         ON approval.decision_id=evidence.approval_decision_id
      WHERE authority.authority_evidence_id=$1
        AND authority.principal_ref=$2
        AND authority.role='afl_trade_external_identity_reviewer'
        AND authority.scope_key='public-afl-draft-trade-outcomes'
        AND authority.provider=$3
        AND authority.capability_id='external_identity_resolution'
        AND authority.competition=$4
        AND $5::integer>=authority.valid_from_season
        AND $6::integer<=authority.valid_through_season
        AND authority.valid_from<=statement_timestamp()
        AND (authority.valid_through IS NULL OR authority.valid_through>statement_timestamp())
        AND authority.valid_from<=$7::timestamptz
        AND (authority.valid_through IS NULL OR authority.valid_through>$7::timestamptz)
        AND evidence.environment=$8::"OutcomeEnvironment"
        AND evidence.status='approved'::"OutcomeRecordStatus"
        AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=approval.decision_id)
      FOR SHARE OF authority,evidence,approval`,
    [
      content.authorityEvidenceId,
      content.decidedBy,
      subject.provider,
      subject.competition,
      content.workItem.content.validFromSeason,
      content.workItem.content.validThroughSeason,
      content.decidedAt,
      subject.environment,
    ]
  );
  if (
    result.rows.length !== 1 ||
    result.rows[0]?.authority_evidence_id !== content.authorityEvidenceId
  ) {
    throw new AflTradeExternalIdentityReviewPersistenceError(
      'AUTHORITY_UNAVAILABLE',
      'External identity reviewer lacks exact current provider, competition, season, and environment authority.'
    );
  }
}

async function insertOrVerifySubject(
  transaction: AflOutcomeSqlTransaction,
  reviewPackage: AflTradeExternalIdentityReviewPackage,
  decision: AflTradeExternalIdentityReviewDecision
): Promise<void> {
  const subject = decision.content.subject;
  const content = subject.content;
  const identityScope = content.identityScope;
  await transaction.query(
    `INSERT INTO outcome_external_identity_subject
      (subject_id,environment,competition,provider,entity_kind,scope_kind,native_id,
       recorded_name,season_year,subject_sha256,subject_canonical_json,subject_json,created_at)
     VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     ON CONFLICT (subject_id) DO NOTHING`,
    [
      subject.subjectId,
      content.environment,
      content.competition,
      content.provider,
      content.entityKind,
      content.identityScope.kind,
      identityScope.kind === 'provider_native_id' ? identityScope.nativeId : null,
      identityScope.kind === 'exact_recorded_name' ? identityScope.recordedName : null,
      identityScope.kind === 'exact_recorded_name' ? identityScope.seasonYear : null,
      subject.subjectId.split(':')[1],
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(subject),
      reviewPackage.content.completedAt,
    ]
  );
  const exact = await transaction.query<{ subject_json: unknown }>(
    `SELECT subject_json FROM outcome_external_identity_subject
      WHERE subject_id=$1 FOR SHARE`,
    [subject.subjectId]
  );
  if (exact.rows.length !== 1 || !exactJson(exact.rows[0]?.subject_json, subject)) {
    throw new AflTradeExternalIdentityReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'External identity subject is already bound to different scope evidence.'
    );
  }
}

async function insertDecisionRows(
  transaction: AflOutcomeSqlTransaction,
  reviewPackage: AflTradeExternalIdentityReviewPackage,
  decision: AflTradeExternalIdentityReviewDecision,
  head: HeadRow | null
): Promise<void> {
  const content = decision.content;
  const target = content.canonicalTarget;
  await transaction.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,
       supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'external_provider_identity',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      decision.decisionId,
      content.subject.subjectId,
      content.decision,
      target?.entityKind ?? null,
      target?.canonicalId ?? null,
      content.supersedesDecisionId,
      content.rationale,
      canonicalizeAflTradeJson(decision),
      content.decidedBy,
      content.decidedAt,
    ]
  );
  await transaction.query(
    `INSERT INTO outcome_external_identity_review_decision
      (decision_id,subject_id,historical_completion_id,review_package_id,work_item_id,
       work_item_sha256,work_item_canonical_json,revision,outcome,canonical_target_kind,
       canonical_target_id,canonical_target_snapshot_sha256,canonical_target_canonical_json,
       authority_evidence_id,supersedes_decision_id,decision_sha256,decision_canonical_json,
       decision_json,decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)`,
    [
      decision.decisionId,
      content.subject.subjectId,
      reviewPackage.content.completionId,
      content.reviewPackageId,
      content.workItemId,
      content.workItemSha256,
      canonicalizeAflTradeJson(content.workItem.content),
      content.revision,
      content.decision,
      target?.entityKind ?? null,
      target?.canonicalId ?? null,
      target?.snapshotSha256 ?? null,
      target === null
        ? null
        : canonicalizeAflTradeJson({
            entityKind: target.entityKind,
            canonicalId: target.canonicalId,
            recordedLabel: target.recordedLabel,
            status: target.status,
          }),
      content.authorityEvidenceId,
      content.supersedesDecisionId,
      decision.decisionId.split(':')[1],
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(decision),
      content.decidedAt,
    ]
  );
  if (head === null) {
    await transaction.query(
      `INSERT INTO outcome_external_identity_resolution_head
        (subject_id,revision,decision_id,status,updated_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        content.subject.subjectId,
        content.revision,
        decision.decisionId,
        content.decision,
        content.decidedAt,
      ]
    );
  } else {
    const updated = await transaction.query(
      `UPDATE outcome_external_identity_resolution_head
          SET revision=$2,decision_id=$3,status=$4,updated_at=$5
        WHERE subject_id=$1 AND revision=$6 AND decision_id=$7
        RETURNING subject_id`,
      [
        content.subject.subjectId,
        content.revision,
        decision.decisionId,
        content.decision,
        content.decidedAt,
        Number(head.revision),
        head.decision_id,
      ]
    );
    if (updated.rows.length !== 1) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'STALE_REVISION',
        'External identity review head changed before compare-and-swap completed.'
      );
    }
  }
}

export class PostgresAflTradeExternalIdentityReviewRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistDecision(
    input: PersistAflTradeExternalIdentityReviewInput
  ): Promise<PersistedAflTradeExternalIdentityReview> {
    const { reviewPackage, decision } = parseInput(input);
    const content = decision.content;
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-identity:${content.subject.subjectId}`,
      ]);
      const existing = await transaction.query<{ decision_json: unknown }>(
        `SELECT typed.decision_json
           FROM outcome_external_identity_review_decision typed
          WHERE typed.decision_id=$1
          FOR SHARE`,
        [decision.decisionId]
      );
      const head = await loadHead(transaction, content.subject.subjectId);
      if (existing.rows.length > 0) {
        if (
          existing.rows.length !== 1 ||
          !exactJson(existing.rows[0]?.decision_json, decision) ||
          head?.decision_id !== decision.decisionId ||
          Number(head.revision) !== content.revision
        ) {
          throw new AflTradeExternalIdentityReviewPersistenceError(
            'STALE_REVISION',
            'Exact external identity decision is no longer the current subject revision.'
          );
        }
        return {
          subjectId: content.subject.subjectId,
          decisionId: decision.decisionId,
          revision: content.revision,
          status: content.decision,
          idempotentReplay: true,
        };
      }
      if (
        (head === null && (content.revision !== 1 || content.supersedesDecisionId !== null)) ||
        (head !== null &&
          (content.revision !== Number(head.revision) + 1 ||
            content.supersedesDecisionId !== head.decision_id ||
            Date.parse(content.decidedAt) < Date.parse(instant(head.updated_at))))
      ) {
        throw new AflTradeExternalIdentityReviewPersistenceError(
          'STALE_REVISION',
          'External identity decision does not advance the exact current subject revision.'
        );
      }
      await requireTarget(transaction, decision);
      await requireAuthority(transaction, decision);
      await insertOrVerifySubject(transaction, reviewPackage, decision);
      await insertDecisionRows(transaction, reviewPackage, decision, head);
      return {
        subjectId: content.subject.subjectId,
        decisionId: decision.decisionId,
        revision: content.revision,
        status: content.decision,
        idempotentReplay: false,
      };
    });
  }

  async loadCurrentResolutions(
    unparsedPackage: unknown
  ): Promise<AflTradeExternalIdentityResolution[]> {
    const reviewPackage = aflTradeExternalIdentityReviewPackageSchema.parse(unparsedPackage);
    const currentDecisions = await this.loadCurrentDecisions(reviewPackage);
    const bySubject = new Map(
      currentDecisions
        .filter(({ content }) => content.decision === 'approved')
        .map((decision) => [decision.content.subject.subjectId, decision])
    );
    const resolutions: AflTradeExternalIdentityResolution[] = [];
    const seen = new Set<string>();
    reviewPackage.content.items.forEach(({ subjectId, workItem }) => {
      const decision = bySubject.get(subjectId);
      if (!decision || decision.content.workItemId !== workItem.workItemId) return;
      const target = decision.content.canonicalTarget;
      if (target === null) return;
      workItem.content.observations.forEach(({ sourceIdentity }) => {
        const key = [
          workItem.content.subject.content.provider,
          workItem.content.subject.content.entityKind,
          sourceIdentity.nativeId ?? '',
          sourceIdentity.recordedName,
        ].join('\0');
        if (seen.has(key)) return;
        seen.add(key);
        resolutions.push(
          createAflTradeExternalIdentityResolution({
            schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
            provider: workItem.content.subject.content.provider,
            entityKind: workItem.content.subject.content.entityKind,
            sourceIdentity,
            canonicalId: target.canonicalId,
            reviewDecisionId: decision.decisionId,
            reviewDecisionSha256: decision.decisionId.split(':')[1]!,
            decidedAt: decision.content.decidedAt,
            status: 'current_approved',
          })
        );
      });
    });
    return resolutions.sort((left, right) => left.resolutionId.localeCompare(right.resolutionId));
  }

  async loadCurrentDecisions(
    unparsedPackage: unknown
  ): Promise<AflTradeExternalIdentityReviewDecision[]> {
    const reviewPackage = aflTradeExternalIdentityReviewPackageSchema.parse(unparsedPackage);
    const subjectIds = reviewPackage.content.items.map(({ subjectId }) => subjectId);
    const result = await this.client.query<{
      subject_id: string;
      revision: number | string;
      decision_id: string;
      status: string;
      decision_json: unknown;
      current: boolean;
    }>(
      `SELECT head.subject_id,head.revision,head.decision_id,head.status,typed.decision_json,
              NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                           WHERE successor.supersedes_decision_id=head.decision_id) AS current
         FROM outcome_external_identity_resolution_head head
         JOIN outcome_external_identity_review_decision typed ON typed.decision_id=head.decision_id
         JOIN outcome_review_decision decision ON decision.decision_id=head.decision_id
        WHERE head.subject_id=ANY($1::text[])
        ORDER BY head.subject_id
        FOR SHARE OF head,typed,decision`,
      [subjectIds]
    );
    return result.rows.map((row) => {
      if (row.current !== true) {
        throw new AflTradeExternalIdentityReviewPersistenceError(
          'IMMUTABLE_CONFLICT',
          'External identity review head does not point to a current generic decision.'
        );
      }
      const decision = aflTradeExternalIdentityReviewDecisionSchema.parse(row.decision_json);
      if (
        decision.content.subject.subjectId !== row.subject_id ||
        decision.decisionId !== row.decision_id ||
        decision.content.revision !== Number(row.revision) ||
        decision.content.decision !== row.status
      ) {
        throw new AflTradeExternalIdentityReviewPersistenceError(
          'IMMUTABLE_CONFLICT',
          'External identity review head does not match its typed current decision.'
        );
      }
      return decision;
    });
  }

  async loadCurrentDecision(
    subjectIdInput: string
  ): Promise<AflTradeExternalIdentityReviewDecision | null> {
    const subjectId = aflTradeContentAddressedIdSchema('external-identity-subject').parse(
      subjectIdInput
    );
    const result = await this.client.query<{
      subject_id: string;
      revision: number | string;
      decision_id: string;
      status: string;
      decision_json: unknown;
      current: boolean;
    }>(
      `SELECT head.subject_id,head.revision,head.decision_id,head.status,typed.decision_json,
              NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                           WHERE successor.supersedes_decision_id=head.decision_id) AS current
         FROM outcome_external_identity_resolution_head head
         JOIN outcome_external_identity_review_decision typed ON typed.decision_id=head.decision_id
         JOIN outcome_review_decision decision ON decision.decision_id=head.decision_id
        WHERE head.subject_id=$1
        FOR SHARE OF head,typed,decision`,
      [subjectId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || row.current !== true) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'IMMUTABLE_CONFLICT',
        'External identity review head is missing its sole current decision.'
      );
    }
    const decision = aflTradeExternalIdentityReviewDecisionSchema.parse(row.decision_json);
    if (
      decision.content.subject.subjectId !== subjectId ||
      decision.decisionId !== row.decision_id ||
      decision.content.revision !== Number(row.revision) ||
      decision.content.decision !== row.status
    ) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'IMMUTABLE_CONFLICT',
        'External identity review head does not match its typed decision.'
      );
    }
    return decision;
  }

  async loadCanonicalTargetSnapshot(input: { entityKind: 'club' | 'player'; canonicalId: string }) {
    const canonicalId = input.canonicalId.trim();
    if (canonicalId.length === 0 || canonicalId.length > 240) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'TARGET_UNAVAILABLE',
        'Canonical identity target is invalid.'
      );
    }
    const table = input.entityKind === 'club' ? 'outcome_club' : 'outcome_player';
    const idColumn = input.entityKind === 'club' ? 'club_id' : 'player_id';
    const labelColumn = input.entityKind === 'club' ? 'current_name' : 'display_name';
    const result = await this.client.query<{
      canonical_id: string;
      recorded_label: string;
      status: string;
    }>(
      `SELECT ${idColumn} AS canonical_id,${labelColumn} AS recorded_label,status::text AS status
         FROM ${table}
        WHERE ${idColumn}=$1
        FOR SHARE`,
      [canonicalId]
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.canonical_id !== canonicalId ||
      row.status !== 'approved'
    ) {
      throw new AflTradeExternalIdentityReviewPersistenceError(
        'TARGET_UNAVAILABLE',
        'Canonical identity target is absent or not approved.'
      );
    }
    return createAflTradeExternalCanonicalIdentityTargetSnapshot({
      entityKind: input.entityKind,
      canonicalId,
      recordedLabel: row.recorded_label,
    });
  }
}
