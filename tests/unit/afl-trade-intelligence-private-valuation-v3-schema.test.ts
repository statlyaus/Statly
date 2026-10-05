// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'prisma/afl-trade-outcomes/migrations/0072_private_valuation_evidence_and_authority_v3/migration.sql'
);

describe('private valuation evidence and authority v3 schema', () => {
  it('uses separate append-only tables for factual evidence and executable authority', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE "outcome_private_valuation_evidence_bundle"');
    expect(sql).toContain('CREATE TABLE "outcome_private_valuation_authority_bundle_v3"');
    expect(sql).toContain('outcome_private_valuation_evidence_bundle_mutation_guard');
    expect(sql).toContain('outcome_private_valuation_authority_bundle_v3_mutation_guard');
    expect(sql).toContain('reject_outcome_private_model_authority_mutation');
  });

  it('binds every factual, model, method, evidence, and Gate 3 parent explicitly', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    for (const parent of [
      'outcome_release_manifest',
      'outcome_factual_release_candidate',
      'outcome_corpus_factual_lineage',
      'outcome_valuation_source_qualification_report',
      'outcome_private_valuation_evaluation_decision',
      'outcome_private_valuation_evidence_bundle',
      'outcome_valuation_model_run',
      'outcome_governed_pick_pav_model_candidate',
      'outcome_hpn_pav_method',
      'outcome_gate_decision',
    ]) {
      expect(sql).toContain(`REFERENCES "${parent}"`);
    }
  });

  it('checks exact canonical identities, duplicated columns, and private-only flags', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('afl-trade-private-valuation-evidence-bundle/v1');
    expect(sql).toContain('afl-trade-private-valuation-authority-bundle/v3');
    expect(sql).toContain("content->>'environment' IS DISTINCT FROM 'non_production'");
    expect(sql).toContain("content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb");
    expect(sql).toContain("content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb");
    expect(sql).toContain('outcome_afl_trade_canonical_json(content)');
    expect(sql).toContain("'valuation-evidence-bundle:' || encode(sha256");
    expect(sql).toContain("'valuation-bundle:' || encode(sha256");
    expect(sql).toContain('evaluated_trade_release_id');
    expect(sql).toContain('evaluation_evidence_release_id');
    expect(sql).toContain('evaluation_evidence_bundle_id');
  });
});
