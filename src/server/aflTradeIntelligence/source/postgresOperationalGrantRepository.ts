import { z } from 'zod';

import {
  AflTradeArtifactUnlocatedError,
  requireAflTradeEvidenceLocated,
} from '../artifacts/artifactStoreLocation';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';

export const AFL_TRADE_OPERATIONAL_GRANT_SCOPE = 'public-afl-draft-trade-outcomes';

/** The two intake roles this writer grants, each with its fixed capability and allowed providers. */
export const AFL_TRADE_OPERATIONAL_GRANT_ROLES = {
  afl_trade_external_identity_reviewer: {
    capabilityId: 'external_identity_resolution',
    providers: ['draftguru', 'footyinfo'],
  },
  afl_trade_canonical_promoter: {
    capabilityId: 'external_candidate_promotion',
    providers: ['multi_source'],
  },
} as const;

export type AflTradeOperationalGrantRole = keyof typeof AFL_TRADE_OPERATIONAL_GRANT_ROLES;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const seasonSchema = z.number().int().min(1897).max(2200);

/**
 * One owner-approved grant of an intake role to a principal: the role, provider, season range and
 * term, citing the owner's stored approval record. The term starts when the owner decided.
 */
export const aflTradeOperationalGrantSchema = z
  .object({
    role: z.enum(['afl_trade_external_identity_reviewer', 'afl_trade_canonical_promoter']),
    principalRef: z.string().trim().min(1).max(240),
    provider: z.enum(['draftguru', 'footyinfo', 'multi_source']),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    validThrough: instantSchema,
    approvalArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
  })
  .strict()
  .superRefine((grant, context) => {
    const allowed: readonly string[] = AFL_TRADE_OPERATIONAL_GRANT_ROLES[grant.role].providers;
    if (!allowed.includes(grant.provider)) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: `${grant.role} takes provider ${allowed.join(' or ')}.`,
      });
    }
    if (grant.validThroughSeason < grant.validFromSeason) {
      context.addIssue({ code: 'custom', message: 'The season range ends before it starts.' });
    }
    if (Date.parse(grant.validThrough) <= Date.parse(grant.decidedAt)) {
      context.addIssue({ code: 'custom', message: 'The term must end after the decision.' });
    }
  });

export type AflTradeOperationalGrant = z.infer<typeof aflTradeOperationalGrantSchema>;

/** The governed reviewer-authority evidence a grant stores and cites, content-addressed. */
export function createAflTradeOperationalGrantEvidence(grant: AflTradeOperationalGrant) {
  const payload = {
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'non_production',
    principalRef: grant.principalRef,
    role: grant.role,
    scopeKey: AFL_TRADE_OPERATIONAL_GRANT_SCOPE,
    provider: grant.provider,
    capabilityId: AFL_TRADE_OPERATIONAL_GRANT_ROLES[grant.role].capabilityId,
    competition: 'AFLM',
    validFromSeason: grant.validFromSeason,
    validThroughSeason: grant.validThroughSeason,
    validFrom: grant.decidedAt,
    validThrough: grant.validThrough,
    approvalArtifactId: grant.approvalArtifactId,
  } as const;
  return {
    payload,
    canonicalJson: canonicalizeAflTradeJson(payload),
    authorityEvidenceId: createAflTradeContentAddress('reviewer-authority-evidence', payload),
  };
}

export type AflTradeOperationalGrantCheck =
  | { status: 'ready' | 'already_recorded'; authorityEvidenceId: string }
  | {
      status: 'refused';
      reason: 'VALID_THROUGH_NOT_FUTURE' | 'DECIDED_IN_FUTURE' | 'ARTIFACT_UNLOCATED';
      message: string;
      authorityEvidenceId: string;
    };

export interface AflTradeOperationalGrantRow {
  authorityEvidenceId: string;
  principalRef: string;
  role: string;
  provider: string;
  capabilityId: string;
  validFromSeason: number;
  validThroughSeason: number;
  validFrom: string;
  validThrough: string | null;
}

interface GrantRow extends Record<string, unknown> {
  authority_evidence_id: string;
  principal_ref: string;
  role: string;
  provider: string;
  capability_id: string;
  valid_from_season: number;
  valid_through_season: number;
  valid_from: Date | string;
  valid_through: Date | string | null;
}

const NONPRODUCTION_GOVERNANCE_ROLE = 'afl_trade_nonproduction_governance_registry_writer';

function isoInstant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class PostgresAflTradeOperationalGrantRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  private async checkWithin(
    transaction: AflOutcomeSqlTransaction,
    grant: AflTradeOperationalGrant,
    citedArtifactIds: readonly string[]
  ): Promise<AflTradeOperationalGrantCheck> {
    const { authorityEvidenceId } = createAflTradeOperationalGrantEvidence(grant);
    const existing = await transaction.query(
      `SELECT 1 FROM outcome_operational_principal_authority WHERE authority_evidence_id=$1`,
      [authorityEvidenceId]
    );
    if (existing.rows.length > 0) return { status: 'already_recorded', authorityEvidenceId };
    const clock = await transaction.query<{ through_future: boolean; decided_past: boolean }>(
      `SELECT $1::timestamptz>statement_timestamp() AS through_future,
              $2::timestamptz<=statement_timestamp() AS decided_past`,
      [grant.validThrough, grant.decidedAt]
    );
    if (clock.rows[0]?.through_future !== true) {
      return {
        status: 'refused',
        reason: 'VALID_THROUGH_NOT_FUTURE',
        message: 'The grant term must end in the future.',
        authorityEvidenceId,
      };
    }
    if (clock.rows[0]?.decided_past !== true) {
      return {
        status: 'refused',
        reason: 'DECIDED_IN_FUTURE',
        message: 'The owner decision time is in the future.',
        authorityEvidenceId,
      };
    }
    try {
      await requireAflTradeEvidenceLocated(transaction, citedArtifactIds);
    } catch (error) {
      if (!(error instanceof AflTradeArtifactUnlocatedError)) throw error;
      return {
        status: 'refused',
        reason: 'ARTIFACT_UNLOCATED',
        message: error.message,
        authorityEvidenceId,
      };
    }
    return { status: 'ready', authorityEvidenceId };
  }

  /** What recording would do, without writing: ready, already recorded, or the refusal. */
  async check(unparsedGrant: unknown): Promise<AflTradeOperationalGrantCheck> {
    const grant = aflTradeOperationalGrantSchema.parse(unparsedGrant);
    return this.client.transaction((transaction) =>
      this.checkWithin(transaction, grant, [grant.approvalArtifactId])
    );
  }

  /**
   * Records the owner's approval of the stored grant evidence, the governed evidence reference and
   * the operational authority in one transaction, committed as the non-production governance writer.
   * `evidenceArtifactId` is the stored canonical evidence JSON (createAflTradeOperationalGrantEvidence).
   */
  async record(
    unparsedGrant: unknown,
    evidenceArtifactId: string
  ): Promise<AflTradeOperationalGrantCheck> {
    const grant = aflTradeOperationalGrantSchema.parse(unparsedGrant);
    const evidence = createAflTradeOperationalGrantEvidence(grant);
    const referenceSha256 = evidence.authorityEvidenceId.split(':')[1]!;
    const approvalDecisionId = createAflTradeContentAddress('governed-evidence-approval-decision', {
      referenceId: evidence.authorityEvidenceId,
    });
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        evidence.authorityEvidenceId,
      ]);
      const check = await this.checkWithin(transaction, grant, [
        grant.approvalArtifactId,
        evidenceArtifactId,
      ]);
      if (check.status !== 'ready') return check;
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'governed_evidence_reference',$2,'approved',$3,$4::jsonb,$5,$6)`,
        [
          approvalDecisionId,
          evidence.authorityEvidenceId,
          `Owner approval ${grant.approvalArtifactId} grants ${grant.role} to ${grant.principalRef}.`,
          canonicalizeAflTradeJson({
            referenceSha256,
            approvalArtifactId: grant.approvalArtifactId,
          }),
          grant.decidedBy,
          grant.decidedAt,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_governed_evidence_reference
          (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
           approval_decision_id,created_at,evidence_canonical_json,evidence_json)
         VALUES ($1,$2,'reviewer_authority_evidence',$3,'non_production','approved',$4,
                 statement_timestamp(),$5::text,($5::text)::jsonb)`,
        [
          evidence.authorityEvidenceId,
          referenceSha256,
          evidenceArtifactId,
          approvalDecisionId,
          evidence.canonicalJson,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_operational_principal_authority
          (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,competition,
           valid_from_season,valid_through_season,valid_from,valid_through)
         VALUES ($1,$2,$3,$4,$5,$6,'AFLM',$7,$8,$9,$10)`,
        [
          evidence.authorityEvidenceId,
          grant.principalRef,
          grant.role,
          AFL_TRADE_OPERATIONAL_GRANT_SCOPE,
          grant.provider,
          evidence.payload.capabilityId,
          grant.validFromSeason,
          grant.validThroughSeason,
          grant.decidedAt,
          grant.validThrough,
        ]
      );
      // The deferred registry-role check runs at commit, as this role (migration 0004).
      await transaction.query(`SET LOCAL ROLE ${NONPRODUCTION_GOVERNANCE_ROLE}`);
      return check;
    });
  }

  /** Every current intake grant: approved, not superseded, in non-production. */
  async listCurrent(): Promise<AflTradeOperationalGrantRow[]> {
    const result = await this.client.query<GrantRow>(
      `SELECT authority.authority_evidence_id,authority.principal_ref,authority.role,
              authority.provider,authority.capability_id,authority.valid_from_season,
              authority.valid_through_season,authority.valid_from,authority.valid_through
         FROM outcome_operational_principal_authority authority
         JOIN outcome_governed_evidence_reference evidence
           ON evidence.reference_id=authority.authority_evidence_id
         JOIN outcome_review_decision approval ON approval.decision_id=evidence.approval_decision_id
        WHERE authority.role = ANY($1::text[])
          AND authority.scope_key=$2
          AND evidence.environment='non_production'
          AND approval.decision='approved'
          AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                           WHERE successor.supersedes_decision_id=approval.decision_id)
        ORDER BY authority.role,authority.provider,authority.valid_from,authority.authority_evidence_id`,
      [Object.keys(AFL_TRADE_OPERATIONAL_GRANT_ROLES), AFL_TRADE_OPERATIONAL_GRANT_SCOPE]
    );
    return result.rows.map((row) => ({
      authorityEvidenceId: row.authority_evidence_id,
      principalRef: row.principal_ref,
      role: row.role,
      provider: row.provider,
      capabilityId: row.capability_id,
      validFromSeason: row.valid_from_season,
      validThroughSeason: row.valid_through_season,
      validFrom: isoInstant(row.valid_from),
      validThrough: row.valid_through === null ? null : isoInstant(row.valid_through),
    }));
  }
}
