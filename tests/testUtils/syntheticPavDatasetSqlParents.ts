import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { listAflTradeValuationDatasetArtifactMemberships } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import type { fullPlayerPavDatasetAdmissionFixture } from './playerPavDatasetAdmissionFixture';

type Fixture = Awaited<ReturnType<typeof fullPlayerPavDatasetAdmissionFixture>>;
const instant = '2026-09-02T00:05:00.000Z';
const hash = 'a'.repeat(64);
const tables = [
  'outcome_release_manifest',
  'outcome_factual_release_candidate',
  'outcome_corpus_factual_lineage',
  'outcome_corpus_factual_lineage_admission',
  'outcome_gate_decision',
  'outcome_artifact_custody',
  'outcome_acquisition_spell_version',
  'outcome_player_pav_observation_set',
  'outcome_hpn_pav_input_set',
  'outcome_hpn_pav_calculation',
  'outcome_hpn_pav_calculation_head',
  'outcome_hpn_pav_calculation_player',
  'outcome_source_capture',
  'outcome_source_rights_proposal',
  'outcome_gate_ledger_head',
] as const;

/** Synthetic upstream-only records: never a source-admission or integrated-custody proof. */
export async function seedSyntheticPavDatasetSqlParents(
  client: AflOutcomeSqlClient,
  fixture: Fixture
) {
  await client.transaction(async (transaction) => {
    // Transaction rollback restores trigger state on every exceptional exit.
    for (const table of tables) await transaction.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
    const seed = async (table: (typeof tables)[number], values: Record<string, unknown>) => {
      const columns = await transaction.query<{
        name: string;
        type: string;
        required: boolean;
        default: string | null;
      }>(
        `SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,
          pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [table]
      );
      const row = { ...values };
      for (const column of columns.rows) {
        if (column.name in row || !column.required || column.default !== null) continue;
        if (column.type.includes('timestamp')) row[column.name] = instant;
        else if (column.type === 'date') row[column.name] = '2002-01-01';
        else if (column.type === 'jsonb') row[column.name] = {};
        else if (/integer|bigint|double precision|numeric/.test(column.type)) row[column.name] = 1;
        else if (column.type === 'boolean') row[column.name] = false;
        else if (column.name.includes('sha256')) row[column.name] = hash;
        else if (column.name === 'environment') row[column.name] = 'test_fixture';
        else row[column.name] = 'synthetic-upstream';
      }
      const names = Object.keys(row);
      await transaction.query(
        `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(',')})
        SELECT ${names.map((name) => `"${name}"`).join(',')} FROM jsonb_populate_record(NULL::${table},$1::jsonb)
        ON CONFLICT ON CONSTRAINT "${table}_pkey" DO NOTHING`,
        [canonicalizeAflTradeJson(row)]
      );
    };
    const content = fixture.dataset.content;
    const parent = content.factualParent;
    await seed('outcome_release_manifest', {
      release_id: parent.factualReleaseId,
      environment: 'test_fixture',
      scope_key: content.scopeKey,
      manifest_json: { content: { scopeKey: content.scopeKey } },
    });
    await seed('outcome_factual_release_candidate', {
      candidate_id: parent.factualCandidateId,
      candidate_sha256: parent.factualCandidateId.split(':')[1],
      valid_from_season: 2003,
      valid_through_season: 2020,
      target_release_id: parent.factualReleaseId,
      promotion_backed_corpus_id: parent.corpusId,
      status: 'approved',
      finalized_at: instant,
      source_member_set_sha256: parent.sourceMemberSetSha256,
      candidate_json: fixture.evidence.factualCandidate,
    });
    const lineage = fixture.evidence.corpusLineage;
    await seed('outcome_corpus_factual_lineage', {
      lineage_id: lineage.lineageId,
      corpus_id: parent.corpusId,
      release_id: parent.factualReleaseId,
      candidate_id: parent.factualCandidateId,
      environment: 'test_fixture',
      scope_key: content.scopeKey,
      competition: 'AFLM',
      valid_from_season: 2003,
      valid_through_season: 2020,
      source_member_set_sha256: parent.sourceMemberSetSha256,
      lineage_json: lineage,
      lineage_canonical_json: canonicalizeAflTradeJson(lineage.content),
    });
    const gate = fixture.evidence.gate2Ledger.decisions[0]!;
    await seed('outcome_gate_decision', {
      decision_id: gate.decisionId,
      state: 'approved',
      gate: 'gate_2_corpus_lineage',
      proposal_id: gate.content.proposalId,
      decision_key: gate.content.decisionKey,
      version: gate.content.version,
      decided_at: gate.content.decidedAt,
      effective_at: '2026-09-02T00:08:00.000Z',
      revalidate_at: '2027-10-01T00:00:00.000Z',
      supersedes_decision_id: null,
      decision_json: gate,
    });
    await seed('outcome_corpus_factual_lineage_admission', {
      admission_id: `corpus-factual-lineage-admission:${hash}`,
      lineage_id: lineage.lineageId,
      gate_decision_id: gate.decisionId,
      revalidate_at: '2027-10-01T00:00:00.000Z',
    });
    await transaction.query('UPDATE outcome_gate_ledger_head SET revision=1 WHERE singleton_id=1');
    for (const proof of fixture.evidence.sourceRights) {
      const rights = proof.rightsProposal;
      await seed('outcome_source_rights_proposal', {
        rights_artifact_id: rights.rightsArtifactId,
        provider: rights.content.provider,
        dataset: rights.content.dataset,
        dataset_version: rights.content.datasetVersion,
        proposed_at: rights.content.proposedAt,
        content_json: rights,
      });
      await seed('outcome_source_capture', {
        capture_id: proof.captureId,
        source_snapshot_id: proof.sourceSnapshotId,
        attempt_id: `synthetic-attempt:${proof.captureId}`,
        status: 'approved',
        anchor_season_year: 2003,
        captured_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        manifest_json: proof.sourceSnapshotManifest,
      });
      for (const decision of proof.gateLedger.decisions)
        await seed('outcome_gate_decision', {
          decision_id: decision.decisionId,
          proposal_id: decision.content.proposalId,
          gate: decision.content.gate,
          decision_key: decision.content.decisionKey,
          version: decision.content.version,
          state: decision.content.state,
          decided_at: decision.content.decidedAt,
          effective_at: decision.content.effectiveAt,
          revalidate_at: decision.content.revalidateAt,
          supersedes_decision_id: null,
          decision_json: decision,
        });
    }
    for (const { reference } of listAflTradeValuationDatasetArtifactMemberships(fixture.dataset)) {
      await seed('outcome_artifact_custody', {
        artifact_id: reference.artifactId,
        content_sha256: reference.contentSha256,
        storage_uri: `artifact://sha256/${reference.contentSha256}`,
        media_type: reference.mediaType,
        byte_length: reference.byteLength,
        created_at: reference.createdAt,
        verified_at: reference.createdAt,
        artifact_class: 'derived_private',
        environment: 'test_fixture',
      });
    }
    const set = fixture.evidence.pavObservationSet;
    await seed('outcome_player_pav_observation_set', {
      observation_set_id: set.observationSetId,
      environment: 'test_fixture',
      competition: 'AFLM',
      release_id: set.content.releaseId,
      policy_id: set.content.policy.policyId,
      created_at: set.content.createdAt,
      knowledge_cutoff_at: set.content.knowledgeCutoffAt,
      status: 'finalized',
      calculation_count: set.content.calculations.length,
      observation_count: set.content.observations.length,
      observation_set_json: set,
      finalized_at: set.content.createdAt,
    });
    for (const proof of fixture.evidence.pavMeasurements) {
      const input = proof.inputSet;
      await seed('outcome_hpn_pav_input_set', {
        input_set_id: input.inputSetId,
        input_set_sha256: input.inputSetId.split(':')[1],
        factual_run_id: input.content.factualUniverse.factualRunId,
        source_run_count: input.content.sourceRuns.length,
        source_row_count: input.content.rows.length,
        completed_match_count: input.content.completedMatches.length,
        result_row_count: input.content.completedMatches.length,
        primary_player_row_count: input.content.counts.primaryPlayerRows,
        corroborating_player_row_count: input.content.counts.corroboratingPlayerRows,
        status: 'finalized',
        finalized_at: input.content.createdAt,
        input_set_json: input,
        environment: 'test_fixture',
        competition: 'AFLM',
        season_year: input.content.seasonYear,
        method_id: input.content.methodId,
        effective_through: input.content.effectiveThrough,
      });
      const calculation = proof.calculation;
      const value = calculation.content;
      await seed('outcome_hpn_pav_calculation', {
        calculation_id: calculation.calculationId,
        calculation_sha256: sha256AflTradeCanonicalJson(value),
        schema_version: value.schemaVersion,
        input_set_id: input.inputSetId,
        method_id: value.methodId,
        environment: 'test_fixture',
        competition: 'AFLM',
        season_year: value.seasonYear,
        effective_through: value.effectiveThrough,
        calculated_at: value.calculatedAt,
        value_unit: value.valueUnit,
        status: 'finalized',
        team_count: value.teams.length,
        player_count: value.players.length,
        calculation_json: calculation,
        calculation_canonical_json: canonicalizeAflTradeJson(value),
        finalized_at: value.calculatedAt,
      });
      await seed('outcome_hpn_pav_calculation_head', {
        calculation_id: calculation.calculationId,
        environment: 'test_fixture',
        competition: 'AFLM',
        season_year: value.seasonYear,
        method_id: value.methodId,
        revision: proof.headRevision,
      });
      for (const [ordinal, player] of value.players.entries()) {
        await seed('outcome_hpn_pav_calculation_player', {
          calculation_id: calculation.calculationId,
          spell_version_id: player.spellVersionId,
          player_id: player.playerId,
          team_id: player.teamId,
          ordinal,
          player_sha256: sha256AflTradeCanonicalJson(player),
          offensive_pav: player.offensivePav,
          midfield_pav: player.midfieldPav,
          defensive_pav: player.defensivePav,
          total_pav: player.totalPav,
          player_canonical_json: canonicalizeAflTradeJson(player),
        });
      }
    }
    for (const observation of set.content.observations)
      await seed('outcome_acquisition_spell_version', {
        spell_version_id: observation.acquisitionSpell.spellVersionId,
        spell_id: observation.acquisitionSpell.spellId,
        player_id: observation.playerId,
        club_id: observation.acquisitionSpell.clubId,
        status: 'approved',
        start_date: observation.acquisitionSpell.effectiveFrom,
        end_date: null,
      });
    for (const table of tables) await transaction.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
  });
}
