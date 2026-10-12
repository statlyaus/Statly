import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type {
  AflTradeReconciliationScopeDecision,
  AflTradeReconciliationScopeDecisionReader,
} from './externalHistoricalReconciliationPreparation';

export const AFL_TRADE_RECONCILIATION_SCOPE_DECISION_SCHEMA_VERSION =
  'afl-trade-reconciliation-scope-decision/v1' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));

/**
 * The owner's reviewed scope decision for one historical completion (statlyaus/Statly#869): the
 * pick side of its reconciliation may be deferred. The stored approval record (the owner's answered
 * approval file, kept as an artifact) is cited, never retyped.
 */
export const aflTradeReconciliationScopeDecisionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_RECONCILIATION_SCOPE_DECISION_SCHEMA_VERSION),
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    scope: z.literal('pick_lineage_deferral'),
    approvalArtifactId: z.string().regex(/^artifact:[a-f0-9]{64}$/),
    rationale: z.string().trim().min(1).max(4_000),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
  })
  .strict();

export type AflTradeReconciliationScopeDecisionContent = z.infer<
  typeof aflTradeReconciliationScopeDecisionContentSchema
>;

export interface RecordedAflTradeReconciliationScopeDecision {
  readonly decisionId: string;
  readonly completionId: string;
  readonly scope: 'pick_lineage_deferral';
  readonly decision: 'approved';
  readonly idempotentReplay: boolean;
}

export class AflTradeReconciliationScopeDecisionPersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'COMPLETION_UNAVAILABLE' | 'ARTIFACT_UNAVAILABLE' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeReconciliationScopeDecisionPersistenceError';
  }
}

interface DecisionRow extends Record<string, unknown> {
  decision_id: string;
  subject_type: string;
  subject_id: string;
  decision: string;
  decided_at: Date | string;
  evidence_json: unknown;
  current: boolean;
}

function isoInstant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class PostgresAflTradeReconciliationScopeDecisionRepository implements AflTradeReconciliationScopeDecisionReader {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadDecision(decisionId: string): Promise<AflTradeReconciliationScopeDecision | null> {
    const result = await this.client.query<DecisionRow>(
      `SELECT decision.decision_id,decision.subject_type,decision.subject_id,decision.decision,
              decision.decided_at,decision.evidence_json,
              NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                           WHERE successor.supersedes_decision_id=decision.decision_id) AS current
         FROM outcome_review_decision decision
        WHERE decision.decision_id=$1`,
      [decisionId]
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) return null;
    return {
      decisionId: row.decision_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      decision: row.decision,
      decidedAt: isoInstant(row.decided_at),
      current: row.current === true,
    };
  }

  /**
   * Records one approved `reconciliation_scope` decision. The completion must be complete and the
   * cited approval artifact must be in custody. An exact replay returns the same content-addressed
   * decision; a different record for the same id is a conflict.
   */
  async recordApproval(
    unparsedContent: unknown
  ): Promise<RecordedAflTradeReconciliationScopeDecision> {
    let content: AflTradeReconciliationScopeDecisionContent;
    try {
      content = aflTradeReconciliationScopeDecisionContentSchema.parse(unparsedContent);
    } catch (error) {
      throw new AflTradeReconciliationScopeDecisionPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Scope decision content is invalid.'
      );
    }
    const decisionId = createAflTradeContentAddress('review-decision', content);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-reconciliation-scope:${content.completionId}`,
      ]);
      const completion = await transaction.query<{ status: string }>(
        `SELECT status FROM outcome_external_historical_capture_completion
          WHERE completion_id=$1 FOR SHARE`,
        [content.completionId]
      );
      if (completion.rows.length !== 1 || completion.rows[0]?.status !== 'complete') {
        throw new AflTradeReconciliationScopeDecisionPersistenceError(
          'COMPLETION_UNAVAILABLE',
          'The scope decision names a completion that is absent or not complete.'
        );
      }
      const artifact = await transaction.query(
        `SELECT 1 FROM outcome_artifact_custody WHERE artifact_id=$1`,
        [content.approvalArtifactId]
      );
      if (artifact.rows.length === 0) {
        throw new AflTradeReconciliationScopeDecisionPersistenceError(
          'ARTIFACT_UNAVAILABLE',
          'The cited approval record is not an artifact in custody; store it first.'
        );
      }
      const existing = await transaction.query<{ evidence_json: unknown }>(
        `SELECT evidence_json FROM outcome_review_decision WHERE decision_id=$1 FOR SHARE`,
        [decisionId]
      );
      if (existing.rows.length > 0) {
        if (
          canonicalizeAflTradeJson(existing.rows[0]?.evidence_json) !==
          canonicalizeAflTradeJson(content)
        ) {
          throw new AflTradeReconciliationScopeDecisionPersistenceError(
            'CONFLICT',
            'The decision id is already bound to different evidence.'
          );
        }
        return {
          decisionId,
          completionId: content.completionId,
          scope: content.scope,
          decision: 'approved' as const,
          idempotentReplay: true,
        };
      }
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'reconciliation_scope',$2,'approved',$3,$4::jsonb,$5,$6)`,
        [
          decisionId,
          content.completionId,
          content.rationale,
          canonicalizeAflTradeJson(content),
          content.decidedBy,
          content.decidedAt,
        ]
      );
      return {
        decisionId,
        completionId: content.completionId,
        scope: content.scope,
        decision: 'approved' as const,
        idempotentReplay: false,
      };
    });
  }
}
