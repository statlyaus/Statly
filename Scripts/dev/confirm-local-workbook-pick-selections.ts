import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { PostgresLocalWorkbookPickSelectionConfirmationRepository } from '../../src/server/aflTradeIntelligence/development/postgresLocalWorkbookPickSelectionConfirmationRepository';
import {
  resolveLocalWorkbookPickSelectionConfirmation,
  type LocalWorkbookPickSelectionIdentityCandidate,
} from '../../src/server/aflTradeIntelligence/development/localWorkbookPickSelectionConfirmationResolution';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { loadAflOutcomesDevelopmentWorkbook } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import { projectAflOutcomesDevelopmentWorkbookTrades } from '../../src/server/aflTradeIntelligence/source/developmentWorkbookTradeProjection';

interface EvidenceRow {
  valuation_scope_key: string;
  evidence_bundle_id: string;
  canonical_player_id: string;
  recorded_name: string;
  identity_decision_ids: string[];
  reviewed_season_ids: string[];
}

function confirmationsFromArguments(arguments_: readonly string[]): Map<string, string> {
  const confirmations = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    const encoded =
      argument === '--confirm'
        ? arguments_[index + 1]
        : argument.startsWith('--confirm=')
          ? argument.slice('--confirm='.length)
          : undefined;
    if (encoded === undefined) continue;
    if (argument === '--confirm') index += 1;
    const separator = encoded.indexOf('=');
    const assetId = encoded.slice(0, separator).trim();
    const canonicalPlayerId = encoded.slice(separator + 1).trim();
    if (
      separator <= 0 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$/u.test(assetId) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$/u.test(canonicalPlayerId) ||
      confirmations.has(assetId)
    ) {
      throw new TypeError('--confirm requires one unique asset-id=canonical-player-id mapping.');
    }
    confirmations.set(assetId, canonicalPlayerId);
  }
  return confirmations;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertDisposableDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new Error('Pick-selection confirmation requires loopback statly_outcomes_test.');
  }
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('PostgreSQL returned invalid time.');
  return parsed.toISOString();
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const approve = arguments_.includes('--approve');
  const confirmations = confirmationsFromArguments(arguments_);
  const root = resolve(import.meta.dirname, '../..');
  const workbookPath = required('AFL_OUTCOMES_DEV_WORKBOOK_PATH');
  const workbookSha256 = required('AFL_OUTCOMES_DEV_WORKBOOK_SHA256').toLowerCase();
  const databaseUrl = required('AFL_OUTCOMES_DATABASE_URL');
  assertDisposableDatabase(databaseUrl);
  const runtimeNonce = (
    process.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  const workbook = await loadAflOutcomesDevelopmentWorkbook({
    workbookPath,
    expectedSha256: workbookSha256,
    runtimeEnvironment: process.env.NODE_ENV,
  });
  const details = [...projectAflOutcomesDevelopmentWorkbookTrades(workbook).detailsById.values()];
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: 'statly-local-workbook-pick-selection-confirmation',
    connectionTimeoutMillis: 30_000,
    statement_timeout: 180_000,
    max: 1,
  });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
    const evidence = await pool.query<EvidenceRow>(
      `SELECT head.valuation_scope_key,head.evidence_bundle_id,
              member.canonical_player_id,candidate.recorded_name,
              array_agg(DISTINCT member.member_json->'playerIdentity'->>'identityDecisionId'
                        ORDER BY member.member_json->'playerIdentity'->>'identityDecisionId')
                AS identity_decision_ids,
              array_agg(DISTINCT member.reviewed_season_id ORDER BY member.reviewed_season_id)
                AS reviewed_season_ids
         FROM outcome_private_reviewed_evaluation_head head
         JOIN outcome_private_reviewed_evaluation_decision decision
           ON decision.decision_id=head.decision_id
         JOIN outcome_private_reviewed_evidence_bundle bundle
           ON bundle.evidence_bundle_id=head.evidence_bundle_id
         JOIN outcome_hpn_reviewed_season_member member ON member.identity_state='resolved'
         JOIN outcome_hpn_reviewed_season_universe season
           ON season.reviewed_season_id=member.reviewed_season_id
         JOIN outcome_provider_identity_candidate candidate
           ON candidate.provider_decoded_row_id=member.provider_decoded_row_id
        WHERE head.evidence_scope_key='afl-player-match-reviewed-2021-2026'
          AND head.status='authorized'
          AND decision.decision_json->'content'->>'status'='authorized'
          AND decision.decision_json->'content'->>'schemaVersion'
                ='afl-trade-private-reviewed-evidence-evaluation-decision/v1'
          AND decision.decision_json->'content'->>'authorityBoundary'
                ='exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
          AND decision.decision_json->'content'->'permissions'->>'internalEvaluation'='true'
          AND decision.decision_json->'content'->'permissions'->>'derivedCalculations'='true'
          AND decision.decision_json->'content'->'publicationProhibited'='true'::jsonb
          AND outcome_private_reviewed_evidence_bundle_is_current(head.evidence_bundle_id)
          AND season.candidate_json->'content'->>'resolvedReviewSetSha256'
                IN (SELECT item->>'reviewSetId'
                      FROM jsonb_array_elements(
                        bundle.bundle_json->'content'->'reviewSets'
                      ) review_set(item))
        GROUP BY head.valuation_scope_key,head.evidence_bundle_id,
                 member.canonical_player_id,candidate.recorded_name
        ORDER BY head.valuation_scope_key,member.canonical_player_id,candidate.recorded_name`
    );
    const evidenceByScope = new Map<
      string,
      { bundleId: string; candidates: LocalWorkbookPickSelectionIdentityCandidate[] }
    >();
    for (const row of evidence.rows) {
      const retained = evidenceByScope.get(row.valuation_scope_key);
      if (retained !== undefined && retained.bundleId !== row.evidence_bundle_id) {
        throw new Error(
          'Pick-selection confirmation found conflicting evidence bundles for one scope.'
        );
      }
      const scopeEvidence = retained ?? { bundleId: row.evidence_bundle_id, candidates: [] };
      scopeEvidence.candidates.push({
        canonicalPlayerId: row.canonical_player_id,
        recordedName: row.recorded_name,
        identityDecisionIds: row.identity_decision_ids,
        reviewedSeasonIds: row.reviewed_season_ids,
      });
      evidenceByScope.set(row.valuation_scope_key, scopeEvidence);
    }
    const trusted = await pool.query<{ reviewed_at: Date | string }>(
      `SELECT date_trunc('milliseconds',transaction_timestamp()) AS reviewed_at`
    );
    const reviewedAt = iso(trusted.rows[0]!.reviewed_at);
    const repository = new PostgresLocalWorkbookPickSelectionConfirmationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const counts = new Map<string, number>();
    let confirmed = 0;
    let existing = 0;
    for (const detail of details) {
      const valuationScopeKey = `afl-men:${detail.trade.year}-trades`;
      const scopeEvidence = evidenceByScope.get(valuationScopeKey);
      const assets = detail.assets.filter(
        ({ assetType }) => assetType === 'pick' || assetType === 'future_pick'
      );
      if (scopeEvidence === undefined) {
        counts.set(
          'valuation_scope_not_authorized',
          (counts.get('valuation_scope_not_authorized') ?? 0) + assets.length
        );
        continue;
      }
      const retained = new Map(
        (
          await repository.loadForTrade(
            workbookSha256,
            valuationScopeKey,
            detail.trade.tradeId,
            assets.map(({ id }) => id)
          )
        ).map((confirmation) => [confirmation.content.assetId, confirmation])
      );
      for (const asset of assets) {
        if (retained.has(asset.id)) {
          existing += 1;
          continue;
        }
        const resolution = resolveLocalWorkbookPickSelectionConfirmation({
          asset,
          workbookSha256,
          valuationScopeKey,
          evidenceBundleId: scopeEvidence.bundleId,
          candidates: scopeEvidence.candidates,
          reviewerId: 'local-workbook-pick-selection-confirmer',
          rationale:
            'Confirmed the exact recorded pick settlement and selected-player identity without granting numerical authority.',
          reviewedAt,
          confirmedCanonicalPlayerId: confirmations.get(asset.id),
        });
        if (resolution.state === 'unavailable') {
          counts.set(resolution.reason, (counts.get(resolution.reason) ?? 0) + 1);
          continue;
        }
        if (approve) await repository.register(resolution.confirmation);
        confirmed += 1;
      }
    }
    process.stdout.write(
      `${JSON.stringify({
        status: approve ? 'confirmed' : 'dry_run',
        confirmable: confirmed,
        retained: existing,
        unavailable: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
        publicationEligible: false,
      })}\n`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
