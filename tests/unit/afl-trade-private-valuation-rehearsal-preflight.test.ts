import { describe, expect, it, vi } from 'vitest';

import { inspectExact2025AflPrivateValuationRehearsalPreflight } from '@/server/aflTradeIntelligence/development/localPrivateValuationRehearsalPreflight';

describe('exact 2025 AFL private valuation rehearsal preflight', () => {
  it('reports retained derived authority without treating it as genuine source admission', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows: [
        {
          private_factual_present: true,
          private_factual_revision: 2,
          qualified_model_present: true,
          qualified_model_revision: 4,
          prepared_v3_present: true,
          prepared_v3_revision: 3,
          private_batch_present: true,
          private_batch_revision: 5,
          trade_count: 12,
          ready_count: 11,
          unavailable_count: 1,
          cohort_admission_count: 1,
          cohort_trade_count: 783,
          current_registered_acquisition_spell_count: 296,
          finalized_hpn_input_set_count: 0,
          finalized_hpn_calculation_count: 0,
          max_finalized_hpn_corroborating_player_row_count: 0,
        },
      ],
    }));

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight({ query });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(['afl-men:2025-trades']);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu);
    expect(report).toEqual({
      schemaVersion: 'afl-private-valuation-rehearsal-preflight/v3',
      scopeKey: 'afl-men:2025-trades',
      competitionCode: 'AFLM',
      season: 2025,
      inspectionMode: 'read_only',
      state: 'blocked',
      authorityAssessment: 'inventory_only',
      publicationEligible: false,
      sourceAuthority: {
        genuineDraftTrade: 'not_inspected',
        genuineHpnCorroboration: 'not_inspected',
      },
      retainedSourceInventory: {
        cohortCandidates: { admissionCount: 1, tradeCount: 783 },
        measurementEvidence: {
          currentRegisteredAcquisitionSpellCount: 296,
          finalizedHpnInputSetCount: 0,
          finalizedHpnCalculationCount: 0,
          maxFinalizedHpnCorroboratingPlayerRowCount: 0,
        },
      },
      retainedAuthority: {
        privateFactualHead: { present: true, revision: 2 },
        qualifiedModelEvidence: { present: true, revision: 4 },
        preparedV3: { present: true, revision: 3 },
        exhaustivePrivateBatch: {
          present: true,
          revision: 5,
          tradeCount: 12,
          readyCount: 11,
          unavailableCount: 1,
        },
      },
      blockerCodes: ['retained_hpn_corroboration_missing'],
      limitationCodes: [
        'source_authority_authentication_not_performed',
        'retained_artifact_replay_not_performed',
        'complete_private_loop_not_executed',
      ],
    });
  });

  it('names every missing retained stage on an empty migrated database', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows: [
        {
          private_factual_present: false,
          private_factual_revision: null,
          qualified_model_present: false,
          qualified_model_revision: null,
          prepared_v3_present: false,
          prepared_v3_revision: null,
          private_batch_present: false,
          private_batch_revision: null,
          trade_count: null,
          ready_count: null,
          unavailable_count: null,
          cohort_admission_count: 0,
          cohort_trade_count: null,
          current_registered_acquisition_spell_count: 0,
          finalized_hpn_input_set_count: 0,
          finalized_hpn_calculation_count: 0,
          max_finalized_hpn_corroborating_player_row_count: 0,
        },
      ],
    }));

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight({ query });

    expect(report.retainedAuthority.exhaustivePrivateBatch).toEqual({
      present: false,
      revision: null,
      tradeCount: null,
      readyCount: null,
      unavailableCount: null,
    });
    expect(report.blockerCodes).toEqual([
      'current_private_factual_head_missing',
      'qualified_model_evidence_missing',
      'prepared_v3_head_missing',
      'exhaustive_private_batch_head_missing',
      'retained_cohort_candidate_missing',
      'retained_hpn_corroboration_missing',
    ]);
    expect(report.state).toBe('blocked');
  });

  it('blocks when retained bindings point at more than one possible cohort admission', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          private_factual_present: true,
          private_factual_revision: 2,
          qualified_model_present: true,
          qualified_model_revision: 4,
          prepared_v3_present: true,
          prepared_v3_revision: 3,
          private_batch_present: true,
          private_batch_revision: 5,
          trade_count: 12,
          ready_count: 11,
          unavailable_count: 1,
          cohort_admission_count: 2,
          cohort_trade_count: null,
          current_registered_acquisition_spell_count: 296,
          finalized_hpn_input_set_count: 1,
          finalized_hpn_calculation_count: 1,
          max_finalized_hpn_corroborating_player_row_count: 4200,
        },
      ],
    }));

    const report = await inspectExact2025AflPrivateValuationRehearsalPreflight({ query });

    expect(report.retainedSourceInventory.cohortCandidates).toEqual({
      admissionCount: 2,
      tradeCount: null,
    });
    expect(report.blockerCodes).toContain('retained_cohort_candidate_ambiguous');
    expect(report.sourceAuthority.genuineDraftTrade).toBe('not_inspected');
    expect(report.state).toBe('blocked');
  });
});
