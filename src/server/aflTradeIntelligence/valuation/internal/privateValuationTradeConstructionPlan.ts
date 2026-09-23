import {
  aflTradeArtifactRefSchema,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  aflTradeValuationInputBlockerSchema,
  type AflTradeValuationInputBlocker,
} from '../preparedValuationInputSet';

/**
 * The retained parents one current private trade construction must present, in the order the
 * materialization manifest names them. The order is part of the contract: the cohort preparer
 * compares the retained parent set against the manifest exactly, so a stable order keeps the
 * comparison honest and the failure explainable.
 */
export const PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES = [
  'input_trace',
  'calculation_input_package',
  'explanation_policy',
  'lineage_graph',
  'pick_benchmark',
  'player_observation',
] as const;

export type PrivateValuationTradeConstructionEvidenceRole =
  (typeof PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES)[number];

type RetainedParent = Readonly<{
  role: PrivateValuationTradeConstructionEvidenceRole;
  reference: AflTradeArtifactRef;
}>;

/**
 * Refusing to construct is a first-class outcome: each absent parent keeps its own blocker code and
 * subject so the operator reads which evidence is missing rather than a generic failure. The codes
 * are the existing valuation-input vocabulary, not a new one.
 */
const MISSING_EVIDENCE_BLOCKER: Readonly<
  Record<
    PrivateValuationTradeConstructionEvidenceRole,
    Readonly<{
      code: AflTradeValuationInputBlocker['code'];
      kind: AflTradeValuationInputBlocker['subject']['kind'];
    }>
  >
> = {
  input_trace: { code: 'insufficient_data', kind: 'model_component' },
  calculation_input_package: { code: 'component_output_unavailable', kind: 'model_component' },
  explanation_policy: { code: 'policy_unavailable', kind: 'policy' },
  lineage_graph: { code: 'lineage_unresolved', kind: 'lineage' },
  pick_benchmark: { code: 'insufficient_data', kind: 'pick_asset' },
  player_observation: { code: 'insufficient_data', kind: 'player_asset' },
};

export type PrivateValuationTradeConstructionPlan =
  | Readonly<{ state: 'ready'; parents: readonly RetainedParent[] }>
  | Readonly<{ state: 'blocked'; blockers: readonly AflTradeValuationInputBlocker[] }>;

/**
 * Decides whether one cohort member can be constructed from the evidence that was actually
 * inspected. Pure and fail-closed: it composes no value, infers no parent, and never substitutes a
 * fixture for retained evidence, so a caller can ask "can this trade be constructed?" before it
 * touches the private prepared-v3 transaction.
 */
export function planPrivateValuationTradeConstruction(input: {
  readonly tradeId: string;
  readonly sealedCohortTradeIds: readonly string[];
  readonly resolved: readonly RetainedParent[];
  readonly inspectedEvidenceRefs: readonly AflTradeArtifactRef[];
}): PrivateValuationTradeConstructionPlan {
  // A blocker must cite the evidence that was inspected, so an empty citation set is a caller
  // defect rather than a trade that cannot be constructed.
  const inspected = input.inspectedEvidenceRefs.map((reference) =>
    aflTradeArtifactRefSchema.parse(reference)
  );
  if (inspected.length === 0 || inspected.length > 20) {
    throw new TypeError(
      'Trade construction planning requires between one and twenty inspected evidence references.'
    );
  }
  if (!input.sealedCohortTradeIds.includes(input.tradeId)) {
    return {
      state: 'blocked',
      blockers: [
        aflTradeValuationInputBlockerSchema.parse({
          code: 'unsupported_trade',
          subject: { kind: 'trade', id: input.tradeId },
          evidenceRefs: inspected,
        }),
      ],
    };
  }
  const resolved = new Map<PrivateValuationTradeConstructionEvidenceRole, AflTradeArtifactRef>();
  for (const parent of input.resolved) {
    const reference = aflTradeArtifactRefSchema.parse(parent.reference);
    const existing = resolved.get(parent.role);
    if (existing !== undefined && existing.artifactId !== reference.artifactId) {
      throw new TypeError(
        `Trade construction resolved ${parent.role} to more than one retained reference.`
      );
    }
    resolved.set(parent.role, existing ?? reference);
  }
  const parents: RetainedParent[] = [];
  const blockers: AflTradeValuationInputBlocker[] = [];
  for (const role of PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES) {
    const reference = resolved.get(role);
    if (reference === undefined) {
      blockers.push(
        aflTradeValuationInputBlockerSchema.parse({
          code: MISSING_EVIDENCE_BLOCKER[role].code,
          subject: { kind: MISSING_EVIDENCE_BLOCKER[role].kind, id: role },
          evidenceRefs: inspected,
        })
      );
      continue;
    }
    parents.push({ role, reference });
  }
  return blockers.length > 0 ? { state: 'blocked', blockers } : { state: 'ready', parents };
}
