import { z } from 'zod';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeExternalCanonicalPromotionApprovalEvidenceSchema,
  authenticateAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionRequest,
  type AflTradeExternalCanonicalPromotionProposal,
} from './externalCanonicalPromotionContracts';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';

export interface PromoteAflTradeExternalCandidateInput {
  readonly candidateId: string;
  readonly approvalDecisionId: string;
}

export interface PromotedAflTradeExternalCandidate {
  readonly promotionId: string;
  readonly candidateId: string;
  readonly status: 'finalized';
  readonly idempotentReplay: boolean;
  readonly transactionCount: number;
  readonly transferCount: number;
  readonly draftSelectionCount: number;
  readonly draftPlayerAssetCount: number;
  readonly pickCustodyCount: number;
  readonly pickRealizationCount: number;
}

export class AflTradeExternalCanonicalPromotionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'CANDIDATE_UNAVAILABLE'
      | 'APPROVAL_UNAVAILABLE'
      | 'REFERENCE_UNAVAILABLE'
      | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalCanonicalPromotionError';
  }
}

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type TransactionRecord = CandidateContent['transactions'][number];

interface ApprovalRow extends Record<string, unknown> {
  decision_id: string;
  subject_type: string;
  subject_id: string;
  decision: string;
  decided_at: Date | string;
  evidence_json: unknown;
  current: boolean;
}

interface EvidenceSource extends Record<string, unknown> {
  evidence_id: string;
  batch_id: string;
  capture_id: string;
  anchor_season_year: number;
  season_years: number[];
}

interface IdentityDecision extends Record<string, unknown> {
  resolution_id: string;
  review_decision_id: string;
  entity_kind: 'club' | 'player';
  canonical_id: string;
  current: boolean;
}

interface SourceRow {
  readonly importRowId: string;
  readonly importRunId: string;
  readonly captureId: string;
  readonly seasonYear: number;
  readonly sourceOrdinal: number;
  readonly recordKind: string;
  readonly sourceRecordId: string;
  readonly recordSha256: string;
  readonly evidenceIds: readonly string[];
  readonly record: unknown;
}

interface PromotionRecord {
  readonly recordKind:
    | 'transaction'
    | 'transfer'
    | 'draft_event'
    | 'draft_selection'
    | 'draft_player_asset'
    | 'pick_custody'
    | 'pick_realization';
  readonly sourceRecordId: string;
  readonly canonicalRecordId: string;
  readonly sourceRow: SourceRow;
}

interface DraftKind {
  readonly eventKind:
    | 'national_draft'
    | 'preseason_draft'
    | 'rookie_draft'
    | 'midseason_draft'
    | 'supplemental_selection';
  readonly mechanism:
    'national_draft' | 'preseason_draft' | 'rookie_draft' | 'midseason_draft' | 'mini_draft';
}

interface PickDefinition {
  pickId: string;
  draftYear: number;
  draftType: string;
  nominalRound: number | null;
  nominalPick: number | null;
  originalClubId: string | null;
}

const promotionInputSchema = z
  .object({
    candidateId: z.string().regex(/^external-reconciliation:[a-f0-9]{64}$/),
    approvalDecisionId: z.string().regex(/^review-decision:[a-f0-9]{64}$/),
  })
  .strict();

function isoInstant(value: Date | string): string {
  const instant = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    throw new TypeError('Expected an exact UTC millisecond instant.');
  }
  return instant;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function mapDraftKind(value: string): DraftKind {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'national' || normalized === 'national_draft') {
    return { eventKind: 'national_draft', mechanism: 'national_draft' };
  }
  if (
    normalized === 'preseason' ||
    normalized === 'pre_season' ||
    normalized === 'preseason_draft'
  ) {
    return { eventKind: 'preseason_draft', mechanism: 'preseason_draft' };
  }
  if (normalized === 'rookie' || normalized === 'rookie_draft') {
    return { eventKind: 'rookie_draft', mechanism: 'rookie_draft' };
  }
  if (
    normalized === 'midseason' ||
    normalized === 'mid_season' ||
    normalized === 'midseason_draft'
  ) {
    return { eventKind: 'midseason_draft', mechanism: 'midseason_draft' };
  }
  if (normalized === 'mini_draft' || normalized === 'supplemental_selection') {
    return { eventKind: 'supplemental_selection', mechanism: 'mini_draft' };
  }
  throw new AflTradeExternalCanonicalPromotionError(
    'REFERENCE_UNAVAILABLE',
    `Draft type ${value} has no reviewed canonical mechanism mapping.`
  );
}

function transactionKind(record: TransactionRecord): {
  eventKind: 'trade' | 'other_acquisition';
  mechanism: 'trade' | 'free_agency';
} {
  if (record.transactionType === 'trade') return { eventKind: 'trade', mechanism: 'trade' };
  if (record.transactionType === 'free_agency') {
    return { eventKind: 'other_acquisition', mechanism: 'free_agency' };
  }
  throw new AflTradeExternalCanonicalPromotionError(
    'REFERENCE_UNAVAILABLE',
    'Other transaction types require a separately reviewed acquisition mechanism.'
  );
}

function mergePickDefinition(definitions: Map<string, PickDefinition>, next: PickDefinition): void {
  const existing = definitions.get(next.pickId);
  if (!existing) {
    definitions.set(next.pickId, { ...next });
    return;
  }
  if (existing.draftYear !== next.draftYear || existing.draftType !== next.draftType) {
    throw new AflTradeExternalCanonicalPromotionError(
      'IMMUTABLE_CONFLICT',
      `Pick ${next.pickId} has conflicting draft scope.`
    );
  }
  const merge = <Key extends 'nominalRound' | 'nominalPick' | 'originalClubId'>(key: Key) => {
    const current = existing[key];
    const incoming = next[key];
    if (current !== null && incoming !== null && current !== incoming) {
      throw new AflTradeExternalCanonicalPromotionError(
        'IMMUTABLE_CONFLICT',
        `Pick ${next.pickId} has conflicting ${key}.`
      );
    }
    if (current === null && incoming !== null) existing[key] = incoming as PickDefinition[Key];
  };
  merge('nominalRound');
  merge('nominalPick');
  merge('originalClubId');
}

function pickDefinitions(content: CandidateContent): Map<string, PickDefinition> {
  const definitions = new Map<string, PickDefinition>();
  content.transfers.forEach((transfer) => {
    if (transfer.asset.kind !== 'pick_entitlement') return;
    mergePickDefinition(definitions, {
      pickId: transfer.asset.pickId,
      draftYear: transfer.asset.draftYear,
      draftType: transfer.asset.draftType,
      nominalRound: transfer.asset.nominalRound,
      nominalPick: transfer.asset.nominalPick,
      originalClubId: transfer.asset.originalClubId,
    });
  });
  content.draftSelections.forEach((selection) =>
    mergePickDefinition(definitions, {
      pickId: selection.pickId,
      draftYear: selection.draftYear,
      draftType: selection.draftType,
      nominalRound: null,
      nominalPick: null,
      originalClubId: null,
    })
  );
  content.pickCustody.forEach((custody) =>
    mergePickDefinition(definitions, {
      pickId: custody.pickId,
      draftYear: custody.draftYear,
      draftType: custody.draftType,
      nominalRound: null,
      nominalPick: null,
      originalClubId: custody.originalClubId,
    })
  );
  return definitions;
}

async function loadCandidate(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string
): Promise<AflTradeExternalReconciliationCandidateRecord> {
  const result = await transaction.query<{
    status: string;
    finalized_at: Date | string | null;
    issue_count: number | string;
    candidate_json: unknown;
  }>(
    `SELECT status,finalized_at,issue_count,candidate_json
       FROM outcome_external_reconciliation_candidate
      WHERE candidate_id=$1
      FOR SHARE`,
    [candidateId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.status !== 'finalized' ||
    row.finalized_at === null ||
    Number(row.issue_count) !== 0
  ) {
    throw new AflTradeExternalCanonicalPromotionError(
      'CANDIDATE_UNAVAILABLE',
      'Candidate is absent, open, or contains blocking issues.'
    );
  }
  try {
    const candidate = parseAflTradeExternalReconciliationCandidate(row.candidate_json);
    if (candidate.candidateId !== candidateId) throw new TypeError('Candidate identity mismatch.');
    return candidate;
  } catch (error) {
    throw new AflTradeExternalCanonicalPromotionError(
      'CANDIDATE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Candidate content is invalid.'
    );
  }
}

async function loadApproval(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string,
  approvalDecisionId: string
): Promise<{ proposal: AflTradeExternalCanonicalPromotionProposal; promotedAt: string }> {
  const result = await transaction.query<ApprovalRow>(
    `SELECT decision.decision_id,decision.subject_type,decision.subject_id,decision.decision,
            decision.decided_at,decision.evidence_json,
            NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=decision.decision_id) AS current
       FROM outcome_review_decision decision
      WHERE decision.decision_id=$1
      FOR SHARE`,
    [approvalDecisionId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.subject_type !== 'external_reconciliation_candidate' ||
    row.subject_id !== candidateId ||
    row.decision !== 'approved' ||
    row.current !== true
  ) {
    throw new AflTradeExternalCanonicalPromotionError(
      'APPROVAL_UNAVAILABLE',
      'Promotion approval is absent, withdrawn, superseded, or for another candidate.'
    );
  }
  try {
    const evidence = aflTradeExternalCanonicalPromotionApprovalEvidenceSchema.parse(
      row.evidence_json
    );
    return { proposal: evidence.proposal, promotedAt: isoInstant(row.decided_at) };
  } catch (error) {
    throw new AflTradeExternalCanonicalPromotionError(
      'APPROVAL_UNAVAILABLE',
      error instanceof Error ? error.message : 'Promotion approval evidence is invalid.'
    );
  }
}

async function loadEvidenceSources(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string
): Promise<{ byEvidenceId: Map<string, EvidenceSource>; captures: EvidenceSource[] }> {
  const result = await transaction.query<EvidenceSource>(
    `SELECT evidence.evidence_id,batch.batch_id,batch.capture_id,capture.anchor_season_year,
            ARRAY(SELECT scope.season_year
                    FROM outcome_source_capture_season scope
                   WHERE scope.capture_id=capture.capture_id
                     AND scope.competition=candidate.competition
                   ORDER BY scope.season_year) AS season_years
       FROM outcome_external_reconciliation_source_batch source
       JOIN outcome_external_reconciliation_candidate candidate
         ON candidate.candidate_id=source.candidate_id
       JOIN outcome_external_evidence_batch batch ON batch.batch_id=source.batch_id
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
       JOIN outcome_external_evidence_row evidence ON evidence.batch_id=batch.batch_id
      WHERE source.candidate_id=$1
      ORDER BY batch.capture_id,evidence.evidence_id
      FOR SHARE OF candidate,batch,capture,evidence`,
    [candidateId]
  );
  if (result.rows.length === 0) {
    throw new AflTradeExternalCanonicalPromotionError(
      'CANDIDATE_UNAVAILABLE',
      'Candidate has no retained source evidence.'
    );
  }
  const byEvidenceId = new Map(result.rows.map((row) => [row.evidence_id, row]));
  const captures = [
    ...new Map(result.rows.map((row) => [row.capture_id, row] as const)).values(),
  ].sort((left, right) => left.capture_id.localeCompare(right.capture_id));
  return { byEvidenceId, captures };
}

async function currentIdentityDecisions(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string,
  content: CandidateContent
): Promise<Map<string, string>> {
  const requiredPlayers = new Set([
    ...content.transfers.flatMap(({ asset }) =>
      asset.kind === 'player' && asset.playerId ? [asset.playerId] : []
    ),
    ...content.draftSelections.flatMap(({ playerId }) => (playerId ? [playerId] : [])),
  ]);
  const result = await transaction.query<IdentityDecision>(
    `SELECT identity.resolution_id,identity.review_decision_id,identity.entity_kind,
            identity.canonical_id,
            NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=identity.review_decision_id) AS current
       FROM outcome_external_reconciliation_identity_resolution identity
       JOIN outcome_review_decision decision ON decision.decision_id=identity.review_decision_id
      WHERE identity.candidate_id=$1 AND decision.decision='approved'
      ORDER BY identity.canonical_id,identity.resolution_id
      FOR SHARE OF identity,decision`,
    [candidateId]
  );
  const byPlayer = new Map<string, string>();
  result.rows.forEach((row) => {
    if (row.entity_kind === 'player' && row.current === true && !byPlayer.has(row.canonical_id)) {
      byPlayer.set(row.canonical_id, row.review_decision_id);
    }
  });
  if ([...requiredPlayers].some((playerId) => !byPlayer.has(playerId))) {
    throw new AflTradeExternalCanonicalPromotionError(
      'REFERENCE_UNAVAILABLE',
      'Every promoted player requires an exact current external identity decision.'
    );
  }
  return byPlayer;
}

async function requireReferenceRows(
  transaction: AflOutcomeSqlTransaction,
  candidateId: string,
  content: CandidateContent
): Promise<Map<string, string>> {
  const seasonYears = sortedUnique([
    ...content.transactions.map(({ seasonYear }) => String(seasonYear)),
    ...content.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' ? [String(asset.draftYear)] : []
    ),
    ...content.draftSelections.map(({ draftYear }) => String(draftYear)),
    ...content.pickCustody.map(({ draftYear }) => String(draftYear)),
  ]).map(Number);
  const seasons = await transaction.query<{ season_year: number }>(
    `SELECT season_year FROM outcome_competition_season
      WHERE competition=$1 AND season_year=ANY($2::integer[])`,
    [content.competition, seasonYears]
  );
  if (
    new Set(seasons.rows.map(({ season_year }) => Number(season_year))).size !== seasonYears.length
  ) {
    throw new AflTradeExternalCanonicalPromotionError(
      'REFERENCE_UNAVAILABLE',
      'Every promoted record requires an existing canonical competition season.'
    );
  }
  const clubs = sortedUnique([
    ...content.transactions.flatMap(({ parties }) => parties),
    ...content.transfers.flatMap(({ fromClubId, toClubId, asset }) => [
      ...(fromClubId ? [fromClubId] : []),
      ...(toClubId ? [toClubId] : []),
      ...(asset.kind === 'pick_entitlement' && asset.originalClubId ? [asset.originalClubId] : []),
    ]),
    ...content.draftSelections.flatMap(({ clubId }) => (clubId ? [clubId] : [])),
    ...content.pickCustody.flatMap(({ originalClubId, currentClubId }) => [
      ...(originalClubId ? [originalClubId] : []),
      ...(currentClubId ? [currentClubId] : []),
    ]),
  ]);
  if (clubs.length > 0) {
    const rows = await transaction.query<{ club_id: string }>(
      `SELECT club_id FROM outcome_club
        WHERE club_id=ANY($1::text[]) AND status='approved'::"OutcomeRecordStatus"`,
      [clubs]
    );
    if (new Set(rows.rows.map(({ club_id }) => club_id)).size !== clubs.length) {
      throw new AflTradeExternalCanonicalPromotionError(
        'REFERENCE_UNAVAILABLE',
        'Every promoted club must already be an approved canonical AFL club.'
      );
    }
  }
  const players = sortedUnique([
    ...content.transfers.flatMap(({ asset }) =>
      asset.kind === 'player' && asset.playerId ? [asset.playerId] : []
    ),
    ...content.draftSelections.flatMap(({ playerId }) => (playerId ? [playerId] : [])),
  ]);
  if (players.length > 0) {
    const rows = await transaction.query<{ player_id: string }>(
      `SELECT player_id FROM outcome_player
        WHERE player_id=ANY($1::text[]) AND status='approved'::"OutcomeRecordStatus"`,
      [players]
    );
    if (new Set(rows.rows.map(({ player_id }) => player_id)).size !== players.length) {
      throw new AflTradeExternalCanonicalPromotionError(
        'REFERENCE_UNAVAILABLE',
        'Every promoted player must already be an approved canonical AFL player.'
      );
    }
  }
  return currentIdentityDecisions(transaction, candidateId, content);
}

async function lockKeys(
  transaction: AflOutcomeSqlTransaction,
  values: readonly string[]
): Promise<void> {
  for (const value of sortedUnique(values)) {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [value]);
  }
}

async function currentEventVersion(
  transaction: AflOutcomeSqlTransaction,
  eventId: string
): Promise<{ eventVersionId: string; version: number; recordedAt: string } | null> {
  const result = await transaction.query<{
    event_version_id: string;
    version: number;
    recorded_at: Date | string;
  }>(
    `SELECT current.event_version_id,current.version,current.recorded_at
       FROM outcome_event_version current
       LEFT JOIN outcome_event_version superseded_by
         ON superseded_by.supersedes_version_id=current.event_version_id
      WHERE current.event_id=$1 AND superseded_by.event_version_id IS NULL
      FOR SHARE OF current`,
    [eventId]
  );
  if (result.rows.length > 1) {
    throw new AflTradeExternalCanonicalPromotionError(
      'IMMUTABLE_CONFLICT',
      `Event ${eventId} has more than one current version.`
    );
  }
  const row = result.rows[0];
  return row
    ? {
        eventVersionId: row.event_version_id,
        version: Number(row.version),
        recordedAt: isoInstant(row.recorded_at),
      }
    : null;
}

async function ensureEventRoot(
  transaction: AflOutcomeSqlTransaction,
  input: { eventId: string; competition: string; seasonYear: number; stableKey: string }
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_event (event_id,competition,season_year,stable_key)
     VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`,
    [input.eventId, input.competition, input.seasonYear, input.stableKey]
  );
  const exact = await transaction.query(
    `SELECT event_id FROM outcome_event
      WHERE event_id=$1 AND competition=$2 AND season_year=$3 AND stable_key=$4
      FOR SHARE`,
    [input.eventId, input.competition, input.seasonYear, input.stableKey]
  );
  if (exact.rows.length !== 1) {
    throw new AflTradeExternalCanonicalPromotionError(
      'IMMUTABLE_CONFLICT',
      `Event root ${input.eventId} already has different scope.`
    );
  }
}

export class PostgresAflTradeExternalCanonicalPromotionRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async promote(
    unparsedInput: PromoteAflTradeExternalCandidateInput
  ): Promise<PromotedAflTradeExternalCandidate> {
    let input: z.infer<typeof promotionInputSchema>;
    try {
      input = promotionInputSchema.parse(unparsedInput);
    } catch (error) {
      throw new AflTradeExternalCanonicalPromotionError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Promotion input is invalid.'
      );
    }

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-canonical-promotion:${input.candidateId}`,
      ]);
      const candidate = await loadCandidate(transaction, input.candidateId);
      const approval = await loadApproval(transaction, input.candidateId, input.approvalDecisionId);
      const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
        candidate,
        proposal: approval.proposal,
      });
      const request = createAflTradeExternalCanonicalPromotionRequest({
        candidateId: candidate.candidateId,
        proposalId: approval.proposal.proposalId,
        approvalDecisionId: input.approvalDecisionId,
      });
      const replay = await transaction.query<{
        promotion_id: string;
        candidate_id: string;
        proposal_id: string;
        approval_decision_id: string;
        status: string;
        receipt_json: unknown;
        transaction_count: number | string;
        transfer_count: number | string;
        draft_selection_count: number | string;
        draft_player_asset_count: number | string;
        pick_custody_count: number | string;
        pick_realization_count: number | string;
      }>(
        `SELECT promotion_id,candidate_id,proposal_id,approval_decision_id,status,receipt_json,
                transaction_count,transfer_count,draft_selection_count,draft_player_asset_count,
                pick_custody_count,pick_realization_count
           FROM outcome_external_canonical_promotion
          WHERE candidate_id=$1
          FOR SHARE`,
        [candidate.candidateId]
      );
      if (replay.rows.length > 0) {
        const row = replay.rows[0];
        if (
          replay.rows.length !== 1 ||
          row?.promotion_id !== request.promotionId ||
          row.proposal_id !== approval.proposal.proposalId ||
          row.approval_decision_id !== input.approvalDecisionId ||
          row.status !== 'finalized' ||
          !exactJson(row.receipt_json, request)
        ) {
          throw new AflTradeExternalCanonicalPromotionError(
            'IMMUTABLE_CONFLICT',
            'Candidate is already bound to a different or incomplete promotion.'
          );
        }
        return {
          promotionId: request.promotionId,
          candidateId: candidate.candidateId,
          status: 'finalized',
          idempotentReplay: true,
          transactionCount: Number(row.transaction_count),
          transferCount: Number(row.transfer_count),
          draftSelectionCount: Number(row.draft_selection_count),
          draftPlayerAssetCount: Number(row.draft_player_asset_count),
          pickCustodyCount: Number(row.pick_custody_count),
          pickRealizationCount: Number(row.pick_realization_count),
        };
      }

      const content = candidate.content;
      const reviewedTransactionDateById = new Map(
        approval.proposal.content.transactionDateCoverage.map(({ transactionId, occurredOn }) => [
          transactionId,
          occurredOn,
        ])
      );
      const promotedTransactions = content.transactions.map((record) => {
        const occurredOn = reviewedTransactionDateById.get(record.transactionId);
        if (!occurredOn) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Transaction ${record.transactionId} has no reviewed occurrence date.`
          );
        }
        return { ...record, occurredOn };
      });
      const identityDecisionByPlayer = await requireReferenceRows(
        transaction,
        candidate.candidateId,
        content
      );
      const evidence = await loadEvidenceSources(transaction, candidate.candidateId);
      const definitions = pickDefinitions(content);
      const draftEventIds = approval.proposal.content.draftEventCoverage.map((coverage) =>
        createAflTradeContentAddress('draft-event', {
          competition: content.competition,
          draftYear: coverage.draftYear,
          draftType: coverage.draftType,
        })
      );
      await lockKeys(transaction, [
        ...content.transactions.map(({ transactionId }) => `outcome-event:${transactionId}`),
        ...draftEventIds.map((eventId) => `outcome-event:${eventId}`),
        ...[...definitions.keys()].map((pickId) => `outcome-pick:${pickId}`),
      ]);

      const proposalCanonical = canonicalizeAflTradeJson(approval.proposal.content);
      const proposalJson = canonicalizeAflTradeJson(approval.proposal);
      const receiptCanonical = canonicalizeAflTradeJson(request.content);
      const receiptJson = canonicalizeAflTradeJson(request);
      const draftPlayerAssetCount = content.draftSelections.length;
      const promotionRecordCount =
        authenticated.transactionCount +
        authenticated.transferCount +
        authenticated.draftSelectionCount +
        draftPlayerAssetCount +
        authenticated.pickCustodyCount +
        authenticated.pickRealizationCount +
        approval.proposal.content.draftEventCoverage.length;

      await transaction.query(
        `INSERT INTO outcome_external_canonical_promotion
          (promotion_id,candidate_id,proposal_id,approval_decision_id,import_run_count,
           environment,competition,anchor_season_year,transaction_count,transfer_count,
           draft_selection_count,draft_player_asset_count,pick_custody_count,
           pick_realization_count,promotion_record_count,promoted_at,status,finalized_at,
           proposal_sha256,proposal_canonical_json,proposal_json,receipt_sha256,
           receipt_canonical_json,receipt_json)
         VALUES ($1,$2,$3,$4,$5,$6::"OutcomeEnvironment",$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 $16,'open',NULL,$17,$18,$19::jsonb,$20,$21,$22::jsonb)`,
        [
          request.promotionId,
          candidate.candidateId,
          approval.proposal.proposalId,
          input.approvalDecisionId,
          evidence.captures.length,
          content.environment,
          content.competition,
          content.anchorSeasonYear,
          content.transactions.length,
          content.transfers.length,
          content.draftSelections.length,
          draftPlayerAssetCount,
          content.pickCustody.length,
          content.pickLineage.length,
          promotionRecordCount,
          approval.promotedAt,
          approval.proposal.proposalId.split(':')[1],
          proposalCanonical,
          proposalJson,
          request.promotionId.split(':')[1],
          receiptCanonical,
          receiptJson,
        ]
      );

      const importRunByCapture = new Map<string, string>();
      for (const [index, capture] of evidence.captures.entries()) {
        await transaction.query(
          `INSERT INTO outcome_source_capture_season (capture_id,competition,season_year)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [capture.capture_id, content.competition, Number(capture.anchor_season_year)]
        );
        const importRunId = createAflTradeContentAddress('external-canonical-import', {
          promotionId: request.promotionId,
          captureId: capture.capture_id,
        });
        importRunByCapture.set(capture.capture_id, importRunId);
        await transaction.query(
          `INSERT INTO outcome_import_run
            (import_run_id,capture_id,import_kind,parser_version,started_at,completed_at,status,manifest_json)
           VALUES ($1,$2,'external_canonical_promotion','external-promotion/v1',$3,$3,
                   'approved'::"OutcomeRecordStatus",$4::jsonb)`,
          [importRunId, capture.capture_id, approval.promotedAt, receiptCanonical]
        );
        await transaction.query(
          `INSERT INTO outcome_external_canonical_promotion_import_run
            (promotion_id,ordinal,import_run_id,capture_id) VALUES ($1,$2,$3,$4)`,
          [request.promotionId, index + 1, importRunId, capture.capture_id]
        );
      }

      const sourceRows: SourceRow[] = [];
      const sourceRowByKey = new Map<string, SourceRow>();
      const runOrdinals = new Map<string, number>();
      const sourceRow = async (inputRow: {
        key: string;
        recordKind: string;
        sourceRecordId: string;
        seasonYear: number;
        evidenceIds: readonly string[];
        record: unknown;
      }): Promise<SourceRow> => {
        const existing = sourceRowByKey.get(inputRow.key);
        if (existing) return existing;
        const candidates = sortedUnique(inputRow.evidenceIds)
          .map((evidenceId) => evidence.byEvidenceId.get(evidenceId))
          .filter((value): value is EvidenceSource => value !== undefined);
        if (candidates.length !== inputRow.evidenceIds.length) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Promotion record ${inputRow.sourceRecordId} references missing source evidence.`
          );
        }
        const primary =
          candidates.find(({ season_years }) =>
            season_years.map(Number).includes(inputRow.seasonYear)
          ) ?? null;
        if (!primary) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Promotion record ${inputRow.sourceRecordId} has no same-season contributing capture.`
          );
        }
        const importRunId = importRunByCapture.get(primary.capture_id);
        if (!importRunId) throw new TypeError('Promotion import run is missing.');
        const sourceOrdinal = (runOrdinals.get(importRunId) ?? 0) + 1;
        runOrdinals.set(importRunId, sourceOrdinal);
        const importRowId = createAflTradeContentAddress('external-canonical-row', {
          promotionId: request.promotionId,
          recordKind: inputRow.recordKind,
          sourceRecordId: inputRow.sourceRecordId,
        });
        const row: SourceRow = {
          importRowId,
          importRunId,
          captureId: primary.capture_id,
          seasonYear: inputRow.seasonYear,
          sourceOrdinal,
          recordKind: inputRow.recordKind,
          sourceRecordId: inputRow.sourceRecordId,
          recordSha256: sha256AflTradeCanonicalJson(inputRow.record),
          evidenceIds: sortedUnique(inputRow.evidenceIds),
          record: inputRow.record,
        };
        await transaction.query(
          `INSERT INTO outcome_import_row
            (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,
             parse_status,raw_payload,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,'approved'::"OutcomeRecordStatus",$7::jsonb,$8)`,
          [
            row.importRowId,
            row.importRunId,
            `external-promotion:${inputRow.recordKind}:${inputRow.sourceRecordId}`,
            row.sourceOrdinal,
            row.recordKind,
            row.recordSha256,
            canonicalizeAflTradeJson(inputRow.record),
            approval.promotedAt,
          ]
        );
        sourceRows.push(row);
        sourceRowByKey.set(inputRow.key, row);
        return row;
      };

      for (const definition of definitions.values()) {
        const kind = mapDraftKind(definition.draftType);
        await transaction.query(
          `INSERT INTO outcome_draft_pick
            (pick_id,draft_season_year,draft_kind,nominal_round,nominal_pick,original_club_id,status)
           VALUES ($1,$2,$3::"OutcomeEventKind",$4,$5,$6,'approved'::"OutcomeRecordStatus")
           ON CONFLICT (pick_id) DO NOTHING`,
          [
            definition.pickId,
            definition.draftYear,
            kind.eventKind,
            definition.nominalRound,
            definition.nominalPick,
            definition.originalClubId,
          ]
        );
        const exact = await transaction.query(
          `SELECT pick_id FROM outcome_draft_pick
            WHERE pick_id=$1 AND draft_season_year=$2 AND draft_kind=$3::"OutcomeEventKind"
              AND nominal_round IS NOT DISTINCT FROM $4 AND nominal_pick IS NOT DISTINCT FROM $5
              AND original_club_id IS NOT DISTINCT FROM $6 AND status='approved'::"OutcomeRecordStatus"
            FOR SHARE`,
          [
            definition.pickId,
            definition.draftYear,
            kind.eventKind,
            definition.nominalRound,
            definition.nominalPick,
            definition.originalClubId,
          ]
        );
        if (exact.rows.length !== 1) {
          throw new AflTradeExternalCanonicalPromotionError(
            'IMMUTABLE_CONFLICT',
            `Pick ${definition.pickId} already has different canonical facts.`
          );
        }
      }

      const promotionRecords: PromotionRecord[] = [];
      const eventVersionByTransaction = new Map<string, string>();
      for (const record of promotedTransactions) {
        const row = await sourceRow({
          key: `transaction:${record.transactionId}`,
          recordKind: 'external_transaction',
          sourceRecordId: record.transactionId,
          seasonYear: record.seasonYear,
          evidenceIds: record.evidenceIds,
          record,
        });
        await ensureEventRoot(transaction, {
          eventId: record.transactionId,
          competition: content.competition,
          seasonYear: record.seasonYear,
          stableKey: `external-transaction:${record.providerEventId}`,
        });
        const predecessor = await currentEventVersion(transaction, record.transactionId);
        if (predecessor && predecessor.recordedAt > approval.promotedAt) {
          throw new AflTradeExternalCanonicalPromotionError(
            'IMMUTABLE_CONFLICT',
            'Promotion cannot backdate an event correction.'
          );
        }
        const version = (predecessor?.version ?? 0) + 1;
        const eventVersionId = createAflTradeContentAddress('event-version', {
          promotionId: request.promotionId,
          eventId: record.transactionId,
          version,
          supersedesVersionId: predecessor?.eventVersionId ?? null,
          record,
        });
        const kind = transactionKind(record);
        await transaction.query(
          `INSERT INTO outcome_event_version
            (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
             official_name,status,source_import_row_id,supersedes_version_id,recorded_at)
           VALUES ($1,$2,$3,$4::"OutcomeEventKind",$5::"OutcomeAcquisitionMechanism",$6,$7,
                   'approved'::"OutcomeRecordStatus",$8,$9,$10)`,
          [
            eventVersionId,
            record.transactionId,
            version,
            kind.eventKind,
            kind.mechanism,
            record.occurredOn,
            record.title,
            row.importRowId,
            predecessor?.eventVersionId ?? null,
            approval.promotedAt,
          ]
        );
        for (const [ordinal, clubId] of [...record.parties].sort().entries()) {
          await transaction.query(
            `INSERT INTO outcome_event_party
              (event_version_id,club_id,source_import_row_id,role,ordinal)
             VALUES ($1,$2,$3,'party',$4)`,
            [eventVersionId, clubId, row.importRowId, ordinal + 1]
          );
        }
        eventVersionByTransaction.set(record.transactionId, eventVersionId);
        promotionRecords.push({
          recordKind: 'transaction',
          sourceRecordId: record.transactionId,
          canonicalRecordId: eventVersionId,
          sourceRow: row,
        });
      }

      const assetByTransfer = new Map<string, string>();
      for (const record of content.transfers) {
        const sourceTransaction = promotedTransactions.find(
          ({ transactionId }) => transactionId === record.transactionId
        );
        const eventVersionId = eventVersionByTransaction.get(record.transactionId);
        if (!sourceTransaction || !eventVersionId || !record.fromClubId || !record.toClubId) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Transfer ${record.transferId} is incomplete.`
          );
        }
        const row = await sourceRow({
          key: `transfer:${record.transferId}`,
          recordKind: 'external_transfer',
          sourceRecordId: record.transferId,
          seasonYear: sourceTransaction.seasonYear,
          evidenceIds: record.evidenceIds,
          record,
        });
        const assetVersionId = createAflTradeContentAddress('event-asset-version', {
          promotionId: request.promotionId,
          eventVersionId,
          transferId: record.transferId,
        });
        const player = record.asset.kind === 'player' ? record.asset.playerId : null;
        const identityDecision = player ? identityDecisionByPlayer.get(player) : null;
        const pick = record.asset.kind === 'pick_entitlement' ? record.asset.pickId : null;
        const assetKind =
          record.asset.kind === 'player'
            ? 'player'
            : record.asset.draftYear > sourceTransaction.seasonYear
              ? 'future_pick'
              : 'current_pick';
        const rawDescription =
          record.asset.kind === 'player'
            ? record.asset.recordedName
            : (record.asset.recordedLabel ??
              `${record.asset.draftYear} ${record.asset.draftType} pick ${record.asset.nominalPick ?? `round ${record.asset.nominalRound ?? '?'}`}`);
        await transaction.query(
          `INSERT INTO outcome_event_asset
            (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
             external_identity_decision_id,pick_id,from_club_id,to_club_id,source_import_row_id,
             raw_description,status)
           VALUES ($1,$2,$3,$4::"OutcomeAssetKind",$5,NULL,$6,$7,$8,$9,$10,$11,
                   'approved'::"OutcomeRecordStatus")`,
          [
            assetVersionId,
            eventVersionId,
            record.transferId,
            assetKind,
            player,
            identityDecision,
            pick,
            record.fromClubId,
            record.toClubId,
            row.importRowId,
            rawDescription,
          ]
        );
        assetByTransfer.set(record.transferId, assetVersionId);
        promotionRecords.push({
          recordKind: 'transfer',
          sourceRecordId: record.transferId,
          canonicalRecordId: assetVersionId,
          sourceRow: row,
        });
      }

      const canonicalSelectionBySource = new Map<string, string>();
      for (const coverage of approval.proposal.content.draftEventCoverage) {
        const selections = content.draftSelections
          .filter(
            ({ draftYear, draftType }) =>
              draftYear === coverage.draftYear && draftType === coverage.draftType
          )
          .sort((left, right) => left.selectionNumber - right.selectionNumber);
        const evidenceIds = sortedUnique(selections.flatMap(({ evidenceIds }) => evidenceIds));
        const coverageId = createAflTradeContentAddress('draft-event-coverage', coverage);
        const eventRow = await sourceRow({
          key: `draft-event:${coverageId}`,
          recordKind: 'external_draft_event',
          sourceRecordId: coverageId,
          seasonYear: coverage.draftYear,
          evidenceIds,
          record: coverage,
        });
        const eventId = createAflTradeContentAddress('draft-event', {
          competition: content.competition,
          draftYear: coverage.draftYear,
          draftType: coverage.draftType,
        });
        await ensureEventRoot(transaction, {
          eventId,
          competition: content.competition,
          seasonYear: coverage.draftYear,
          stableKey: `external-draft:${content.competition}:${coverage.draftYear}:${coverage.draftType}`,
        });
        const predecessor = await currentEventVersion(transaction, eventId);
        if (predecessor && predecessor.recordedAt > approval.promotedAt) {
          throw new AflTradeExternalCanonicalPromotionError(
            'IMMUTABLE_CONFLICT',
            'Promotion cannot backdate a draft-event correction.'
          );
        }
        const version = (predecessor?.version ?? 0) + 1;
        const eventVersionId = createAflTradeContentAddress('event-version', {
          promotionId: request.promotionId,
          eventId,
          version,
          supersedesVersionId: predecessor?.eventVersionId ?? null,
          coverage,
        });
        const draftKind = mapDraftKind(coverage.draftType);
        await transaction.query(
          `INSERT INTO outcome_event_version
            (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
             official_name,status,source_import_row_id,supersedes_version_id,recorded_at)
           VALUES ($1,$2,$3,$4::"OutcomeEventKind",$5::"OutcomeAcquisitionMechanism",$6,$7,
                   'approved'::"OutcomeRecordStatus",$8,$9,$10)`,
          [
            eventVersionId,
            eventId,
            version,
            draftKind.eventKind,
            draftKind.mechanism,
            coverage.eventDate,
            coverage.officialName,
            eventRow.importRowId,
            predecessor?.eventVersionId ?? null,
            approval.promotedAt,
          ]
        );
        const selectingClubs = sortedUnique(
          selections.flatMap(({ clubId }) => (clubId ? [clubId] : []))
        );
        for (const [ordinal, clubId] of selectingClubs.entries()) {
          const selection = selections.find((value) => value.clubId === clubId);
          if (!selection) throw new TypeError('Draft party source selection is missing.');
          const row = await sourceRow({
            key: `selection:${selection.selectionId}`,
            recordKind: 'external_draft_selection',
            sourceRecordId: selection.selectionId,
            seasonYear: selection.draftYear,
            evidenceIds: selection.evidenceIds,
            record: selection,
          });
          await transaction.query(
            `INSERT INTO outcome_event_party
              (event_version_id,club_id,source_import_row_id,role,ordinal)
             VALUES ($1,$2,$3,'selecting_club',$4)`,
            [eventVersionId, clubId, row.importRowId, ordinal + 1]
          );
        }
        for (const selection of selections) {
          if (!selection.playerId || !selection.clubId) {
            throw new AflTradeExternalCanonicalPromotionError(
              'CANDIDATE_UNAVAILABLE',
              `Selection ${selection.selectionId} has incomplete identities.`
            );
          }
          const row = await sourceRow({
            key: `selection:${selection.selectionId}`,
            recordKind: 'external_draft_selection',
            sourceRecordId: selection.selectionId,
            seasonYear: selection.draftYear,
            evidenceIds: selection.evidenceIds,
            record: selection,
          });
          const identityDecision = identityDecisionByPlayer.get(selection.playerId);
          if (!identityDecision) throw new TypeError('Selection identity decision is missing.');
          const canonicalSelectionId = createAflTradeContentAddress('draft-selection', {
            promotionId: request.promotionId,
            eventVersionId,
            sourceSelectionId: selection.selectionId,
          });
          await transaction.query(
            `INSERT INTO outcome_draft_selection
              (selection_id,event_version_id,selection_number,pick_id,player_id,player_identity_id,
               external_identity_decision_id,club_id,source_import_row_id,status)
             VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,'approved'::"OutcomeRecordStatus")`,
            [
              canonicalSelectionId,
              eventVersionId,
              selection.selectionNumber,
              selection.pickId,
              selection.playerId,
              identityDecision,
              selection.clubId,
              row.importRowId,
            ]
          );
          const playerAssetVersionId = createAflTradeContentAddress('event-asset-version', {
            promotionId: request.promotionId,
            eventVersionId,
            sourceSelectionId: selection.selectionId,
            kind: 'selected_player',
          });
          await transaction.query(
            `INSERT INTO outcome_event_asset
              (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
               external_identity_decision_id,pick_id,from_club_id,to_club_id,source_import_row_id,
               raw_description,status)
             VALUES ($1,$2,$3,'player'::"OutcomeAssetKind",$4,NULL,$5,NULL,NULL,$6,$7,$8,
                     'approved'::"OutcomeRecordStatus")`,
            [
              playerAssetVersionId,
              eventVersionId,
              `selected-player:${selection.selectionId}`,
              selection.playerId,
              identityDecision,
              selection.clubId,
              row.importRowId,
              `Selected with pick ${selection.selectionNumber}`,
            ]
          );
          canonicalSelectionBySource.set(selection.selectionId, canonicalSelectionId);
          promotionRecords.push(
            {
              recordKind: 'draft_selection',
              sourceRecordId: selection.selectionId,
              canonicalRecordId: canonicalSelectionId,
              sourceRow: row,
            },
            {
              recordKind: 'draft_player_asset',
              sourceRecordId: selection.selectionId,
              canonicalRecordId: playerAssetVersionId,
              sourceRow: row,
            }
          );
        }
        promotionRecords.push({
          recordKind: 'draft_event',
          sourceRecordId: coverageId,
          canonicalRecordId: eventVersionId,
          sourceRow: eventRow,
        });
      }

      for (const record of content.pickCustody) {
        if (!record.originalClubId || !record.currentClubId) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Custody ${record.custodyId} has incomplete clubs.`
          );
        }
        const row = await sourceRow({
          key: `custody:${record.custodyId}`,
          recordKind: 'external_pick_custody',
          sourceRecordId: record.custodyId,
          seasonYear: record.draftYear,
          evidenceIds: record.evidenceIds,
          record,
        });
        const kind = mapDraftKind(record.draftType);
        await transaction.query(
          `INSERT INTO outcome_pick_custody_observation
            (custody_observation_id,pick_id,observed_at,draft_season_year,draft_kind,
             recorded_round,recorded_pick,original_club_id,current_club_id,source_import_row_id,
             status,evidence_json,recorded_at)
           VALUES ($1,$2,$3,$4,$5::"OutcomeEventKind",$6,$7,$8,$9,$10,
                   'approved'::"OutcomeRecordStatus",$11::jsonb,$12)
           ON CONFLICT (custody_observation_id) DO NOTHING`,
          [
            record.custodyId,
            record.pickId,
            record.observedAt,
            record.draftYear,
            kind.eventKind,
            record.roundNumber,
            record.recordedPickNumber,
            record.originalClubId,
            record.currentClubId,
            row.importRowId,
            canonicalizeAflTradeJson({ evidenceIds: record.evidenceIds }),
            approval.promotedAt,
          ]
        );
        const exactCustody = await transaction.query(
          `SELECT custody_observation_id FROM outcome_pick_custody_observation
            WHERE custody_observation_id=$1 AND pick_id=$2 AND observed_at=$3
              AND draft_season_year=$4 AND draft_kind=$5::"OutcomeEventKind"
              AND recorded_round IS NOT DISTINCT FROM $6
              AND recorded_pick IS NOT DISTINCT FROM $7
              AND original_club_id=$8 AND current_club_id=$9
              AND source_import_row_id=$10 AND status='approved'::"OutcomeRecordStatus"
              AND evidence_json=$11::jsonb AND recorded_at=$12
            FOR SHARE`,
          [
            record.custodyId,
            record.pickId,
            record.observedAt,
            record.draftYear,
            kind.eventKind,
            record.roundNumber,
            record.recordedPickNumber,
            record.originalClubId,
            record.currentClubId,
            row.importRowId,
            canonicalizeAflTradeJson({ evidenceIds: record.evidenceIds }),
            approval.promotedAt,
          ]
        );
        if (exactCustody.rows.length !== 1) {
          throw new AflTradeExternalCanonicalPromotionError(
            'IMMUTABLE_CONFLICT',
            `Pick custody ${record.custodyId} already has different canonical facts.`
          );
        }
        promotionRecords.push({
          recordKind: 'pick_custody',
          sourceRecordId: record.custodyId,
          canonicalRecordId: record.custodyId,
          sourceRow: row,
        });
      }

      for (const record of content.pickLineage) {
        const transferAssetVersionId = assetByTransfer.get(record.transferId);
        const draftSelectionId = canonicalSelectionBySource.get(record.selectionId);
        const selection = content.draftSelections.find(
          ({ selectionId }) => selectionId === record.selectionId
        );
        if (!transferAssetVersionId || !draftSelectionId || !selection) {
          throw new AflTradeExternalCanonicalPromotionError(
            'CANDIDATE_UNAVAILABLE',
            `Pick realization ${record.lineageId} has incomplete canonical endpoints.`
          );
        }
        const row = await sourceRow({
          key: `realization:${record.lineageId}`,
          recordKind: 'external_pick_realization',
          sourceRecordId: record.lineageId,
          seasonYear: selection.draftYear,
          evidenceIds: record.evidenceIds,
          record,
        });
        const realizationId = createAflTradeContentAddress('pick-realization', {
          promotionId: request.promotionId,
          sourceLineageId: record.lineageId,
          transferAssetVersionId,
          draftSelectionId,
        });
        await transaction.query(
          `INSERT INTO outcome_pick_realization
            (realization_id,pick_id,transfer_asset_version_id,draft_selection_id,
             source_import_row_id,relation_kind,status,evidence_json,recorded_at)
           VALUES ($1,$2,$3,$4,$5,'exercised_as','approved'::"OutcomeRecordStatus",$6::jsonb,$7)`,
          [
            realizationId,
            record.pickId,
            transferAssetVersionId,
            draftSelectionId,
            row.importRowId,
            canonicalizeAflTradeJson({ evidenceIds: record.evidenceIds }),
            approval.promotedAt,
          ]
        );
        promotionRecords.push({
          recordKind: 'pick_realization',
          sourceRecordId: record.lineageId,
          canonicalRecordId: realizationId,
          sourceRow: row,
        });
      }

      const partitionGroups = new Map<string, SourceRow[]>();
      sourceRows.forEach((row) => {
        const key = `${row.importRunId}|${row.seasonYear}`;
        const values = partitionGroups.get(key) ?? [];
        values.push(row);
        partitionGroups.set(key, values);
      });
      for (const [key, rows] of partitionGroups) {
        rows.sort((left, right) => left.sourceOrdinal - right.sourceOrdinal);
        const [importRunId, seasonYearText] = key.split('|');
        const seasonYear = Number(seasonYearText);
        const rowIds = rows.map(({ importRowId }) => importRowId);
        const partitionId = createAflTradeContentAddress('external-canonical-partition', {
          promotionId: request.promotionId,
          importRunId,
          competition: content.competition,
          seasonYear,
          rowIds,
        });
        const partition = {
          schemaVersion: 'afl-trade-external-canonical-partition/v1',
          promotionId: request.promotionId,
          rowIds,
        };
        await transaction.query(
          `INSERT INTO outcome_import_partition
            (import_partition_id,import_run_id,partition_key,partition_kind,competition,
             season_year,row_count,rows_sha256,partition_json)
           VALUES ($1,$2,$3,'external_canonical_promotion',$4,$5,$6,$7,$8::jsonb)`,
          [
            partitionId,
            importRunId,
            `external-canonical:${request.promotionId}:${seasonYear}`,
            content.competition,
            seasonYear,
            rows.length,
            sha256AflTradeCanonicalJson(rowIds),
            canonicalizeAflTradeJson(partition),
          ]
        );
        for (const [ordinal, row] of rows.entries()) {
          await transaction.query(
            `INSERT INTO outcome_import_partition_row
              (import_partition_id,import_row_id,import_run_id,ordinal)
             VALUES ($1,$2,$3,$4)`,
            [partitionId, row.importRowId, importRunId, ordinal]
          );
        }
      }

      promotionRecords.sort(
        (left, right) =>
          left.recordKind.localeCompare(right.recordKind) ||
          left.sourceRecordId.localeCompare(right.sourceRecordId)
      );
      for (const [index, record] of promotionRecords.entries()) {
        const recordCanonical = canonicalizeAflTradeJson(record.sourceRow.record);
        await transaction.query(
          `INSERT INTO outcome_external_canonical_promotion_record
            (promotion_id,ordinal,record_kind,source_record_id,canonical_record_id,
             source_import_row_id,record_sha256,record_canonical_json,evidence_ids,record_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
          [
            request.promotionId,
            index + 1,
            record.recordKind,
            record.sourceRecordId,
            record.canonicalRecordId,
            record.sourceRow.importRowId,
            record.sourceRow.recordSha256,
            recordCanonical,
            canonicalizeAflTradeJson(record.sourceRow.evidenceIds),
            recordCanonical,
          ]
        );
      }

      const finalized = await transaction.query(
        `UPDATE outcome_external_canonical_promotion
            SET status='finalized',finalized_at=promoted_at
          WHERE promotion_id=$1 AND status='open' AND finalized_at IS NULL`,
        [request.promotionId]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeExternalCanonicalPromotionError(
          'IMMUTABLE_CONFLICT',
          'Promotion could not be finalized exactly once.'
        );
      }
      return {
        promotionId: request.promotionId,
        candidateId: candidate.candidateId,
        status: 'finalized',
        idempotentReplay: false,
        transactionCount: content.transactions.length,
        transferCount: content.transfers.length,
        draftSelectionCount: content.draftSelections.length,
        draftPlayerAssetCount,
        pickCustodyCount: content.pickCustody.length,
        pickRealizationCount: content.pickLineage.length,
      };
    });
  }
}
