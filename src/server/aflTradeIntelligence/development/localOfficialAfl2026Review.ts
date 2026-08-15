import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';

interface LocalOfficialAflReviewRow {
  provider_decoded_row_id: string;
  identity_candidate_id: string;
  match_candidate_id: string;
  native_entity_id: string;
  recorded_name: string;
  recorded_club_name: string;
  native_match_id: string;
  round_label: string;
  match_date_text: string;
  definition_version: string;
  numeric_value: number;
}

interface LocalOfficialAflReviewedFact {
  nativeEntityId: string;
  nativeMatchId: string;
  roundLabel: string;
  matchDateText: string;
  definitionVersion: string;
  numericValue: number;
}

export interface LocalOfficialAflPlayerAppearanceEvidence {
  recordedName: string;
  recordedClubName: string;
  concludedAppearanceCount: number;
  goals: number;
  rounds: string[];
  firstAppearanceAt: string;
  lastAppearanceAt: string;
  evidenceSetSha256: string;
}

interface LocalReviewDecision {
  subjectType:
    | 'provider_identity_candidate'
    | 'provider_match_candidate'
    | 'local_reconciled_player_match_fact';
  subjectId: string;
  canonicalRecordType: 'local_player_club' | 'local_afl_match' | 'local_player_match_fact';
  canonicalRecordId: string;
  rationale: string;
  evidence: Record<string, unknown>;
}

const REVIEWED_SAM_FLANDERS_2026_FACTS: readonly LocalOfficialAflReviewedFact[] = [
  ['CD_M20260140005', 'Opening Round', '2026-03-08T08:20:00.000+0000', 0],
  ['CD_M20260140108', 'Round 1', '2026-03-15T04:15:00.000+0000', 0],
  ['CD_M20260140204', 'Round 2', '2026-03-21T05:15:00.000+0000', 0],
  ['CD_M20260140303', 'Round 3', '2026-03-28T01:35:00.000+0000', 0],
  ['CD_M20260140509', 'Round 5', '2026-04-12T09:15:00.000+0000', 0],
  ['CD_M20260140606', 'Round 6', '2026-04-18T09:35:00.000+0000', 0],
  ['CD_M20260140707', 'Round 7', '2026-04-26T03:10:00.000+0000', 1],
  ['CD_M20260140807', 'Round 8', '2026-05-02T09:35:00.000+0000', 0],
  ['CD_M20260140906', 'Round 9', '2026-05-09T09:10:00.000+0000', 0],
  ['CD_M20260141008', 'Round 10', '2026-05-17T05:15:00.000+0000', 0],
  ['CD_M20260141103', 'Round 11', '2026-05-22T10:30:00.000+0000', 0],
  ['CD_M20260141201', 'Round 12', '2026-05-28T09:30:00.000+0000', 0],
].map(([nativeMatchId, roundLabel, matchDateText, numericValue]) => ({
  nativeEntityId: 'CD_I1009260',
  nativeMatchId: String(nativeMatchId),
  roundLabel: String(roundLabel),
  matchDateText: String(matchDateText),
  definitionVersion: 'goals/v1',
  numericValue: Number(numericValue),
}));

function reviewedFact(row: LocalOfficialAflReviewRow): LocalOfficialAflReviewedFact {
  return {
    nativeEntityId: row.native_entity_id,
    nativeMatchId: row.native_match_id,
    roundLabel: row.round_label,
    matchDateText: row.match_date_text,
    definitionVersion: row.definition_version,
    numericValue: row.numeric_value,
  };
}

function evidenceSetSha256(facts: readonly LocalOfficialAflReviewedFact[]): string {
  return sha256AflTradeCanonicalJson(
    [...facts].sort((left, right) => left.nativeMatchId.localeCompare(right.nativeMatchId))
  );
}

export const LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 = evidenceSetSha256(
  REVIEWED_SAM_FLANDERS_2026_FACTS
);

function localCanonicalId(
  kind: LocalReviewDecision['canonicalRecordType'],
  value: unknown
): string {
  return `${kind}:${sha256AflTradeCanonicalJson({ boundary: 'private-local-review', value })}`;
}

async function ensureCurrentApprovedReview(
  transaction: AflOutcomeSqlTransaction,
  decision: LocalReviewDecision
): Promise<string> {
  const decisionId = `review-decision:${sha256AflTradeCanonicalJson(decision)}`;
  await transaction.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,canonical_record_type,
       canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,$2,$3,'approved',$4,$5,NULL,$6,$7::jsonb,$8,$9)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      decisionId,
      decision.subjectType,
      decision.subjectId,
      decision.canonicalRecordType,
      decision.canonicalRecordId,
      decision.rationale,
      canonicalizeAflTradeJson(decision.evidence),
      'local-workbook-evidence-reviewer',
      '2026-08-14T12:00:00.000Z',
    ]
  );
  return decisionId;
}

async function loadCandidateRows(
  transaction: AflOutcomeSqlTransaction,
  captureId: string,
  normalizationRunId: string
): Promise<readonly LocalOfficialAflReviewRow[]> {
  const result = await transaction.query<LocalOfficialAflReviewRow>(
    `SELECT decoded.provider_decoded_row_id,
            identity.identity_candidate_id,
            match.match_candidate_id,
            identity.native_entity_id,
            identity.recorded_name,
            identity.recorded_club_name,
            match.native_match_id,
            match.round_label,
            match.match_date_text,
            metric.definition_version,
            metric.numeric_value::double precision AS numeric_value
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
      WHERE decoded.capture_id=$1
        AND decoded.normalization_run_id=$2
        AND identity.recorded_name='Sam Flanders'
        AND identity.recorded_club_name='St Kilda'
        AND match.provider_status='CONCLUDED'
        AND metric.metric_code='goals'
        AND metric.availability='exact'
      ORDER BY match.match_date_text,decoded.provider_decoded_row_id`,
    [captureId, normalizationRunId]
  );
  return result.rows;
}

function assertReviewedSamFlandersRows(
  rows: readonly LocalOfficialAflReviewRow[]
): LocalOfficialAflPlayerAppearanceEvidence {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  const actualEvidenceSetSha256 = evidenceSetSha256(rows.map(reviewedFact));
  if (
    rows.length !== REVIEWED_SAM_FLANDERS_2026_FACTS.length ||
    !unique(rows.map(({ provider_decoded_row_id }) => provider_decoded_row_id)) ||
    !unique(rows.map(({ identity_candidate_id }) => identity_candidate_id)) ||
    !unique(rows.map(({ match_candidate_id }) => match_candidate_id)) ||
    rows.some(
      (row) =>
        row.recorded_name !== 'Sam Flanders' ||
        row.recorded_club_name !== 'St Kilda' ||
        !Number.isSafeInteger(row.numeric_value) ||
        row.numeric_value < 0
    ) ||
    actualEvidenceSetSha256 !== LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256
  ) {
    throw new TypeError(
      'The staged official 2026 source does not match the exact reviewed Sam Flanders evidence set.'
    );
  }
  const ordered = [...rows].sort(
    (left, right) => Date.parse(left.match_date_text) - Date.parse(right.match_date_text)
  );
  return {
    recordedName: 'Sam Flanders',
    recordedClubName: 'St Kilda',
    concludedAppearanceCount: ordered.length,
    goals: ordered.reduce((sum, { numeric_value }) => sum + numeric_value, 0),
    rounds: ordered.map(({ round_label }) => round_label),
    firstAppearanceAt: ordered[0]!.match_date_text,
    lastAppearanceAt: ordered.at(-1)!.match_date_text,
    evidenceSetSha256: actualEvidenceSetSha256,
  };
}

export async function inspectLocalOfficialAfl2026SamFlandersEvidence(
  client: AflOutcomeSqlTransaction,
  captureId: string,
  normalizationRunId: string
): Promise<LocalOfficialAflPlayerAppearanceEvidence> {
  return assertReviewedSamFlandersRows(
    await loadCandidateRows(client, captureId, normalizationRunId)
  );
}

export async function reviewLocalOfficialAfl2026SamFlandersEvidence(
  client: AflOutcomeSqlClient,
  captureId: string,
  normalizationRunId: string
): Promise<LocalOfficialAflPlayerAppearanceEvidence> {
  return client.transaction(async (transaction) => {
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      'local-official-afl-2026-sam-flanders-review',
    ]);
    const rows = await loadCandidateRows(transaction, captureId, normalizationRunId);
    const evidence = assertReviewedSamFlandersRows(rows);
    const playerClubId = localCanonicalId('local_player_club', {
      nativeEntityId: rows[0]!.native_entity_id,
      clubName: evidence.recordedClubName,
    });
    const decisionIds: string[] = [];
    for (const row of rows) {
      decisionIds.push(
        await ensureCurrentApprovedReview(transaction, {
          subjectType: 'provider_identity_candidate',
          subjectId: row.identity_candidate_id,
          canonicalRecordType: 'local_player_club',
          canonicalRecordId: playerClubId,
          rationale:
            'Approve this exact provider identity only for private local workbook evaluation.',
          evidence: {
            captureId,
            normalizationRunId,
            evidenceSetSha256: evidence.evidenceSetSha256,
            providerDecodedRowId: row.provider_decoded_row_id,
            nativeEntityId: row.native_entity_id,
            recordedName: row.recorded_name,
            recordedClubName: row.recorded_club_name,
          },
        })
      );
      const matchId = localCanonicalId('local_afl_match', row.native_match_id);
      decisionIds.push(
        await ensureCurrentApprovedReview(transaction, {
          subjectType: 'provider_match_candidate',
          subjectId: row.match_candidate_id,
          canonicalRecordType: 'local_afl_match',
          canonicalRecordId: matchId,
          rationale:
            'Approve this exact concluded match only for private local workbook evaluation.',
          evidence: {
            captureId,
            normalizationRunId,
            evidenceSetSha256: evidence.evidenceSetSha256,
            providerDecodedRowId: row.provider_decoded_row_id,
            nativeMatchId: row.native_match_id,
            matchDate: row.match_date_text,
            providerStatus: 'CONCLUDED',
          },
        })
      );
      decisionIds.push(
        await ensureCurrentApprovedReview(transaction, {
          subjectType: 'local_reconciled_player_match_fact',
          subjectId: row.provider_decoded_row_id,
          canonicalRecordType: 'local_player_match_fact',
          canonicalRecordId: localCanonicalId('local_player_match_fact', {
            playerClubId,
            matchId,
            metricCode: 'goals',
            definitionVersion: row.definition_version,
            numericValue: row.numeric_value,
          }),
          rationale:
            'Reconcile one reviewed appearance and its exact goals value only for private local workbook evaluation.',
          evidence: {
            evidenceSetSha256: evidence.evidenceSetSha256,
            identityCandidateId: row.identity_candidate_id,
            matchCandidateId: row.match_candidate_id,
            appearanceObserved: true,
            metricCode: 'goals',
            metricAvailability: 'exact',
            definitionVersion: row.definition_version,
            numericValue: row.numeric_value,
          },
        })
      );
    }
    const current = await transaction.query<{ decision_count: number }>(
      `SELECT count(*)::integer AS decision_count
         FROM outcome_review_decision decision
        WHERE decision.decision_id=ANY($1::text[])
          AND decision.decision='approved'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )`,
      [decisionIds]
    );
    if (current.rows[0]?.decision_count !== decisionIds.length || decisionIds.length !== 36) {
      throw new TypeError(
        'The exact private local official review set is not current and complete.'
      );
    }
    const reviewSetDecisionId = `local-official-afl-review:set:${evidence.evidenceSetSha256}`;
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'local_review_set',$2,'approved','local_review_set',$2,NULL,$3,$4::jsonb,$5,$6)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        reviewSetDecisionId,
        evidence.evidenceSetSha256,
        'Admit the complete exact official 2026 review set only for private local workbook evaluation.',
        canonicalizeAflTradeJson({
          evidenceSetSha256: evidence.evidenceSetSha256,
          appearanceCount: evidence.concludedAppearanceCount,
          decisionCount: decisionIds.length,
          decisionIds: [...decisionIds].sort(),
        }),
        'local-workbook-evidence-reviewer',
        '2026-08-14T12:00:00.000Z',
      ]
    );
    const admitted = await transaction.query<{ decision_id: string }>(
      `SELECT decision_id FROM outcome_review_decision decision
        WHERE decision_id=$1 AND subject_type='local_review_set' AND subject_id=$2
          AND decision='approved' AND canonical_record_type='local_review_set'
          AND canonical_record_id=$2
          AND evidence_json->>'evidenceSetSha256'=$2
          AND (evidence_json->>'appearanceCount')::integer=12
          AND (evidence_json->>'decisionCount')::integer=36
          AND jsonb_array_length(evidence_json->'decisionIds')=36
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=decision.decision_id
          )`,
      [reviewSetDecisionId, evidence.evidenceSetSha256]
    );
    if (admitted.rows.length !== 1) {
      throw new TypeError('The complete private official review set was not admitted.');
    }
    return evidence;
  });
}
