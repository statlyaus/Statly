// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath =
  'prisma/afl-trade-outcomes/migrations/0058_governed_private_evaluation_lifecycle/migration.sql';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('governed private evaluation lifecycle migration', () => {
  it('is a forward migration after the landed 0057 authority boundary', () => {
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
  });

  it('persists immutable inspection ancestry and dormant generations before activation', () => {
    const migration = read(migrationPath);
    const inspectionTable = migration.slice(
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_inspection_receipt"'),
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_transition_intent"')
    );
    const intentTable = migration.slice(
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_transition_intent"'),
      migration.indexOf('CREATE TABLE "outcome_local_private_trade_evaluation_generation"')
    );

    expect(migration).toContain('outcome_private_evaluation_authority_snapshot');
    expect(migration).toContain('outcome_private_evaluation_inspection_receipt');
    expect(migration).toContain('outcome_private_evaluation_transition_intent');
    expect(migration).toContain('outcome_local_private_trade_evaluation_generation');
    expect(migration).toContain('transition_intent_id');
    expect(migration).toContain('generation_artifact_id');
    expect(migration).toContain('projection_manifest_artifact_id');
    expect(migration).toContain("DEFAULT clock_timestamp()");
    expect(migration).toContain('Private evaluation authority records are append-only');
    expect(migration).toContain('Private evaluation generations are append-only');
    expect(inspectionTable).toContain(
      `("state"='unavailable' AND "valid_through" IS NOT NULL AND "expected_head_status" IS NOT NULL AND "expected_head_revision" IS NOT NULL)`
    );
    expect(inspectionTable).toContain(
      `("expected_head_status"='absent' AND "expected_head_revision"=0 AND "expected_head_generation_id" IS NULL)`
    );
    expect(intentTable).toContain('"authority_snapshot_id" TEXT');
    expect(intentTable).toContain(
      `CHECK (("action"='withdraw') = ("authority_snapshot_id" IS NULL))`
    );
    expect(intentTable).toContain(
      'REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id", "valuation_scope_key", "trade_id")'
    );
  });

  it('adds exact governed authority for private evaluation operators', () => {
    const migration = read(migrationPath);

    expect(migration).toContain(`'afl_trade_private_evaluation_operator'`);
    expect(migration).toContain(`"capability_id" = 'manage_private_trade_evaluation'`);
    expect(migration).toContain(`"provider" = 'statly_modeling'`);
    expect(migration).toContain(`"scope_key" ~ '^afl-men:[0-9]{4}-trades$'`);
    expect(migration).toContain(`"scope_key" = 'afl-trade-history:test-fixture'`);
  });

  it('keys every mutable lifecycle head by scope and trade, including withdrawn heads', () => {
    const migration = read(migrationPath);
    const head = migration.slice(
      migration.indexOf('CREATE TABLE "outcome_local_private_trade_evaluation_head"'),
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_transition_receipt"')
    );

    expect(head).toMatch(/PRIMARY KEY \("valuation_scope_key", "trade_id"\)/u);
    expect(head).not.toMatch(/PRIMARY KEY \("trade_id"\)/u);
    expect(head).toContain(
      "CHECK ((status='active' AND generation_id IS NOT NULL) OR (status IN ('withdrawn') AND generation_id IS NULL))"
    );
  });

  it('retains an append-only receipt for every CAS transition without a generation cycle', () => {
    const migration = read(migrationPath);
    const receiptTable = migration.slice(
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_transition_receipt"'),
      migration.indexOf('ALTER TABLE "outcome_local_private_trade_evaluation_head"')
    );

    expect(migration).toContain('outcome_private_evaluation_transition_receipt');
    expect(migration).toContain('UNIQUE ("transition_intent_id")');
    expect(migration).toContain('from_revision');
    expect(migration).toContain('to_revision');
    expect(migration).toContain('from_generation_id');
    expect(migration).toContain('to_generation_id');
    expect(receiptTable).toContain(
      `CHECK ("action" IN ('construct_and_activate','withdraw','rollback','recover'))`
    );
    expect(migration).toContain('Private evaluation transition receipts are append-only');
    expect(migration).not.toMatch(
      /outcome_local_private_trade_evaluation_generation[\s\S]*activation_receipt_id/u
    );
  });

  it('records reconstruction verification without mutating lifecycle state', () => {
    const migration = read(migrationPath);
    const intentTable = migration.slice(
      migration.indexOf('CREATE TABLE "outcome_private_evaluation_transition_intent"'),
      migration.indexOf('CREATE TABLE "outcome_local_private_trade_evaluation_generation"')
    );

    expect(intentTable).not.toContain('verify_reconstruction');
    expect(migration).toContain(
      'CREATE TABLE "outcome_private_evaluation_reconstruction_verification"'
    );
    expect(migration).toContain('UNIQUE ("operation_id")');
    expect(migration).toContain('CHECK ("exact_match"=TRUE)');
    expect(migration).toContain('Private evaluation reconstruction verifications are append-only');
  });

  it('keeps the Prisma schema aligned with the composite PostgreSQL authority model', () => {
    const schema = read('prisma/afl-trade-outcomes/schema.prisma');

    expect(schema).toContain('model OutcomePrivateEvaluationAuthoritySnapshot');
    expect(schema).toContain('model OutcomePrivateEvaluationInspectionReceipt');
    expect(schema).toContain('model OutcomePrivateEvaluationTransitionIntent');
    expect(schema).toContain('model OutcomeLocalPrivateTradeEvaluationGeneration');
    expect(schema).toContain('model OutcomeLocalPrivateTradeEvaluationHead');
    expect(schema).toContain('model OutcomePrivateEvaluationTransitionReceipt');
    expect(schema).toContain('model OutcomePrivateEvaluationReconstructionVerification');
    expect(schema).toContain('@@id([valuationScopeKey, tradeId])');
  });
});
