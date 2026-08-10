import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeFactualReleaseCandidateSchema,
  type AflTradeFactualReleaseCandidate,
} from './factualReleaseCandidateContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

export type AflTradeFactualReleaseCandidateWriteErrorCode =
  'INVALID_CANDIDATE' | 'CONFLICTING_REPLAY' | 'PERSISTENCE_FAILED';

export class AflTradeFactualReleaseCandidateWriteError extends Error {
  constructor(
    readonly code: AflTradeFactualReleaseCandidateWriteErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFactualReleaseCandidateWriteError';
  }
}

export interface AflTradeFactualReleaseCandidateWriteReceipt {
  candidateId: string;
  targetReleaseId: string;
  memberSetSha256: string;
  finalizedAt: string;
  idempotentReplay: boolean;
}

export interface AflTradeFactualReleaseCandidateWriter {
  persistCandidate(input: unknown): Promise<AflTradeFactualReleaseCandidateWriteReceipt>;
}

interface CandidateRow {
  candidate_sha256: string;
  target_release_id: string;
  member_set_sha256: string;
  candidate_json: unknown;
  finalized_at: Date | string | null;
  status: string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function fail(code: AflTradeFactualReleaseCandidateWriteErrorCode, message: string): never {
  throw new AflTradeFactualReleaseCandidateWriteError(code, message);
}

async function stageTargetReleaseManifest(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
): Promise<void> {
  const manifest = candidate.content.targetReleaseManifest;
  await transaction.query(
    `INSERT INTO outcome_release_manifest
      (release_id,scope_key,environment,created_at,effective_through,manifest_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (release_id) DO NOTHING`,
    [
      manifest.releaseId,
      manifest.content.scopeKey,
      manifest.content.environment,
      manifest.content.createdAt,
      manifest.content.effectiveThrough,
      canonicalizeAflTradeJson(manifest),
    ]
  );
  const persisted = await transaction.query<{ release_id: string }>(
    `SELECT release_id FROM outcome_release_manifest
      WHERE release_id=$1 AND scope_key=$2 AND environment=$3 AND created_at=$4
        AND effective_through=$5 AND manifest_json=$6::jsonb
        AND NOT EXISTS (SELECT 1 FROM outcome_registry_event WHERE release_id=$1)
      FOR KEY SHARE`,
    [
      manifest.releaseId,
      manifest.content.scopeKey,
      manifest.content.environment,
      manifest.content.createdAt,
      manifest.content.effectiveThrough,
      canonicalizeAflTradeJson(manifest),
    ]
  );
  if (persisted.rows.length !== 1) {
    fail(
      'CONFLICTING_REPLAY',
      'Target release manifest conflicts with stored or already-registered evidence.'
    );
  }
}

async function findReplay(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
): Promise<AflTradeFactualReleaseCandidateWriteReceipt | null> {
  const result = await transaction.query<CandidateRow>(
    `SELECT candidate_sha256,target_release_id,member_set_sha256,candidate_json,finalized_at,status
       FROM outcome_factual_release_candidate WHERE candidate_id=$1 FOR KEY SHARE`,
    [candidate.candidateId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (
    row.candidate_sha256 !== candidate.candidateSha256 ||
    row.target_release_id !== candidate.content.targetRelease.id ||
    row.member_set_sha256 !== candidate.content.memberSetSha256 ||
    canonicalizeAflTradeJson(row.candidate_json) !== canonicalizeAflTradeJson(candidate.content) ||
    row.finalized_at === null ||
    row.status !== 'approved'
  ) {
    fail('CONFLICTING_REPLAY', 'Factual release candidate conflicts with stored evidence.');
  }
  return {
    candidateId: candidate.candidateId,
    targetReleaseId: candidate.content.targetRelease.id,
    memberSetSha256: candidate.content.memberSetSha256,
    finalizedAt: asIso(row.finalized_at),
    idempotentReplay: true,
  };
}

async function insertOpenCandidate(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
) {
  const content = candidate.content;
  await transaction.query(
    `INSERT INTO outcome_factual_release_candidate
      (candidate_id,candidate_sha256,target_release_id,environment,scope_key,competition,
       valid_from_season,valid_through_season,effective_through,member_set_sha256,status,
       member_counts_json,candidate_json,created_at,finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'staged',$11::jsonb,$12::jsonb,$13,NULL)`,
    [
      candidate.candidateId,
      candidate.candidateSha256,
      content.targetRelease.id,
      content.environment,
      content.scopeKey,
      content.competition,
      content.validFromSeason,
      content.validThroughSeason,
      content.effectiveThrough,
      content.memberSetSha256,
      canonicalizeAflTradeJson(content.counts),
      canonicalizeAflTradeJson(content),
      content.createdAt,
    ]
  );
}

async function insertArchiveMembers(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
) {
  const releaseId = candidate.content.targetRelease.id;
  for (const member of candidate.content.members.sourceCaptures) {
    await transaction.query(
      `INSERT INTO outcome_release_source_capture
        (release_id,capture_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        releaseId,
        member.captureId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.reviewDecisions) {
    await transaction.query(
      `INSERT INTO outcome_release_review_decision
        (release_id,decision_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        releaseId,
        member.decisionId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.eventVersions) {
    await transaction.query(
      `INSERT INTO outcome_release_event_version
        (release_id,event_version_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        releaseId,
        member.eventVersionId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.lineageEdges) {
    await transaction.query(
      `INSERT INTO outcome_release_pick_lineage
        (release_id,edge_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        releaseId,
        member.edgeId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.acquisitionSpells) {
    await transaction.query(
      `INSERT INTO outcome_release_acquisition_spell
        (release_id,spell_version_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        releaseId,
        member.spellVersionId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
}

async function insertFactualMembers(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
) {
  const candidateId = candidate.candidateId;
  for (const member of candidate.content.members.factualRuns) {
    await transaction.query(
      `INSERT INTO outcome_release_factual_run_member
        (candidate_id,factual_run_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        candidateId,
        member.factualRunId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.reconciledMetrics) {
    await transaction.query(
      `INSERT INTO outcome_release_reconciled_metric_member
        (candidate_id,reconciled_fact_id,ordinal,record_sha256,head_revision,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        candidateId,
        member.reconciledFactId,
        member.ordinal,
        member.recordSha256,
        member.headRevision,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.achievementRuns) {
    await transaction.query(
      `INSERT INTO outcome_release_achievement_run_member
        (candidate_id,achievement_run_id,ordinal,record_sha256,membership_json) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        candidateId,
        member.achievementRunId,
        member.ordinal,
        member.recordSha256,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.reconciledAchievements) {
    await transaction.query(
      `INSERT INTO outcome_release_reconciled_achievement_member
        (candidate_id,reconciled_achievement_id,ordinal,record_sha256,head_revision,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        candidateId,
        member.reconciledAchievementId,
        member.ordinal,
        member.recordSha256,
        member.headRevision,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
  for (const member of candidate.content.members.spellMetrics) {
    await transaction.query(
      `INSERT INTO outcome_release_spell_metric_member
        (candidate_id,spell_metric_version_id,ordinal,record_sha256,head_revision,membership_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        candidateId,
        member.spellMetricVersionId,
        member.ordinal,
        member.recordSha256,
        member.headRevision,
        canonicalizeAflTradeJson(member),
      ]
    );
  }
}

async function finalizeCandidate(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeFactualReleaseCandidate
): Promise<AflTradeFactualReleaseCandidateWriteReceipt> {
  const result = await transaction.query<{ finalized_at: Date | string }>(
    `UPDATE outcome_factual_release_candidate SET status='approved',finalized_at=$2
      WHERE candidate_id=$1 AND finalized_at IS NULL RETURNING finalized_at`,
    [candidate.candidateId, candidate.content.createdAt]
  );
  if (result.rows.length !== 1)
    fail('PERSISTENCE_FAILED', 'Factual release candidate did not finalize once.');
  return {
    candidateId: candidate.candidateId,
    targetReleaseId: candidate.content.targetRelease.id,
    memberSetSha256: candidate.content.memberSetSha256,
    finalizedAt: asIso(result.rows[0].finalized_at),
    idempotentReplay: false,
  };
}

export class PostgresAflTradeFactualReleaseCandidateWriter implements AflTradeFactualReleaseCandidateWriter {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistCandidate(input: unknown): Promise<AflTradeFactualReleaseCandidateWriteReceipt> {
    const parsed = aflTradeFactualReleaseCandidateSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_CANDIDATE', parsed.error.message);
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-release-membership:${parsed.data.content.targetRelease.id}`,
        ]);
        const replay = await findReplay(transaction, parsed.data);
        if (replay) return replay;
        await stageTargetReleaseManifest(transaction, parsed.data);
        await insertOpenCandidate(transaction, parsed.data);
        await insertArchiveMembers(transaction, parsed.data);
        await insertFactualMembers(transaction, parsed.data);
        return finalizeCandidate(transaction, parsed.data);
      });
    } catch (error) {
      if (error instanceof AflTradeFactualReleaseCandidateWriteError) throw error;
      fail(
        'PERSISTENCE_FAILED',
        error instanceof Error ? error.message : 'Candidate persistence failed.'
      );
    }
  }
}
