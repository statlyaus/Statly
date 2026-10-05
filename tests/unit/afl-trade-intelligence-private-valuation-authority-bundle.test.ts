// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationAuthorityBundleRegistry } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationAuthorityBundleRegistry';
import {
  aflTradePrivateValuationAuthorityBundleSchema,
  createAflTradePrivateValuationAuthorityBundle,
} from '@/server/aflTradeIntelligence/valuation/privateValuationAuthorityBundle';
import {
  aflTradePrivateValuationAuthorityBundleV3Schema,
  createAflTradePrivateValuationAuthorityBundleV3,
} from '@/server/aflTradeIntelligence/valuation/privateValuationAuthorityBundleV3';

const digest = (character: string) => character.repeat(64);
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;
const artifact = (name: string) =>
  createAflTradeCanonicalJsonArtifactRef({ name }, '2026-08-18T01:00:00.000Z');

function createBundle(
  overrides: Partial<Parameters<typeof createAflTradePrivateValuationAuthorityBundle>[0]> = {}
) {
  return createAflTradePrivateValuationAuthorityBundle({
    valuationScopeKey: 'aflm-private-trade-v2',
    transactionEffectiveAt: '2025-10-15T00:00:00.000Z',
    currentValuationAsOf: '2026-08-18T00:00:00.000Z',
    createdAt: '2026-08-18T02:00:00.000Z',
    valueUnitId: 'fixed_horizon_pav',
    hpnPavMethodId: id('hpn-pav-method', 'c'),
    atTrade: {
      player: {
        runId: id('model-run', '1'),
        protocolId: id('model-protocol', '2'),
        datasetId: id('dataset', '3'),
        datasetAdmissionId: id('dataset-admission', '4'),
        observationSetId: id('player-observation-set', '5'),
        knowledgeCutoffAt: '2025-10-14T23:59:59.999Z',
        gate3DecisionId: id('gate-decision', '6'),
      },
      pick: {
        candidateId: id('pick-pav-model-candidate', '7'),
        observationSetId: id('pick-pav-observation-set', '8'),
        observationAdmissionId: id('pick-pav-observation-admission', '9'),
        policyId: id('pick-pav-policy', 'a'),
        knowledgeCutoffAt: '2025-10-14T23:59:59.999Z',
        gate3DecisionId: id('gate-decision', 'b'),
      },
    },
    currentRemaining: {
      player: {
        runId: id('model-run', 'd'),
        protocolId: id('model-protocol', 'e'),
        datasetId: id('dataset', 'f'),
        datasetAdmissionId: id('dataset-admission', '0'),
        observationSetId: id('player-observation-set', 'a'),
        knowledgeCutoffAt: '2026-08-18T00:00:00.000Z',
        gate3DecisionId: id('gate-decision', '1'),
      },
      pick: {
        candidateId: id('pick-pav-model-candidate', '2'),
        observationSetId: id('pick-pav-observation-set', '3'),
        observationAdmissionId: id('pick-pav-observation-admission', '4'),
        policyId: id('pick-pav-policy', '5'),
        knowledgeCutoffAt: '2026-08-18T00:00:00.000Z',
        gate3DecisionId: id('gate-decision', '7'),
      },
    },
    authorityReuse: {
      player: 'distinct_authorities',
      pick: 'distinct_authorities',
    },
    componentCompatibilityArtifact: artifact('component-compatibility'),
    jointSimulationProtocolArtifact: artifact('joint-simulation'),
    gradePolicyArtifact: artifact('grade-policy'),
    ...overrides,
  });
}

function createBundleV3(
  overrides: Partial<
    Parameters<typeof createAflTradePrivateValuationAuthorityBundleV3>[0]
  > = {}
) {
  const legacy = createBundle();
  return createAflTradePrivateValuationAuthorityBundleV3({
    valuationScopeKey: 'aflm-private-trade-v3',
    transactionEffectiveAt: legacy.content.transactionEffectiveAt,
    currentValuationAsOf: legacy.content.currentValuationAsOf,
    createdAt: legacy.content.createdAt,
    valueUnitId: legacy.content.valueUnitId,
    hpnPavMethodId: legacy.content.hpnPavMethodId,
    evaluatedTrade: {
      factualReleaseId: id('outcome-release', '1'),
      factualCandidateId: id('factual-release-candidate', '2'),
      sourceQualificationReportId: id('valuation-source-qualification', '3'),
      privateEvaluationDecisionId: id('private-valuation-evaluation-decision', '4'),
      transactionEventVersionId: 'event-version:trade-2025',
      canonicalMemberSetSha256: digest('5'),
      assetVersionIds: ['asset-version:one', 'asset-version:two'],
    },
    evaluationEvidence: {
      evidenceBundleId: id('valuation-evidence-bundle', '6'),
      factualReleaseId: id('outcome-release', '7'),
      factualCandidateId: id('factual-release-candidate', '8'),
      corpusToCandidateLineageId: id('corpus-factual-lineage', '9'),
      sourceQualificationReportId: id('valuation-source-qualification', 'a'),
      privateEvaluationDecisionId: id('private-valuation-evaluation-decision', 'b'),
      knowledgeCutoffAt: '2026-08-18T00:00:00.000Z',
      memberSetSha256: digest('c'),
      tradeCorrespondenceArtifact: artifact('trade-evidence-correspondence'),
      gate3DecisionId: id('gate-decision', 'd'),
    },
    atTrade: legacy.content.modelAuthorities.atTrade,
    currentRemaining: legacy.content.modelAuthorities.currentRemaining,
    authorityReuse: legacy.content.authorityReuse,
    componentCompatibilityArtifact: legacy.content.componentCompatibilityArtifact,
    jointSimulationProtocolArtifact: legacy.content.jointSimulationProtocolArtifact,
    gradePolicyArtifact: legacy.content.gradePolicyArtifact,
    ...overrides,
  });
}

class BundleSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  bundleJson: unknown = null;

  constructor(
    private readonly parents: {
      player: boolean;
      pick: boolean;
    } = { player: true, pick: true }
  ) {}

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM outcome_valuation_model_run')) {
      return {
        rows: (this.parents.player
          ? [
              {
                run_id: parameters[0],
                status: 'succeeded',
                environment: 'non_production',
                protocol_id: id('model-protocol', '2'),
                dataset_id: id('dataset', '3'),
                dataset_admission_id: id('dataset-admission', '4'),
                observation_set_id: id('player-observation-set', '5'),
              },
            ]
          : []) as Row[],
        rowCount: this.parents.player ? 1 : 0,
      };
    }
    if (sql.includes('FROM outcome_governed_pick_pav_model_candidate')) {
      return {
        rows: (this.parents.pick
          ? [
              {
                candidate_id: parameters[0],
                observation_set_id: id('pick-pav-observation-set', '8'),
                observation_admission_id: id('pick-pav-observation-admission', '9'),
                policy_id: id('pick-pav-policy', 'a'),
                consumption_state: 'consumed',
              },
            ]
          : []) as Row[],
        rowCount: this.parents.pick ? 1 : 0,
      };
    }
    if (sql.startsWith('INSERT INTO outcome_private_valuation_authority_bundle')) {
      this.bundleJson = JSON.parse(String(parameters[9]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT bundle_json')) {
      return {
        rows: (this.bundleJson === null ? [] : [{ bundle_json: this.bundleJson }]) as Row[],
        rowCount: this.bundleJson === null ? 0 : 1,
      };
    }
    throw new Error(`Unexpected bundle registry SQL: ${sql}`);
  }
}

describe('private valuation authority bundle', () => {
  it('separates evaluated-trade, evaluation-evidence, and model-training authority roots', () => {
    const bundle = createBundleV3();

    expect(bundle.content.schemaVersion).toBe('afl-trade-private-valuation-authority-bundle/v3');
    expect(bundle.content.evaluatedTrade.factualReleaseId).not.toBe(
      bundle.content.evaluationEvidence.factualReleaseId
    );
    expect(bundle.content.evaluationEvidence.factualReleaseId).not.toBe(
      bundle.content.modelAuthorities.atTrade.player.datasetId
    );
    expect(bundle.content.authorityRoles).toEqual({
      evaluatedTrade: 'canonical_transaction_and_root_assets',
      evaluationEvidence: 'realized_lineage_horizons_and_remaining_state',
      modelTraining: 'component_owned_independent_ancestry',
    });
    expect(aflTradePrivateValuationAuthorityBundleV3Schema.parse(bundle)).toEqual(bundle);
  });

  it('rejects missing asset correspondence, future evaluation evidence, and shared Gate 3 authority', () => {
    expect(() =>
      createBundleV3({
        evaluatedTrade: {
          ...createBundleV3().content.evaluatedTrade,
          assetVersionIds: [],
        },
      })
    ).toThrow();

    expect(() =>
      createBundleV3({
        evaluationEvidence: {
          ...createBundleV3().content.evaluationEvidence,
          knowledgeCutoffAt: '2026-08-18T00:00:00.001Z',
        },
      })
    ).toThrow(/evaluation evidence.*cutoff/i);

    const baseline = createBundleV3();
    expect(() =>
      createBundleV3({
        evaluationEvidence: {
          ...baseline.content.evaluationEvidence,
          gate3DecisionId:
            baseline.content.modelAuthorities.currentRemaining.player.gate3DecisionId,
        },
      })
    ).toThrow(/distinct Gate 3/i);

    expect(() =>
      createBundleV3({
        atTrade: {
          ...baseline.content.modelAuthorities.atTrade,
          player: {
            ...baseline.content.modelAuthorities.atTrade.player,
            knowledgeCutoffAt: '2025-10-15T00:00:00.001Z',
          },
        },
      })
    ).toThrow(/at-trade.*knowledge cutoff/i);

    expect(() =>
      createBundleV3({
        currentRemaining: {
          ...baseline.content.modelAuthorities.currentRemaining,
          player: baseline.content.modelAuthorities.atTrade.player,
        },
      })
    ).toThrow(/reuse declaration/i);
  });

  it('keeps v2 readable but outside the v3 governed execution contract', () => {
    const historical = createBundle();

    expect(aflTradePrivateValuationAuthorityBundleSchema.parse(historical)).toEqual(historical);
    expect(() => aflTradePrivateValuationAuthorityBundleV3Schema.parse(historical)).toThrow();
  });

  it('pins role-specific candidates and fixed fail-closed calculation rules', () => {
    const bundle = createBundle();

    expect(bundle.content.environment).toBe('non_production');
    expect(bundle.content.publicationEligible).toBe(false);
    expect(bundle.content.modelAuthorities.atTrade.player.candidateKind).toBe(
      'player_model_run_v3'
    );
    expect(bundle.content.modelAuthorities.currentRemaining.pick.candidateKind).toBe(
      'pick_pav_model_candidate_v1'
    );
    expect(bundle.content.modelAuthorities.atTrade.modelVintage).toBe(
      'historical_restatement'
    );
    expect(bundle.content.authorityReuse).toEqual({
      player: 'distinct_authorities',
      pick: 'distinct_authorities',
    });
    expect(bundle.content.calculationPolicy).toMatchObject({
      views: ['at_trade', 'realized', 'remaining', 'current'],
      playerHorizons: 'derive_all_completed_seasons_and_current_horizon_from_acquisition_spell',
      missingValues: 'unavailable_never_zero',
      pickCustody: 'stable_asset_identity_with_separate_custody_and_transformation_lineage',
      pickAttribution: 'conserved_frontier_exactly_once',
      gradeAvailability: 'only_when_every_asset_and_party_total_is_complete_and_balanced',
    });
    expect(bundle.content.gate3Authority).toBe('requires_exact_current_component_and_bundle_decisions');
    expect(aflTradePrivateValuationAuthorityBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it('rejects a shared decision across distinct components and invalid chronology', () => {
    expect(() =>
      createBundle({
        atTrade: {
          player: {
            runId: id('model-run', '1'),
            protocolId: id('model-protocol', '2'),
            datasetId: id('dataset', '3'),
            datasetAdmissionId: id('dataset-admission', '4'),
            observationSetId: id('player-observation-set', '5'),
            knowledgeCutoffAt: '2025-10-14T23:59:59.999Z',
            gate3DecisionId: id('gate-decision', '6'),
          },
          pick: {
            candidateId: id('pick-pav-model-candidate', '7'),
            observationSetId: id('pick-pav-observation-set', '8'),
            observationAdmissionId: id('pick-pav-observation-admission', '9'),
            policyId: id('pick-pav-policy', 'a'),
            knowledgeCutoffAt: '2025-10-14T23:59:59.999Z',
            gate3DecisionId: id('gate-decision', '6'),
          },
        },
      })
    ).toThrow(/distinct Gate 3/i);

    expect(() =>
      createBundle({
        currentValuationAsOf: '2026-08-18T03:00:00.000Z',
      })
    ).toThrow(/valuation as-of/i);
  });

  it('rejects future knowledge in the at-trade model authorities', () => {
    const baseline = createBundle();
    expect(() =>
      createBundle({
        atTrade: {
          player: {
            ...baseline.content.modelAuthorities.atTrade.player,
            knowledgeCutoffAt: '2025-10-15T00:00:00.001Z',
          },
          pick: baseline.content.modelAuthorities.atTrade.pick,
        },
      })
    ).toThrow(/at-trade.*knowledge cutoff/i);
  });

  it('allows exact component reuse only when declared and safe for both contexts', () => {
    const baseline = createBundle();
    expect(() =>
      createBundle({
        currentRemaining: {
          player: baseline.content.modelAuthorities.atTrade.player,
          pick: baseline.content.modelAuthorities.currentRemaining.pick,
        },
      })
    ).toThrow(/reuse declaration/i);

    const reused = createBundle({
      currentRemaining: {
        player: baseline.content.modelAuthorities.atTrade.player,
        pick: baseline.content.modelAuthorities.currentRemaining.pick,
      },
      authorityReuse: {
        player: 'same_authority_cutoff_safe_for_both',
        pick: 'distinct_authorities',
      },
    });
    expect(reused.content.authorityReuse.player).toBe(
      'same_authority_cutoff_safe_for_both'
    );
  });

  it('rejects substituted candidate prefixes and post-address mutation', () => {
    expect(() =>
      createBundle({
        atTrade: {
          player: createBundle().content.modelAuthorities.atTrade.player,
          pick: {
            candidateId: id('model-run', '7'),
            observationSetId: id('pick-pav-observation-set', '8'),
            observationAdmissionId: id('pick-pav-observation-admission', '9'),
            policyId: id('pick-pav-policy', 'a'),
            knowledgeCutoffAt: '2025-10-14T23:59:59.999Z',
            gate3DecisionId: id('gate-decision', 'b'),
          },
        },
      })
    ).toThrow();

    const mutated = structuredClone(createBundle());
    mutated.content.valueUnitId = 'different_unit';
    expect(() => aflTradePrivateValuationAuthorityBundleSchema.parse(mutated)).toThrow(
      /content address/i
    );
  });

  it('rejects a bundle when its governed player component parent is unavailable', async () => {
    const bundle = createBundle();
    await expect(
      new PostgresAflTradePrivateValuationAuthorityBundleRegistry(
        new BundleSql({ player: false, pick: true })
      ).persist(bundle)
    ).rejects.toThrow(/player model run/i);
  });
});
