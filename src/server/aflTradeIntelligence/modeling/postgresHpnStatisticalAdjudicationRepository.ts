import {
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnStatisticalDecisionSchema,
  type AflTradeHpnStatisticalDecision,
} from './hpnStatisticalAdjudication';
import { authenticateAflTradeHpnStatisticalSources } from './postgresHpnStatisticalSourceAuthentication';
import { z } from 'zod';

const reviewerExecutionSchema = z
  .object({
    environment: z.literal('non_production'),
    principalRef: z.string().min(1).max(240),
    authorityEvidenceId: z.string().regex(/^reviewer-authority-evidence:[a-f0-9]{64}$/),
  })
  .strict();

export interface AflTradeHpnAdjudicationEvidenceReader {
  read(reference: AflTradeArtifactRef): Promise<Uint8Array>;
}

interface StoredDecision {
  decision_id: string;
  scope_key: string;
  decision_canonical_json: string;
  decision_json: unknown;
  registered_at: Date | string;
}

async function verifyEvidence(
  decision: AflTradeHpnStatisticalDecision,
  reader: AflTradeHpnAdjudicationEvidenceReader
) {
  // References can share bytes but differ in metadata; verify each exact reference.
  for (const { artifact } of decision.evidence) {
    const bytes = await reader.read(artifact);
    if (!doesAflTradeArtifactRefMatchBytes(artifact, bytes)) {
      throw new Error('Statistical adjudication evidence bytes are missing or altered.');
    }
  }
}

function scopeKey(decision: AflTradeHpnStatisticalDecision) {
  return createAflTradeContentAddress('hpn-statistical-scope', decision.candidate.scope);
}

function authenticateStored(row: StoredDecision, expectedId: string) {
  const decision = aflTradeHpnStatisticalDecisionSchema.parse(row.decision_json);
  const registeredAt = new Date(row.registered_at).toISOString();
  if (
    row.decision_id !== expectedId ||
    decision.decisionId !== expectedId ||
    row.scope_key !== scopeKey(decision) ||
    row.decision_canonical_json !== canonicalizeAflTradeJson(decision) ||
    Date.parse(registeredAt) < Date.parse(decision.decidedAt)
  ) {
    throw new Error('Retained statistical adjudication record is inconsistent.');
  }
  return {
    decision,
    registeredAt,
    status: 'retained_unverified' as const,
    calculationEligible: false as const,
    publicationEligible: false as const,
  };
}

/**
 * Immutable custody only. Retaining or reading a decision never authenticates source rights,
 * source values, canonical identities, reviewer authority or supersession. There is deliberately
 * no current-head API. Evidence bytes remain in the artifact store and are checked on every read.
 */
export class PostgresAflTradeHpnStatisticalAdjudicationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async retainUnverified(input: unknown, evidenceReader: AflTradeHpnAdjudicationEvidenceReader) {
    const decision = aflTradeHpnStatisticalDecisionSchema.parse(input);
    await verifyEvidence(decision, evidenceReader);
    const canonical = canonicalizeAflTradeJson(decision);
    return this.client.transaction(async (transaction) => {
      const inserted = await transaction.query(
        `INSERT INTO outcome_hpn_statistical_decision_custody
          (decision_id,scope_key,decision_canonical_json,decision_json)
         VALUES ($1,$2,$3::text,($3::text)::jsonb)
         ON CONFLICT (decision_id) DO NOTHING`,
        [decision.decisionId, scopeKey(decision), canonical]
      );
      const stored = await transaction.query<StoredDecision>(
        `SELECT decision_id,scope_key,decision_canonical_json,decision_json,registered_at
           FROM outcome_hpn_statistical_decision_custody WHERE decision_id=$1`,
        [decision.decisionId]
      );
      if (stored.rows.length !== 1 || stored.rows[0].decision_canonical_json !== canonical) {
        throw new Error('Statistical adjudication custody did not retain the exact decision.');
      }
      return {
        ...authenticateStored(stored.rows[0], decision.decisionId),
        idempotentReplay: inserted.rowCount === 0,
      };
    });
  }

  async loadUnverified(decisionId: string, evidenceReader: AflTradeHpnAdjudicationEvidenceReader) {
    const stored = await this.client.query<StoredDecision>(
      `SELECT decision_id,scope_key,decision_canonical_json,decision_json,registered_at
         FROM outcome_hpn_statistical_decision_custody WHERE decision_id=$1`,
      [decisionId]
    );
    if (!stored.rows.length) return null;
    if (stored.rows.length !== 1) throw new Error('Ambiguous statistical adjudication custody.');
    const result = authenticateStored(stored.rows[0], decisionId);
    await verifyEvidence(result.decision, evidenceReader);
    return result;
  }

  async inspectRetainedSources(
    decisionId: string,
    evidenceReader: AflTradeHpnAdjudicationEvidenceReader
  ) {
    const retained = await this.loadUnverified(decisionId, evidenceReader);
    if (!retained) throw new Error('Statistical decision has not been retained.');
    const sources = await this.client.transaction((transaction) =>
      authenticateAflTradeHpnStatisticalSources(transaction, retained.decision.candidate)
    );
    return { ...sources, decisionId, decisionStatus: 'retained_unverified' as const };
  }

  /** Execution principal must come from the authenticated operator boundary, not decision JSON. */
  async inspectReviewerAuthority(
    decisionId: string,
    execution: z.input<typeof reviewerExecutionSchema>,
    evidenceReader: AflTradeHpnAdjudicationEvidenceReader
  ) {
    const context = reviewerExecutionSchema.parse(execution);
    const retained = await this.loadUnverified(decisionId, evidenceReader);
    if (!retained) throw new Error('Statistical decision has not been retained.');
    const result = await this.client.query<{ current: boolean }>(
      `SELECT outcome_hpn_statistical_reviewer_is_current($1,$2,$3) AS current`,
      [decisionId, context.authorityEvidenceId, context.principalRef]
    );
    if (result.rows.length !== 1 || result.rows[0].current !== true) {
      throw new Error('Statistical reviewer lacks current exact governed authority.');
    }
    return {
      decisionId,
      authorityEvidenceId: context.authorityEvidenceId,
      status: 'reviewer_authority_matches' as const,
      decisionStatus: 'retained_unverified' as const,
      calculationEligible: false as const,
      publicationEligible: false as const,
    };
  }
}
