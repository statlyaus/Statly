import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_ARCHITECTURE_OPERATIONS,
  AFL_TRADE_ARCHITECTURE_OPERATION_POLICY_VERSION,
  getAflTradeOperationPrerequisites,
} from '@/server/aflTradeIntelligence/governance/architectureOperationPolicy';

describe('AFL trade-intelligence architecture operation policy', () => {
  it('is explicitly versioned and never represents an authorization decision', () => {
    expect(AFL_TRADE_ARCHITECTURE_OPERATION_POLICY_VERSION).toBe(
      'afl-trade-architecture-operation-policy/v1'
    );

    for (const operation of AFL_TRADE_ARCHITECTURE_OPERATIONS) {
      expect(getAflTradeOperationPrerequisites(operation).determination).toBe(
        'necessary_conditions_only'
      );
    }
  });

  it('does not let Gate 1 independently authorize governed engine operations', () => {
    const gate1OnlyOperations = AFL_TRADE_ARCHITECTURE_OPERATIONS.filter((operation) => {
      const prerequisites = getAflTradeOperationPrerequisites(operation);
      return (
        prerequisites.requiredGates.length === 1 &&
        prerequisites.requiredGates[0] === 'gate_1_architecture_authority'
      );
    });

    expect(gate1OnlyOperations).toEqual(['transfer_authority']);
    expect(getAflTradeOperationPrerequisites('transfer_authority')).toMatchObject({
      requiresOperationalAuthorization: true,
      requiresCurrentAuthority: true,
      determination: 'necessary_conditions_only',
    });
  });

  it('requires the complete upstream gate chain before public numerical output', () => {
    expect(getAflTradeOperationPrerequisites('serve_public_numerical_output')).toEqual({
      determination: 'necessary_conditions_only',
      requiredGates: [
        'gate_0a_permission_to_evaluate',
        'gate_0b_data_sufficiency',
        'gate_1_architecture_authority',
        'gate_2_corpus_lineage',
        'gate_3_model_validity',
        'gate_4_publication_api_readiness',
        'gate_5_comprehension_accessibility',
      ],
      requiresOperationalAuthorization: true,
      requiresCurrentAuthority: true,
      scope: 'trade_intelligence_engine',
      explanation: 'Public engine output must resolve through the current published authority.',
    });
  });

  it('requires Gates 4 and 5 for activation in addition to the upstream gates', () => {
    const activation = getAflTradeOperationPrerequisites('activate_publication');

    expect(activation.requiredGates).toEqual([
      'gate_0a_permission_to_evaluate',
      'gate_0b_data_sufficiency',
      'gate_1_architecture_authority',
      'gate_2_corpus_lineage',
      'gate_3_model_validity',
      'gate_4_publication_api_readiness',
      'gate_5_comprehension_accessibility',
    ]);
    expect(activation.requiresOperationalAuthorization).toBe(true);
    expect(activation.requiresCurrentAuthority).toBe(true);
  });

  it('requires Gate 1 before corpus writes without making Gate 4 circular for projection builds', () => {
    const corpus = getAflTradeOperationPrerequisites('materialize_corpus');
    const projection = getAflTradeOperationPrerequisites('materialize_projection_candidate');

    expect(corpus.requiredGates).toContain('gate_1_architecture_authority');
    expect(projection.requiredGates).toContain('gate_3_model_validity');
    expect(projection.requiredGates).not.toContain('gate_4_publication_api_readiness');
  });

  it('does not retroactively gate the separate legacy archive read path', () => {
    expect(getAflTradeOperationPrerequisites('read_legacy_trade_archive')).toMatchObject({
      requiredGates: [],
      requiresOperationalAuthorization: false,
      requiresCurrentAuthority: false,
      scope: 'legacy_trade_archive_only',
    });
  });
});
