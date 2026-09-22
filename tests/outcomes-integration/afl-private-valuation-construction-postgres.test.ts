import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  composeLocalAflTradePrivateValuationConstruction,
  inspectLocalAflTradePrivateValuationConstruction,
} from '@/server/aflTradeIntelligence/development/localPrivateValuationConstruction';
import { AflTradeLocalPrivateValuationConfigurationError } from '@/server/aflTradeIntelligence/development/localPrivateValuationRuntime';
import type { AflTradePrivateValuationHpnPreparationDependencies } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnPreparation';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Disposable AFL_OUTCOMES_TEST_DATABASE_URL required.');
const schemaName = `afl_private_valuation_construction_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const artifactRoot = mkdtempSync(join(tmpdir(), 'statly-private-valuation-construction-'));
const retainedAt = '2026-09-11T00:00:00.000Z';

function artifact(label: string): AflTradeArtifactRef {
  return createAflTradeCanonicalJsonArtifactRef({ label }, retainedAt);
}

/**
 * A declared authority that must never run during inspection. Every member rejects, so an inspection
 * that captures a source, executes a model, or registers a qualification fails loudly instead of
 * silently acquiring new authority.
 */
const undeclaredAuthority: AflTradePrivateValuationHpnPreparationDependencies = {
  factualPreparation: {
    prepare: () => Promise.reject(new Error('inspection must not prepare factual authority')),
  },
  methodId: 'hpn-pav-method:0000000000000000000000000000000000000000000000000000000000000000',
  methodAuthority: {
    loadExact: () => Promise.reject(new Error('inspection must not load method authority')),
  },
  captureSource: () => Promise.reject(new Error('inspection must not capture a source')),
};

const declaredSelection = {
  qualificationPolicyArtifactId: artifact('qualification-policy').artifactId,
  modelSeed: 574,
  modelTargets: {
    player: {
      modelId: 'player-model',
      modelVersion: 'v1',
      protocolId: 'player-protocol',
      datasetId: 'player-dataset',
      datasetAdmissionId: 'player-dataset-admission',
    },
    pick: {
      protocolId: 'pick-protocol',
      datasetId: 'pick-dataset',
      datasetAdmissionId: 'pick-dataset-admission',
      policyId: 'pick-policy',
    },
    qualificationPolicyId: 'qualification-policy-v1',
  },
  valuationInputBundleConstructionSpecificationId:
    'valuation-input-bundle-construction:0000000000000000000000000000000000000000000000000000000000000000',
  valuationInputBundleConstructionSpecificationArtifact: artifact('bundle-specification'),
  constructionSpecificationArtifact: artifact('construction-specification'),
  calculationInputPackage: artifact('calculation-input-package'),
  constructionPolicy: artifact('construction-policy'),
  constructionRuns: { player: 'player-run', pick: 'pick-run' },
} as const;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await admin.end();
  rmSync(artifactRoot, { recursive: true, force: true });
});

describe('local private valuation construction root', () => {
  it('names every genuinely missing authority for an undeclared scope', async () => {
    const report = await inspectLocalAflTradePrivateValuationConstruction({ pool, artifactRoot });

    expect(report).toMatchObject({
      schemaVersion: 'afl-private-valuation-construction-report/v1',
      scopeKey: 'afl-men:2025-trades',
      state: 'blocked',
      qualificationGranted: false,
    });
    expect(report.blockerCodes).toEqual([
      'cohort_trade_construction_owner_missing',
      'construction_selection_not_supplied',
      'hpn_preparation_authority_not_declared',
      'hpn_source_authority_missing',
    ]);
    // The 2025 corroborating lane is the exact source authority issue 579 item 2 leaves open. The
    // completed-results and primary-player-stat lanes resolve for 2025, so this is the only lane.
    expect(
      report.blockers.filter((blocker) => blocker.code === 'hpn_source_authority_missing')
    ).toEqual([
      {
        code: 'hpn_source_authority_missing',
        subject: { kind: 'source_role', id: 'hpn_corroborating_player_stats' },
        reason:
          'No exact reviewed corroborating player-stat authority is configured for afl-men:2025-trades.',
      },
    ]);
  });

  it('reports a declared selection that omits required fields field by field', async () => {
    const report = await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: { ...declaredSelection, constructionRuns: undefined },
    });

    expect(report.blockerCodes).toEqual([
      'cohort_trade_construction_owner_missing',
      'construction_selection_field_missing',
      'hpn_preparation_authority_not_declared',
      'hpn_source_authority_missing',
    ]);
    expect(
      report.blockers.filter((blocker) => blocker.code === 'construction_selection_field_missing')
    ).toEqual([
      {
        code: 'construction_selection_field_missing',
        subject: { kind: 'declaration', id: 'constructionRuns' },
        reason: 'The declared construction selection omits constructionRuns.',
      },
    ]);
  });

  it('never claims composability while the per-trade construction owner is absent', async () => {
    const inspection = await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: declaredSelection,
      authority: { hpnPreparation: undeclaredAuthority },
    });

    expect(inspection.state).toBe('blocked');
    expect(inspection.blockerCodes).toEqual([
      'cohort_trade_construction_owner_missing',
      'construction_artifact_not_retained',
      'hpn_source_authority_missing',
    ]);

    const composition = await composeLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: declaredSelection,
      authority: { hpnPreparation: undeclaredAuthority },
    });

    expect(composition.state).toBe('blocked');
    if (composition.state !== 'blocked') throw new Error('Composition must not be complete.');
    expect(composition.blockers).toEqual(inspection.blockers);
    expect(composition).not.toHaveProperty('construction');
  });

  it('carries the named blockers into the runtime configuration failure', async () => {
    const report = await inspectLocalAflTradePrivateValuationConstruction({ pool, artifactRoot });
    const error = new AflTradeLocalPrivateValuationConfigurationError(report.blockers);

    expect(error).toMatchObject({
      name: 'AflTradeLocalPrivateValuationConfigurationError',
      code: 'MISSING_CONSTRUCTION_CONFIGURATION',
    });
    expect(error.blockerCodes).toEqual(report.blockerCodes);
    for (const code of report.blockerCodes) expect(error.message).toContain(code);
  });

  it('stops reporting an unretained reference once it is retained', async () => {
    const retain = async (reference: AflTradeArtifactRef) => {
      await pool.query(
        `INSERT INTO outcome_artifact_custody
           (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
            environment,created_at,verified_at,custody_json)
         VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,'{}')
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          reference.artifactId,
          reference.contentSha256,
          reference.storageUri,
          reference.mediaType,
          reference.byteLength,
          reference.createdAt,
        ]
      );
    };
    const references = [
      declaredSelection.valuationInputBundleConstructionSpecificationArtifact,
      declaredSelection.constructionSpecificationArtifact,
      declaredSelection.calculationInputPackage,
      declaredSelection.constructionPolicy,
    ] as const;

    const before = await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: declaredSelection,
      authority: { hpnPreparation: undeclaredAuthority },
    });
    expect(before.blockerCodes).toContain('construction_artifact_not_retained');
    expect(
      before.blockers.filter((blocker) => blocker.code === 'construction_artifact_not_retained')
    ).toHaveLength(4);

    // Custody is append-only, so this only ever adds the declared references.
    for (const reference of references) await retain(reference);
    const after = await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: declaredSelection,
      authority: { hpnPreparation: undeclaredAuthority },
    });
    expect(after.blockerCodes).not.toContain('construction_artifact_not_retained');
  });

  it('inspects without writing retained authority', async () => {
    const retainedCount = `SELECT (
         (SELECT count(*) FROM outcome_artifact_custody) +
         (SELECT count(*) FROM outcome_hpn_pav_input_set) +
         (SELECT count(*) FROM outcome_private_valuation_dispatch_request)
       )::integer AS count`;
    const before = await pool.query<{ readonly count: number }>(retainedCount);
    await inspectLocalAflTradePrivateValuationConstruction({
      pool,
      artifactRoot,
      selection: declaredSelection,
      authority: { hpnPreparation: undeclaredAuthority },
    });
    const after = await pool.query<{ readonly count: number }>(retainedCount);
    expect(after.rows).toEqual(before.rows);
  });
});
