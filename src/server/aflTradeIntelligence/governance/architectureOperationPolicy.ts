import type { AflTradeGateCode } from './gateDecisionTypes';

export const AFL_TRADE_ARCHITECTURE_OPERATION_POLICY_VERSION =
  'afl-trade-architecture-operation-policy/v1' as const;

export const AFL_TRADE_ARCHITECTURE_OPERATIONS = [
  'capture_bounded_evaluation_evidence',
  'retain_source_evidence',
  'materialize_corpus',
  'materialize_feature_dataset',
  'execute_model_run',
  'approve_model_run',
  'materialize_projection_candidate',
  'activate_publication',
  'serve_public_numerical_output',
  'transfer_authority',
  'read_legacy_trade_archive',
] as const;

export type AflTradeArchitectureOperation = (typeof AFL_TRADE_ARCHITECTURE_OPERATIONS)[number];

export interface AflTradeOperationPrerequisites {
  /** Gate decisions are necessary inputs. This policy never authorizes an operation. */
  determination: 'necessary_conditions_only';
  requiredGates: readonly AflTradeGateCode[];
  requiresOperationalAuthorization: boolean;
  requiresCurrentAuthority: boolean;
  scope: 'trade_intelligence_engine' | 'legacy_trade_archive_only';
  explanation: string;
}

const sourceAndSufficiency = [
  'gate_0a_permission_to_evaluate',
  'gate_0b_data_sufficiency',
] as const satisfies readonly AflTradeGateCode[];

const throughArchitecture = [
  ...sourceAndSufficiency,
  'gate_1_architecture_authority',
] as const satisfies readonly AflTradeGateCode[];

const throughLineage = [
  ...throughArchitecture,
  'gate_2_corpus_lineage',
] as const satisfies readonly AflTradeGateCode[];

const throughModelValidity = [
  ...throughLineage,
  'gate_3_model_validity',
] as const satisfies readonly AflTradeGateCode[];

const throughApiReadiness = [
  ...throughModelValidity,
  'gate_4_publication_api_readiness',
] as const satisfies readonly AflTradeGateCode[];

const throughPublicReadiness = [
  ...throughApiReadiness,
  'gate_5_comprehension_accessibility',
] as const satisfies readonly AflTradeGateCode[];

export const AFL_TRADE_OPERATION_PREREQUISITES = {
  capture_bounded_evaluation_evidence: {
    determination: 'necessary_conditions_only',
    requiredGates: ['gate_0a_permission_to_evaluate'],
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: false,
    scope: 'trade_intelligence_engine',
    explanation: 'Gate 0A and the source-specific authorization must permit bounded capture.',
  },
  retain_source_evidence: {
    determination: 'necessary_conditions_only',
    requiredGates: ['gate_0a_permission_to_evaluate'],
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Retention requires source rights plus the current evidence-store authority.',
  },
  materialize_corpus: {
    determination: 'necessary_conditions_only',
    requiredGates: throughArchitecture,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Corpus creation requires permitted evidence and an accepted sufficiency result.',
  },
  materialize_feature_dataset: {
    determination: 'necessary_conditions_only',
    requiredGates: throughLineage,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Feature materialization also requires the approved architecture and lineage.',
  },
  execute_model_run: {
    determination: 'necessary_conditions_only',
    requiredGates: throughLineage,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'A model run may use only governed datasets in the current analytical authority.',
  },
  approve_model_run: {
    determination: 'necessary_conditions_only',
    requiredGates: throughModelValidity,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Model approval requires all upstream gates and an effective Gate 3 decision.',
  },
  materialize_projection_candidate: {
    determination: 'necessary_conditions_only',
    requiredGates: throughModelValidity,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'A projection candidate is built from a valid model before Gate 4 reviews it.',
  },
  activate_publication: {
    determination: 'necessary_conditions_only',
    requiredGates: throughPublicReadiness,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Activation remains owned by the publication registry after Gates 4 and 5.',
  },
  serve_public_numerical_output: {
    determination: 'necessary_conditions_only',
    requiredGates: throughPublicReadiness,
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation: 'Public engine output must resolve through the current published authority.',
  },
  transfer_authority: {
    determination: 'necessary_conditions_only',
    requiredGates: ['gate_1_architecture_authority'],
    requiresOperationalAuthorization: true,
    requiresCurrentAuthority: true,
    scope: 'trade_intelligence_engine',
    explanation:
      'Gate 1 accepts a design; a separate authorized CAS transition transfers authority.',
  },
  read_legacy_trade_archive: {
    determination: 'necessary_conditions_only',
    requiredGates: [],
    requiresOperationalAuthorization: false,
    requiresCurrentAuthority: false,
    scope: 'legacy_trade_archive_only',
    explanation: 'Existing archive reads are outside the new trade-intelligence engine gate chain.',
  },
} as const satisfies Record<AflTradeArchitectureOperation, AflTradeOperationPrerequisites>;

/**
 * Returns declarative prerequisites only. Callers must resolve fresh gate decisions, source rights,
 * current authority, and operational authorization at the owning command boundary.
 */
export function getAflTradeOperationPrerequisites(
  operation: AflTradeArchitectureOperation
): AflTradeOperationPrerequisites {
  return AFL_TRADE_OPERATION_PREREQUISITES[operation];
}
