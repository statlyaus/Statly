import {
  aflTradeArtifactRefSchema,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  aflTradeValuationInputBlockerSchema,
  type AflTradeValuationInputBlocker,
} from '../preparedValuationInputSet';

/**
 * The retained documents a caller must supply for one trade, in the order the materialization
 * manifest names them.
 *
 * These are the parents whose reference has to exist *before* the manifest does: the packager
 * re-reads them from the bytes the caller retained, so it cannot produce them itself.
 */
export const PRIVATE_VALUATION_TRADE_CONSTRUCTION_SUPPLIED_ROLES = [
  'input_trace',
  'explanation_policy',
  'lineage_graph',
  'pick_benchmark',
  'player_observation',
] as const;

export type PrivateValuationTradeConstructionSuppliedRole =
  (typeof PRIVATE_VALUATION_TRADE_CONSTRUCTION_SUPPLIED_ROLES)[number];

/**
 * The documents the packager derives for one trade. They have no reference to supply: the packager
 * builds them, content-addresses them, and returns them as retained parents. A caller reports only
 * whether it could resolve each one.
 */
export const PRIVATE_VALUATION_TRADE_CONSTRUCTION_DERIVED_INPUTS = [
  'valuation_case',
  'component_draw_set',
  'realized_contribution_ledger',
  'package_policy',
] as const;

export type PrivateValuationTradeConstructionDerivedInput =
  (typeof PRIVATE_VALUATION_TRADE_CONSTRUCTION_DERIVED_INPUTS)[number];

/**
 * Authority the caller has to have selected before construction, which is not a document it can
 * retain: the factual release and bundle identity the trade is being valued under, and the exact two
 * component runs drawn from that release's admitted evidence.
 */
export const PRIVATE_VALUATION_TRADE_CONSTRUCTION_BINDINGS = [
  'release_binding',
  'selected_component_authority',
] as const;

export type PrivateValuationTradeConstructionBinding =
  (typeof PRIVATE_VALUATION_TRADE_CONSTRUCTION_BINDINGS)[number];

type BlockerShape = Readonly<{
  code: AflTradeValuationInputBlocker['code'];
  kind: AflTradeValuationInputBlocker['subject']['kind'];
}>;

/** Refusing to construct is a first-class outcome, so every absence keeps its own code and subject. */
const MISSING_DOCUMENT_BLOCKER: Readonly<
  Record<PrivateValuationTradeConstructionSuppliedRole, BlockerShape>
> = {
  input_trace: { code: 'insufficient_data', kind: 'model_component' },
  explanation_policy: { code: 'policy_unavailable', kind: 'policy' },
  lineage_graph: { code: 'lineage_unresolved', kind: 'lineage' },
  pick_benchmark: { code: 'insufficient_data', kind: 'pick_asset' },
  player_observation: { code: 'insufficient_data', kind: 'player_asset' },
};

const MISSING_DERIVED_INPUT_BLOCKER: Readonly<
  Record<PrivateValuationTradeConstructionDerivedInput, BlockerShape>
> = {
  valuation_case: { code: 'insufficient_data', kind: 'model_component' },
  component_draw_set: { code: 'component_output_unavailable', kind: 'model_component' },
  realized_contribution_ledger: { code: 'insufficient_data', kind: 'model_component' },
  package_policy: { code: 'policy_unavailable', kind: 'policy' },
};

const MISSING_BINDING_BLOCKER: Readonly<
  Record<PrivateValuationTradeConstructionBinding, BlockerShape>
> = {
  release_binding: { code: 'insufficient_data', kind: 'source' },
  selected_component_authority: { code: 'model_not_approved', kind: 'model_component' },
};

export type PrivateValuationTradeConstructionPlan =
  | Readonly<{
      state: 'ready';
      parents: readonly Readonly<{
        role: PrivateValuationTradeConstructionSuppliedRole;
        reference: AflTradeArtifactRef;
      }>[];
    }>
  | Readonly<{ state: 'blocked'; blockers: readonly AflTradeValuationInputBlocker[] }>;

/**
 * Decides whether one cohort member can be constructed from the evidence actually inspected. Pure and
 * fail-closed: it composes no value, infers no document, and never substitutes a fixture for retained
 * evidence, so a caller can ask "can this trade be constructed?" before it opens the private
 * prepared-v3 transaction.
 */
export function planPrivateValuationTradeConstruction(input: {
  readonly tradeId: string;
  readonly sealedCohortTradeIds: readonly string[];
  readonly supplied: readonly Readonly<{
    role: PrivateValuationTradeConstructionSuppliedRole;
    reference: AflTradeArtifactRef;
  }>[];
  readonly derived: readonly PrivateValuationTradeConstructionDerivedInput[];
  readonly bindings: readonly PrivateValuationTradeConstructionBinding[];
  readonly inspectedEvidenceRefs: readonly AflTradeArtifactRef[];
}): PrivateValuationTradeConstructionPlan {
  // A blocker must cite the evidence that was inspected, so an empty citation set is a caller defect
  // rather than a trade that cannot be constructed.
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
  const supplied = new Map<PrivateValuationTradeConstructionSuppliedRole, AflTradeArtifactRef>();
  for (const parent of input.supplied) {
    const reference = aflTradeArtifactRefSchema.parse(parent.reference);
    const existing = supplied.get(parent.role);
    if (existing !== undefined && existing.artifactId !== reference.artifactId) {
      throw new TypeError(
        `Trade construction resolved ${parent.role} to more than one retained reference.`
      );
    }
    supplied.set(parent.role, existing ?? reference);
  }
  const derived = new Set(input.derived);
  const blockers: AflTradeValuationInputBlocker[] = [];
  const parents: {
    role: PrivateValuationTradeConstructionSuppliedRole;
    reference: AflTradeArtifactRef;
  }[] = [];
  for (const role of PRIVATE_VALUATION_TRADE_CONSTRUCTION_SUPPLIED_ROLES) {
    const reference = supplied.get(role);
    if (reference === undefined) {
      blockers.push(
        aflTradeValuationInputBlockerSchema.parse({
          code: MISSING_DOCUMENT_BLOCKER[role].code,
          subject: { kind: MISSING_DOCUMENT_BLOCKER[role].kind, id: role },
          evidenceRefs: inspected,
        })
      );
      continue;
    }
    parents.push({ role, reference });
  }
  for (const descriptor of PRIVATE_VALUATION_TRADE_CONSTRUCTION_DERIVED_INPUTS) {
    if (derived.has(descriptor)) continue;
    blockers.push(
      aflTradeValuationInputBlockerSchema.parse({
        code: MISSING_DERIVED_INPUT_BLOCKER[descriptor].code,
        subject: { kind: MISSING_DERIVED_INPUT_BLOCKER[descriptor].kind, id: descriptor },
        evidenceRefs: inspected,
      })
    );
  }
  for (const binding of PRIVATE_VALUATION_TRADE_CONSTRUCTION_BINDINGS) {
    if (input.bindings.includes(binding)) continue;
    blockers.push(
      aflTradeValuationInputBlockerSchema.parse({
        code: MISSING_BINDING_BLOCKER[binding].code,
        subject: { kind: MISSING_BINDING_BLOCKER[binding].kind, id: binding },
        evidenceRefs: inspected,
      })
    );
  }
  return blockers.length > 0 ? { state: 'blocked', blockers } : { state: 'ready', parents };
}
