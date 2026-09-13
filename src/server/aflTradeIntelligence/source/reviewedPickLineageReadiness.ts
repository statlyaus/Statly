import { z } from 'zod';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { bindReviewedPickLineage } from './reviewedPickLineage';

/** Read-only preparation through the promotion owner. Presence is not current source authority. */
export async function previewReviewedPickLineage(
  client: AflOutcomeSqlClient,
  input: {
    candidateId: string;
    environment: 'test_fixture' | 'non_production' | 'production';
    records: readonly unknown[];
  }
) {
  const candidateId = aflTradeContentAddressedIdSchema('external-reconciliation').parse(
    input.candidateId
  );
  const environment = z
    .enum(['test_fixture', 'non_production', 'production'])
    .parse(input.environment);
  return client.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION READ ONLY');
    const result = await transaction.query<{
      candidate_json: unknown;
      status: string;
      finalized_at: Date | string | null;
    }>(
      `SELECT candidate_json,status,finalized_at FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
      [candidateId]
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      !row ||
      row.status !== 'finalized' ||
      row.finalized_at === null
    ) {
      throw new TypeError('Reviewed lineage requires one finalized retained candidate.');
    }
    const candidate = parseAflTradeExternalReconciliationCandidate(row.candidate_json);
    if (candidate.candidateId !== candidateId || candidate.content.environment !== environment) {
      throw new TypeError(
        'Reviewed lineage must match the retained candidate and execution environment.'
      );
    }
    const bound = bindReviewedPickLineage(candidate, input.records);
    const endpoints = bound.records.flatMap((record) =>
      record.endpoint.kind === 'selected' || record.endpoint.kind === 'rookie_elevation'
        ? [{ transferId: record.transferId, ...record.endpoint }]
        : []
    );
    const playerIds = [
      ...new Set(endpoints.flatMap((endpoint) => (endpoint.playerId ? [endpoint.playerId] : []))),
    ].sort();
    const players = await transaction.query<{ player_id: string }>(
      `SELECT player_id FROM outcome_player WHERE player_id=ANY($1::text[]) AND status='approved'::"OutcomeRecordStatus"`,
      [playerIds]
    );
    const approvedPlayers = new Set(players.rows.map((player) => player.player_id));
    const sourceArtifactIds = [
      ...new Set(
        bound.records.flatMap((record) =>
          record.movements.flatMap((movement) =>
            movement.source ? [movement.source.artifact.artifactId] : []
          )
        )
      ),
    ].sort();
    const captures = await transaction.query<{ source_artifact_id: string }>(
      `SELECT DISTINCT source_artifact_id FROM outcome_source_capture
       WHERE source_artifact_id=ANY($1::text[]) AND environment=$2`,
      [sourceArtifactIds, environment]
    );
    const registeredSources = new Set(captures.rows.map((capture) => capture.source_artifact_id));
    return {
      ...bound,
      environment,
      unresolvedPlayerTransfers: endpoints
        .filter((endpoint) => endpoint.playerId === null)
        .map((endpoint) => endpoint.transferId)
        .sort(),
      unapprovedPlayerIds: playerIds.filter((id) => !approvedPlayers.has(id)),
      unregisteredSourceArtifactIds: sourceArtifactIds.filter((id) => !registeredSources.has(id)),
      registeredSourceArtifactCount: registeredSources.size,
      originalCandidateIssueCount: candidate.content.issues.length,
      promotionEligible: false as const,
      currentAuthorityAuthenticated: false as const,
    };
  });
}
