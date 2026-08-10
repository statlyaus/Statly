import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'afl-trade-outcomes', 'schema.prisma'),
  'utf8'
);
const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0021_promotion_backed_factual_release',
    'migration.sql'
  ),
  'utf8'
);
const gate2Migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0022_promotion_backed_gate2_admission',
    'migration.sql'
  ),
  'utf8'
);
const publicArchiveMigration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0023_promotion_backed_public_archive',
    'migration.sql'
  ),
  'utf8'
);
const gate2CorpusScopeFix = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0028_gate2_corpus_scope_columns',
    'migration.sql'
  ),
  'utf8'
);

describe('promotion-backed factual release authority schema', () => {
  it('adds exact typed memberships for every canonical record family', () => {
    for (const model of [
      'OutcomeReleaseEventAsset',
      'OutcomeReleaseDraftSelection',
      'OutcomeReleasePickCustody',
      'OutcomeReleasePickRealization',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const table of [
      'outcome_release_event_asset',
      'outcome_release_draft_selection',
      'outcome_release_pick_custody',
      'outcome_release_pick_realization',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain("table_name||'_append_only'");
  });

  it('binds candidate v4 and release v3 to one finalized corpus and both roots', () => {
    expect(migration).toContain('promotion_backed_corpus_id');
    expect(migration).toContain('canonical_member_set_sha256');
    expect(migration).toContain('afl-trade-factual-release-candidate/v4');
    expect(migration).toContain('afl-draft-trade-factual-release/v3');
    expect(migration).toContain('validate_outcome_promotion_factual_candidate');
    expect(migration).toContain("\"candidate_json\"->'content'->>'corpusId'");
    expect(migration).toContain("\"candidate_json\"->'content'->>'canonicalMemberSetSha256'");
  });

  it('maps Gate 2 lineage validity to the corpus anchor-season columns', () => {
    expect(gate2CorpusScopeFix).toContain('"anchor_season_from"');
    expect(gate2CorpusScopeFix).toContain('"anchor_season_through"');
    expect(gate2CorpusScopeFix).toContain(
      'NEW."valid_from_season"<>corpus_row."anchor_season_from"'
    );
    expect(gate2CorpusScopeFix).toContain(
      'NEW."valid_through_season"<>corpus_row."anchor_season_through"'
    );
  });

  it('recomputes exact source and canonical membership closure before finalization', () => {
    expect(migration).toContain('source_member_set_sha256');
    expect(migration).toContain('canonical_member_set_sha256');
    expect(migration).toContain('outcome_promotion_backed_corpus_member');
    expect(migration).toContain('outcome_release_source_capture');
    expect(migration).toContain('outcome_release_event_version');
    expect(migration).toContain('outcome_release_event_asset');
    expect(migration).toContain('outcome_release_draft_selection');
    expect(migration).toContain('outcome_release_pick_custody');
    expect(migration).toContain('outcome_release_pick_realization');
    expect(migration).toContain('Promotion-backed factual canonical member set mismatch');
    expect(migration).toContain('Promotion-backed factual source capture set mismatch');
  });

  it('freezes all memberships and forbids legacy factual substitution', () => {
    expect(migration).toContain('reject_outcome_promotion_factual_late_member');
    expect(migration).toContain('Finalized promotion-backed candidate rejects late members');
    expect(migration).toContain('outcome_release_stat_observation');
    expect(migration).toContain('outcome_release_identity_assignment');
    expect(migration).toContain('outcome_release_reconciliation');
    expect(migration).toContain('Promotion-backed releases forbid legacy factual membership');
  });

  it('requires the exact finalized candidate before release-v3 registry admission', () => {
    expect(migration).toContain('validate_outcome_promotion_factual_registry_event');
    expect(migration).toContain('target_release_id=NEW."release_id"');
    expect(migration).toContain("status='approved'");
    expect(migration).toContain('finalized_at IS NOT NULL');
    expect(migration).toContain(
      'Promotion-backed factual release requires one exact finalized candidate'
    );
  });

  it('persists exact private lineage and renewable Gate 2 admissions', () => {
    expect(schema).toContain('model OutcomeCorpusFactualLineage {');
    expect(schema).toContain('model OutcomeCorpusFactualLineageAdmission {');
    expect(gate2Migration).toContain('CREATE TABLE "outcome_corpus_factual_lineage"');
    expect(gate2Migration).toContain('CREATE TABLE "outcome_corpus_factual_lineage_admission"');
    expect(gate2Migration).not.toContain('UNIQUE ("lineage_id")');
    expect(gate2Migration).toContain('UNIQUE ("gate_decision_id")');
  });

  it('recomputes lineage and admission content addresses in PostgreSQL', () => {
    expect(gate2Migration).toContain('validate_outcome_corpus_factual_lineage_insert');
    expect(gate2Migration).toContain('validate_outcome_corpus_factual_lineage_admission_insert');
    expect(gate2Migration).toContain('sha256(convert_to(NEW."lineage_canonical_json",\'UTF8\'))');
    expect(gate2Migration).toContain('sha256(convert_to(NEW."admission_canonical_json",\'UTF8\'))');
    expect(gate2Migration).toContain('outcome_corpus_factual_lineage_append_only');
    expect(gate2Migration).toContain('outcome_corpus_factual_lineage_admission_append_only');
  });

  it('binds registry admission to the current effective Gate 2 leaf', () => {
    expect(gate2Migration).toContain('decision."state"=\'approved\'');
    expect(gate2Migration).toContain(`successor."supersedes_decision_id"=decision."decision_id"`);
    expect(gate2Migration).toContain(`GREATEST(NEW."occurred_at",statement_timestamp())`);
    expect(gate2Migration).toContain(
      'Promotion-backed factual release requires one current Gate 2 admission'
    );
  });

  it('persists one sealed queryable archive and exact projection binding', () => {
    expect(schema).toContain('model OutcomePublicFactualArchive {');
    expect(schema).toContain('model OutcomePublicFactualArchiveRecord {');
    expect(schema).toContain('publicArchiveId');
    expect(publicArchiveMigration).toContain('CREATE TABLE "outcome_public_factual_archive"');
    expect(publicArchiveMigration).toContain(
      'CREATE TABLE "outcome_public_factual_archive_record"'
    );
    expect(publicArchiveMigration).toContain(
      'ALTER TABLE "outcome_projection_manifest" ADD COLUMN "public_archive_id"'
    );
    expect(publicArchiveMigration).toContain(
      'outcome_public_factual_archive_record_club_ids_gin_idx'
    );
    expect(publicArchiveMigration).toContain('outcome_public_factual_archive_record_search_idx');
  });

  it('authenticates exact archive bytes, canonical membership and finalization in SQL', () => {
    expect(publicArchiveMigration).toContain('validate_outcome_public_factual_archive_insert');
    expect(publicArchiveMigration).toContain(
      'validate_outcome_public_factual_archive_record_insert'
    );
    expect(publicArchiveMigration).toContain('finalize_outcome_public_factual_archive');
    expect(publicArchiveMigration).toContain('record_digest_canonical_json');
    expect(publicArchiveMigration).toContain('outcome-release-membership:');
    expect(publicArchiveMigration).toContain('Public factual archive row set is incomplete');
    expect(publicArchiveMigration).toContain('outcome_public_factual_archive_record_append_only');
    expect(publicArchiveMigration).toContain('validate_outcome_promotion_projection_archive');
    expect(publicArchiveMigration).toContain(
      'Promotion-backed projection does not bind one exact finalized public archive'
    );
  });
});
