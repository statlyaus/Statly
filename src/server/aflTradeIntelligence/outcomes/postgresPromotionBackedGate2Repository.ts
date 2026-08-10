import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { aflTradePromotionBackedCorpusSchema } from '../artifacts/promotionBackedCorpusContracts';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '../governance/gateDecisionTypes';
import {
  createAflTradePromotionBackedGate2Admission,
  createAflTradePromotionBackedGate2AffectedArtifacts,
  createAflTradePromotionBackedGate2DecisionKey,
  parseAflTradePromotionBackedGate2Admission,
  type AflTradePromotionBackedGate2Admission,
} from './promotionBackedGate2AdmissionContracts';
import {
  createAflTradePromotionBackedFactualLineage,
  parseAflTradePromotionBackedFactualLineage,
  type AflTradePromotionBackedFactualLineage,
} from './promotionBackedFactualLineageContracts';
import {
  aflTradePromotionBackedFactualCandidateSchema,
  aflTradePromotionBackedFactualReleaseSchema,
} from './promotionBackedFactualReleaseContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const stageRequestSchema = z
  .object({
    factualCandidateId: z.string().regex(/^factual-release-candidate:[a-f0-9]{64}$/),
    createdAt: instantSchema,
  })
  .strict();
const admitRequestSchema = z
  .object({
    lineageId: z.string().regex(/^corpus-factual-lineage:[a-f0-9]{64}$/),
    evaluatedAt: instantSchema,
  })
  .strict();

export class AflTradePromotionBackedGate2PersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'CANDIDATE_UNAVAILABLE'
      | 'LINEAGE_CONFLICT'
      | 'GATE2_UNAVAILABLE'
      | 'ADMISSION_CONFLICT',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradePromotionBackedGate2PersistenceError';
  }
}

export interface StagedAflTradePromotionBackedFactualLineage {
  readonly lineageId: string;
  readonly decisionKey: string;
  readonly affectedArtifacts: ReturnType<
    typeof createAflTradePromotionBackedGate2AffectedArtifacts
  >;
  readonly status: 'staged';
  readonly idempotentReplay: boolean;
}

export interface AdmittedAflTradePromotionBackedFactualLineage {
  readonly lineageId: string;
  readonly admissionId: string;
  readonly gate2DecisionId: string;
  readonly status: 'admitted';
  readonly idempotentReplay: boolean;
}

interface ParentRow extends Record<string, unknown> {
  status: string;
  finalized_at: Date | string | null;
  candidate_json: unknown;
  manifest_json: unknown;
  corpus_json: unknown;
}
interface LineageRow extends Record<string, unknown> {
  lineage_json: unknown;
}
interface AdmissionRow extends Record<string, unknown> {
  admission_json: unknown;
}
interface CurrentAuthorityRow extends Record<string, unknown> {
  lineage_json: unknown;
  admission_json: unknown;
}
interface RevisionRow extends Record<string, unknown> {
  revision: number;
}
interface ProposalRow extends Record<string, unknown> {
  proposal_json: unknown;
}
interface DecisionRow extends Record<string, unknown> {
  decision_json: unknown;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function stagedResult(
  lineage: AflTradePromotionBackedFactualLineage,
  idempotentReplay: boolean
): StagedAflTradePromotionBackedFactualLineage {
  return {
    lineageId: lineage.lineageId,
    decisionKey: createAflTradePromotionBackedGate2DecisionKey(lineage),
    affectedArtifacts: createAflTradePromotionBackedGate2AffectedArtifacts(lineage),
    status: 'staged',
    idempotentReplay,
  };
}

function admittedResult(
  admission: AflTradePromotionBackedGate2Admission,
  idempotentReplay: boolean
): AdmittedAflTradePromotionBackedFactualLineage {
  return {
    lineageId: admission.content.lineageId,
    admissionId: admission.admissionId,
    gate2DecisionId: admission.content.gate2DecisionId,
    status: 'admitted',
    idempotentReplay,
  };
}

async function loadLedgerLocked(transaction: AflOutcomeSqlTransaction) {
  const head = await transaction.query<RevisionRow>(
    'SELECT revision FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE'
  );
  const proposalRows = await transaction.query<ProposalRow>(
    'SELECT proposal_json FROM outcome_gate_proposal ORDER BY proposed_at,gate,decision_key,version,proposal_id'
  );
  const decisionRows = await transaction.query<DecisionRow>(
    'SELECT decision_json FROM outcome_gate_decision ORDER BY version,gate,decision_key,decision_id'
  );
  if (head.rows.length !== 1) {
    throw new AflTradePromotionBackedGate2PersistenceError(
      'GATE2_UNAVAILABLE',
      'The durable Gate ledger head is unavailable.'
    );
  }
  let ledger: AflTradeGateDecisionLedger;
  try {
    ledger = {
      proposals: proposalRows.rows.map(({ proposal_json }) =>
        aflTradeGateDecisionProposalSchema.parse(proposal_json)
      ),
      decisions: decisionRows.rows.map(({ decision_json }) =>
        aflTradeGateDecisionRecordSchema.parse(decision_json)
      ),
    };
  } catch (cause) {
    throw new AflTradePromotionBackedGate2PersistenceError(
      'GATE2_UNAVAILABLE',
      'The durable Gate ledger failed authentication.',
      { cause }
    );
  }
  if (head.rows[0]!.revision !== ledger.decisions.length) {
    throw new AflTradePromotionBackedGate2PersistenceError(
      'GATE2_UNAVAILABLE',
      'The durable Gate ledger head and decision count disagree.'
    );
  }
  return { revision: head.rows[0]!.revision, ledger };
}

export class PostgresAflTradePromotionBackedGate2Repository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadCurrentAuthority(releaseId: string): Promise<{
    lineage: AflTradePromotionBackedFactualLineage;
    admission: AflTradePromotionBackedGate2Admission;
  } | null> {
    if (!/^outcome-release:[a-f0-9]{64}$/.test(releaseId)) {
      throw new AflTradePromotionBackedGate2PersistenceError(
        'INVALID_INPUT',
        'Current Gate 2 authority requires an exact factual release identifier.'
      );
    }
    const result = await this.client.query<CurrentAuthorityRow>(
      `SELECT lineage.lineage_json,admission.admission_json
         FROM outcome_corpus_factual_lineage lineage
         JOIN outcome_corpus_factual_lineage_admission admission
           ON admission.lineage_id=lineage.lineage_id
         JOIN outcome_gate_decision decision
           ON decision.decision_id=admission.gate_decision_id
        WHERE lineage.release_id=$1
          AND decision.gate='gate_2_corpus_lineage'
          AND decision.state='approved'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_gate_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )
        ORDER BY decision.version DESC,admission.admission_id`,
      [releaseId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) {
      throw new AflTradePromotionBackedGate2PersistenceError(
        'GATE2_UNAVAILABLE',
        'The factual release has an ambiguous current Gate 2 authority.'
      );
    }
    try {
      const lineage = parseAflTradePromotionBackedFactualLineage(result.rows[0]!.lineage_json);
      const admission = parseAflTradePromotionBackedGate2Admission(result.rows[0]!.admission_json);
      if (
        lineage.content.factualReleaseId !== releaseId ||
        admission.content.lineageId !== lineage.lineageId ||
        admission.content.factualReleaseId !== releaseId
      ) {
        throw new TypeError('Gate 2 authority ancestry mismatch.');
      }
      return { lineage, admission };
    } catch (cause) {
      throw new AflTradePromotionBackedGate2PersistenceError(
        'GATE2_UNAVAILABLE',
        'The current Gate 2 authority failed authentication.',
        { cause }
      );
    }
  }

  async stage(unparsedRequest: unknown): Promise<StagedAflTradePromotionBackedFactualLineage> {
    const parsed = stageRequestSchema.safeParse(unparsedRequest);
    if (!parsed.success) {
      throw new AflTradePromotionBackedGate2PersistenceError(
        'INVALID_INPUT',
        'Factual lineage staging request is invalid.',
        { cause: parsed.error }
      );
    }
    const request = parsed.data;
    return this.client.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `promotion-backed-gate2-stage:${request.factualCandidateId}`,
      ]);
      const parent = await transaction.query<ParentRow>(
        `SELECT candidate.status,candidate.finalized_at,candidate.candidate_json,
                release.manifest_json,corpus.corpus_json
           FROM outcome_factual_release_candidate candidate
           JOIN outcome_release_manifest release ON release.release_id=candidate.target_release_id
           JOIN outcome_promotion_backed_corpus corpus
             ON corpus.corpus_id=candidate.promotion_backed_corpus_id
          WHERE candidate.candidate_id=$1
          FOR SHARE OF candidate,release,corpus`,
        [request.factualCandidateId]
      );
      if (
        parent.rows.length !== 1 ||
        parent.rows[0]?.status !== 'approved' ||
        parent.rows[0].finalized_at === null
      ) {
        throw new AflTradePromotionBackedGate2PersistenceError(
          'CANDIDATE_UNAVAILABLE',
          'Gate 2 staging requires one finalized promotion-backed factual candidate.'
        );
      }
      let lineage: AflTradePromotionBackedFactualLineage;
      try {
        lineage = createAflTradePromotionBackedFactualLineage({
          corpus: aflTradePromotionBackedCorpusSchema.parse(parent.rows[0].corpus_json),
          release: aflTradePromotionBackedFactualReleaseSchema.parse(parent.rows[0].manifest_json),
          candidate: aflTradePromotionBackedFactualCandidateSchema.parse(
            parent.rows[0].candidate_json
          ),
          createdAt: request.createdAt,
        });
      } catch (cause) {
        throw new AflTradePromotionBackedGate2PersistenceError(
          'CANDIDATE_UNAVAILABLE',
          'The finalized factual candidate ancestry failed authentication.',
          { cause }
        );
      }
      const replay = await transaction.query<LineageRow>(
        'SELECT lineage_json FROM outcome_corpus_factual_lineage WHERE lineage_id=$1 FOR SHARE',
        [lineage.lineageId]
      );
      if (replay.rows.length > 0) {
        if (replay.rows.length !== 1 || !exactJson(replay.rows[0]?.lineage_json, lineage)) {
          throw new AflTradePromotionBackedGate2PersistenceError(
            'LINEAGE_CONFLICT',
            'The lineage identity already binds different persisted content.'
          );
        }
        return stagedResult(lineage, true);
      }
      await transaction.query(
        `INSERT INTO outcome_corpus_factual_lineage
          (lineage_id,corpus_id,release_id,candidate_id,environment,scope_key,competition,
           valid_from_season,valid_through_season,source_member_set_sha256,
           canonical_member_set_sha256,created_at,lineage_canonical_json,lineage_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
        [
          lineage.lineageId,
          lineage.content.corpusId,
          lineage.content.factualReleaseId,
          lineage.content.factualCandidateId,
          lineage.content.environment,
          lineage.content.scopeKey,
          lineage.content.competition,
          lineage.content.validFromSeason,
          lineage.content.validThroughSeason,
          lineage.content.sourceMemberSetSha256,
          lineage.content.canonicalMemberSetSha256,
          lineage.content.createdAt,
          canonicalizeAflTradeJson(lineage.content),
          lineage,
        ]
      );
      return stagedResult(lineage, false);
    });
  }

  async admit(unparsedRequest: unknown): Promise<AdmittedAflTradePromotionBackedFactualLineage> {
    const parsed = admitRequestSchema.safeParse(unparsedRequest);
    if (!parsed.success) {
      throw new AflTradePromotionBackedGate2PersistenceError(
        'INVALID_INPUT',
        'Gate 2 admission request is invalid.',
        { cause: parsed.error }
      );
    }
    const request = parsed.data;
    return this.client.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `promotion-backed-gate2-admit:${request.lineageId}`,
      ]);
      const storedLineage = await transaction.query<LineageRow>(
        'SELECT lineage_json FROM outcome_corpus_factual_lineage WHERE lineage_id=$1 FOR SHARE',
        [request.lineageId]
      );
      if (storedLineage.rows.length !== 1) {
        throw new AflTradePromotionBackedGate2PersistenceError(
          'CANDIDATE_UNAVAILABLE',
          'The exact staged factual lineage is unavailable.'
        );
      }
      let lineage: AflTradePromotionBackedFactualLineage;
      try {
        lineage = parseAflTradePromotionBackedFactualLineage(storedLineage.rows[0].lineage_json);
      } catch (cause) {
        throw new AflTradePromotionBackedGate2PersistenceError(
          'LINEAGE_CONFLICT',
          'The staged factual lineage failed authentication.',
          { cause }
        );
      }
      const authority = await loadLedgerLocked(transaction);
      let currentAdmission: AflTradePromotionBackedGate2Admission;
      try {
        currentAdmission = createAflTradePromotionBackedGate2Admission({
          lineage,
          ledger: authority.ledger,
          ledgerRevision: authority.revision,
          evaluatedAt: request.evaluatedAt,
        });
      } catch (cause) {
        throw new AflTradePromotionBackedGate2PersistenceError(
          'GATE2_UNAVAILABLE',
          'The exact factual lineage has no current eligible Gate 2 decision.',
          { cause }
        );
      }
      const replay = await transaction.query<AdmissionRow>(
        `SELECT admission_json FROM outcome_corpus_factual_lineage_admission
          WHERE lineage_id=$1 AND gate_decision_id=$2 FOR SHARE`,
        [lineage.lineageId, currentAdmission.content.gate2DecisionId]
      );
      if (replay.rows.length > 0) {
        try {
          const stored = parseAflTradePromotionBackedGate2Admission(replay.rows[0]?.admission_json);
          if (
            replay.rows.length !== 1 ||
            stored.content.gate2DecisionId !== currentAdmission.content.gate2DecisionId ||
            stored.content.lineageId !== currentAdmission.content.lineageId
          ) {
            throw new TypeError('Admission authority changed.');
          }
          return admittedResult(stored, true);
        } catch (cause) {
          throw new AflTradePromotionBackedGate2PersistenceError(
            'ADMISSION_CONFLICT',
            'The lineage already binds a different admission receipt.',
            { cause }
          );
        }
      }
      await transaction.query(
        `INSERT INTO outcome_corpus_factual_lineage_admission
          (admission_id,lineage_id,gate_proposal_id,gate_decision_id,gate_ledger_revision,
           admitted_at,revalidate_at,admission_canonical_json,admission_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          currentAdmission.admissionId,
          lineage.lineageId,
          currentAdmission.content.gate2ProposalId,
          currentAdmission.content.gate2DecisionId,
          currentAdmission.content.gateLedgerRevision,
          currentAdmission.content.admittedAt,
          currentAdmission.content.gate2RevalidateAt,
          canonicalizeAflTradeJson(currentAdmission.content),
          currentAdmission,
        ]
      );
      return admittedResult(currentAdmission, false);
    });
  }
}
