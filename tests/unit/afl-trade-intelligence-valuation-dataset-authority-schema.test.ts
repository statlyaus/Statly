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
    '0030_valuation_dataset_admission',
    'migration.sql'
  ),
  'utf8'
);

describe('valuation dataset admission authority schema', () => {
  it('persists the private dataset, ordered rows, retained artifacts, and admissions', () => {
    for (const model of [
      'OutcomeValuationDatasetCandidate',
      'OutcomeValuationDatasetRow',
      'OutcomeValuationDatasetArtifactMember',
      'OutcomeValuationDatasetConsumedFieldSet',
      'OutcomeValuationDatasetGate0Evaluation',
      'OutcomeValuationDatasetOperationAuthority',
      'OutcomeValuationDatasetAdmission',
      'OutcomeValuationDatasetAdmissionSource',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const table of [
      'outcome_valuation_dataset_candidate',
      'outcome_valuation_dataset_row',
      'outcome_valuation_dataset_artifact_member',
      'outcome_valuation_dataset_consumed_field_set',
      'outcome_valuation_dataset_gate0_evaluation',
      'outcome_valuation_dataset_operation_authority',
      'outcome_valuation_dataset_admission',
      'outcome_valuation_dataset_admission_source',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('binds each dataset to exact finalized factual parents and private v4 content', () => {
    expect(migration).toContain('validate_outcome_valuation_dataset_candidate_insert');
    expect(migration).toContain('afl-trade-valuation-dataset/v4');
    expect(migration).toContain(
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership'
    );
    expect(migration).toContain("content->>'publicationEligible'<>'false'");
    expect(migration).toContain('outcome_factual_release_candidate');
    expect(migration).toContain('outcome_corpus_factual_lineage');
    expect(migration).toContain('outcome_corpus_factual_lineage_admission');
  });

  it('recomputes candidate and row content addresses and exact ordered closure', () => {
    expect(migration).toContain('sha256(convert_to(NEW."dataset_canonical_json",\'UTF8\'))');
    expect(migration).toContain('sha256(convert_to(NEW."row_canonical_json",\'UTF8\'))');
    expect(migration).toContain('sha256(convert_to(NEW."row_set_canonical_json",\'UTF8\'))');
    expect(migration).toContain('finalize_outcome_valuation_dataset_candidate');
    expect(migration).toContain('Valuation dataset row set is incomplete');
    expect(migration).toContain('Valuation dataset artifact set is incomplete');
    expect(migration).toContain('outcome_valuation_dataset_row_append_only');
    expect(migration).toContain('outcome_valuation_dataset_artifact_member_append_only');
  });

  it('requires retained exact artifacts and rejects late or mutable members', () => {
    expect(migration).toContain('outcome_valuation_dataset_artifact_custody_fkey');
    expect(migration).toContain('guard_outcome_valuation_dataset_child_insert');
    expect(migration).toContain('Finalized valuation datasets reject late members');
    expect(migration).toContain('Valuation dataset authority records are append-only');
  });

  it('persists admission v3 with exact Gate, source-rights, and operation-authority references', () => {
    expect(migration).toContain('validate_outcome_valuation_dataset_admission_insert');
    expect(migration).toContain('afl-trade-dataset-admission/v3');
    expect(migration).toContain('outcome_gate_decision');
    expect(migration).toContain('outcome_source_rights_proposal');
    expect(migration).toContain('validate_outcome_valuation_dataset_field_set_insert');
    expect(migration).toContain('validate_outcome_valuation_dataset_gate0_insert');
    expect(migration).toContain('validate_outcome_valuation_dataset_operation_authority_insert');
    expect(migration).toContain('afl_trade_analytical_authority_registry_writer');
    expect(migration).toContain('afl_trade_operational_authorization_registry_writer');
    expect(migration).toContain('outcome_valuation_dataset_admission_append_only');
    expect(migration).toContain('outcome_valuation_dataset_admission_source_append_only');
  });
});
