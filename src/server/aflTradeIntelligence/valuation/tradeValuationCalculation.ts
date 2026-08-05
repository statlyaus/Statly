import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeComponentDrawSetSchema, type AflTradeComponentDrawSet } from './componentDrawSet';
import { aflTradePackagePolicySchema, type AflTradePackagePolicy } from './packagePolicy';
import {
  aflTradeRealizedContributionLedgerSchema,
  type AflTradeRealizedContributionLedger,
} from './realizedContributionLedger';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

const FLOAT_TOLERANCE = 1e-8;
const finiteNumberSchema = z.number().finite();

const universalLayersSchema = z
  .object({
    gross: finiteNumberSchema,
    listSpotAdjusted: finiteNumberSchema,
    scarcityAdjusted: finiteNumberSchema,
  })
  .strict();

const availableUniversalValueSchema = z
  .object({
    status: z.literal('available'),
    layers: universalLayersSchema,
  })
  .strict();

const unavailableUniversalValueSchema = z
  .object({
    status: z.literal('unavailable'),
    partialLayers: universalLayersSchema,
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

const universalValueSchema = z.discriminatedUnion('status', [
  availableUniversalValueSchema,
  unavailableUniversalValueSchema,
]);

const availableClubUtilitySchema = z
  .object({ status: z.literal('available'), value: finiteNumberSchema })
  .strict();
const unavailableClubUtilitySchema = z
  .object({
    status: z.literal('unavailable'),
    partialValue: finiteNumberSchema.nullable(),
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();
const clubUtilityValueSchema = z.discriminatedUnion('status', [
  availableClubUtilitySchema,
  unavailableClubUtilitySchema,
]);

const realizedEvidenceSchema = z
  .object({
    observedRecordCount: z.number().int().nonnegative(),
    unavailableRecordCount: z.number().int().nonnegative(),
    state: z.enum(['observed_only', 'partially_unavailable', 'unavailable_only', 'no_records']),
  })
  .strict();

const rootValueSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    forecastSupport: z.enum(['supported', 'excluded']),
    universal: universalValueSchema,
    clubUtility: clubUtilityValueSchema,
    realizedEvidence: realizedEvidenceSchema,
  })
  .strict();

const partyViewSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    roots: z.array(rootValueSchema).min(1).max(100),
    universal: universalValueSchema,
    clubUtility: clubUtilityValueSchema,
  })
  .strict();

const partyDrawSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    views: z.array(partyViewSchema).length(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict();

const calculationDrawSchema = z
  .object({
    drawIndex: z.number().int().nonnegative().max(99_999),
    drawKey: aflTradePublicIdSchema,
    probabilityWeight: finiteNumberSchema.positive().max(1),
    parties: z.array(partyDrawSchema).min(2).max(18),
  })
  .strict();

const calculationExecutionSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('exact_joint_mixture'),
      samplingAlgorithmVersion: z.null(),
      seed: z.null(),
      monteCarloError: z.literal('zero_exact_enumeration'),
    })
    .strict(),
  z
    .object({
      mode: z.literal('deterministic_counter_sample'),
      samplingAlgorithmVersion: z.literal('counter_sha256_rejection_v1'),
      seed: aflTradePublicIdSchema,
      monteCarloError: z.literal('requires_downstream_reporting'),
    })
    .strict(),
]);

function valueLayers(value: z.infer<typeof universalValueSchema>) {
  return value.status === 'available' ? value.layers : value.partialLayers;
}

function clubUtilityPartial(value: z.infer<typeof clubUtilityValueSchema>): number | null {
  return value.status === 'available' ? value.value : value.partialValue;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= FLOAT_TOLERANCE;
}

function addLayers(
  left: z.infer<typeof universalLayersSchema>,
  right: z.infer<typeof universalLayersSchema>
) {
  return {
    gross: left.gross + right.gross,
    listSpotAdjusted: left.listSpotAdjusted + right.listSpotAdjusted,
    scarcityAdjusted: left.scarcityAdjusted + right.scarcityAdjusted,
  };
}

function layersEqual(
  left: z.infer<typeof universalLayersSchema>,
  right: z.infer<typeof universalLayersSchema>
): boolean {
  return (
    approximatelyEqual(left.gross, right.gross) &&
    approximatelyEqual(left.listSpotAdjusted, right.listSpotAdjusted) &&
    approximatelyEqual(left.scarcityAdjusted, right.scarcityAdjusted)
  );
}

export const aflTradeValuationCalculationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-calculation/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    valueUnitId: aflTradePublicIdSchema,
    execution: calculationExecutionSchema,
    realizedPolicyTreatment: z.literal(
      'measured_contribution_is_not_rewritten_by_list_spot_scarcity_or_club_utility_policy'
    ),
    currentOutcomeIdentity: z.literal('realized_plus_remaining_per_root_draw_club_and_layer'),
    missingnessTreatment: z.literal(
      'unavailable_inputs_propagate_with_partial_values_never_coerced_to_zero'
    ),
    draws: z.array(calculationDrawSchema).min(1).max(100_000),
    limitation: z.literal(
      'Deterministic source-independent calculation only; output is not source approval, model calibration, Gate approval, or publication readiness.'
    ),
  })
  .strict()
  .superRefine((calculation, context) => {
    const drawKeys = calculation.draws.map((draw) => draw.drawKey);
    const probabilityMass = calculation.draws.reduce(
      (sum, draw) => sum + draw.probabilityWeight,
      0
    );
    if (
      new Set(drawKeys).size !== drawKeys.length ||
      calculation.draws.some((draw, index) => draw.drawIndex !== index) ||
      !approximatelyEqual(probabilityMass, 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draws'],
        message: 'Calculation draws require unique keys, contiguous indices, and unit probability.',
      });
    }

    for (const [drawIndex, draw] of calculation.draws.entries()) {
      const clubIds = draw.parties.map((party) => party.aflClubId);
      if (
        new Set(clubIds).size !== clubIds.length ||
        clubIds.some((clubId, index) => clubId !== [...clubIds].sort()[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['draws', drawIndex, 'parties'],
          message: 'Calculation parties must use unique AFL clubs in canonical order.',
        });
      }
      for (const [partyIndex, party] of draw.parties.entries()) {
        if (party.views.some((view, index) => view.view !== AFL_TRADE_VALUATION_VIEWS[index])) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views'],
            message: 'Party results must contain each valuation view in canonical order.',
          });
          continue;
        }
        for (const [viewIndex, view] of party.views.entries()) {
          const assetIds = view.roots.map((root) => root.assetId);
          if (
            new Set(assetIds).size !== assetIds.length ||
            assetIds.some((assetId, index) => assetId !== [...assetIds].sort()[index])
          ) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', viewIndex, 'roots'],
              message: 'Party roots must use unique asset identities in canonical order.',
            });
          }
          const expectedLayers = view.roots.reduce(
            (sum, root) => addLayers(sum, valueLayers(root.universal)),
            { gross: 0, listSpotAdjusted: 0, scarcityAdjusted: 0 }
          );
          if (!layersEqual(valueLayers(view.universal), expectedLayers)) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', viewIndex, 'universal'],
              message: 'Party universal values must reconcile exactly to traded roots.',
            });
          }
          if (
            (view.universal.status === 'available') !==
            view.roots.every((root) => root.universal.status === 'available')
          ) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', viewIndex, 'universal'],
              message: 'Party universal availability must propagate from every traded root.',
            });
          }
          const rootUtilityValues = view.roots.map((root) => clubUtilityPartial(root.clubUtility));
          const partyUtilityValue = clubUtilityPartial(view.clubUtility);
          if (
            partyUtilityValue !== null &&
            rootUtilityValues.every((value): value is number => value !== null) &&
            !approximatelyEqual(
              partyUtilityValue,
              rootUtilityValues.reduce((sum, value) => sum + value, 0)
            )
          ) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', viewIndex, 'clubUtility'],
              message: 'Party club utility must reconcile exactly to traded roots.',
            });
          }
          if (
            (view.clubUtility.status === 'available') !==
            view.roots.every((root) => root.clubUtility.status === 'available')
          ) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', viewIndex, 'clubUtility'],
              message: 'Party club-utility availability must propagate from every traded root.',
            });
          }
        }

        const realized = party.views[1];
        const remaining = party.views[2];
        const current = party.views[3];
        const expectedRootIds = party.views[0].roots.map((root) => root.assetId);
        if (
          party.views.some((view) =>
            view.roots.some(
              (root, index) =>
                root.assetId !== expectedRootIds[index] ||
                root.forecastSupport !== party.views[0].roots[index].forecastSupport ||
                JSON.stringify(root.realizedEvidence) !==
                  JSON.stringify(party.views[0].roots[index].realizedEvidence)
            )
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views'],
            message: 'Root identity, support, and realized evidence must be stable across views.',
          });
        }
        if (
          !layersEqual(
            valueLayers(current.universal),
            addLayers(valueLayers(realized.universal), valueLayers(remaining.universal))
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views', 3, 'universal'],
            message: 'Current universal value must equal realized plus remaining value.',
          });
        }
        if (
          (current.universal.status === 'available') !==
          (realized.universal.status === 'available' && remaining.universal.status === 'available')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views', 3, 'universal'],
            message: 'Current universal availability must propagate from realized and remaining.',
          });
        }
        for (const [rootIndex, currentRoot] of current.roots.entries()) {
          if (
            !layersEqual(
              valueLayers(currentRoot.universal),
              addLayers(
                valueLayers(realized.roots[rootIndex].universal),
                valueLayers(remaining.roots[rootIndex].universal)
              )
            )
          ) {
            context.addIssue({
              code: 'custom',
              path: ['draws', drawIndex, 'parties', partyIndex, 'views', 3, 'roots', rootIndex],
              message: 'Current root value must equal realized plus remaining value.',
            });
          }
          const realizedRoot = realized.roots[rootIndex];
          const remainingRoot = remaining.roots[rootIndex];
          if (
            (currentRoot.universal.status === 'available') !==
            (realizedRoot.universal.status === 'available' &&
              remainingRoot.universal.status === 'available')
          ) {
            context.addIssue({
              code: 'custom',
              path: [
                'draws',
                drawIndex,
                'parties',
                partyIndex,
                'views',
                3,
                'roots',
                rootIndex,
                'universal',
              ],
              message: 'Current root availability must propagate from realized and remaining.',
            });
          }
          const realizedRootUtility = clubUtilityPartial(realizedRoot.clubUtility);
          const remainingRootUtility = clubUtilityPartial(remainingRoot.clubUtility);
          const currentRootUtility = clubUtilityPartial(currentRoot.clubUtility);
          if (
            realizedRootUtility !== null &&
            remainingRootUtility !== null &&
            currentRootUtility !== null &&
            !approximatelyEqual(currentRootUtility, realizedRootUtility + remainingRootUtility)
          ) {
            context.addIssue({
              code: 'custom',
              path: [
                'draws',
                drawIndex,
                'parties',
                partyIndex,
                'views',
                3,
                'roots',
                rootIndex,
                'clubUtility',
              ],
              message: 'Current root club utility must equal realized plus remaining utility.',
            });
          }
          if (
            (currentRoot.clubUtility.status === 'available') !==
            (realizedRoot.clubUtility.status === 'available' &&
              remainingRoot.clubUtility.status === 'available')
          ) {
            context.addIssue({
              code: 'custom',
              path: [
                'draws',
                drawIndex,
                'parties',
                partyIndex,
                'views',
                3,
                'roots',
                rootIndex,
                'clubUtility',
              ],
              message: 'Current root utility availability must propagate from both inputs.',
            });
          }
        }
        const realizedUtility = clubUtilityPartial(realized.clubUtility);
        const remainingUtility = clubUtilityPartial(remaining.clubUtility);
        const currentUtility = clubUtilityPartial(current.clubUtility);
        if (
          realizedUtility !== null &&
          remainingUtility !== null &&
          currentUtility !== null &&
          !approximatelyEqual(currentUtility, realizedUtility + remainingUtility)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views', 3, 'clubUtility'],
            message: 'Current club utility must equal realized plus remaining club utility.',
          });
        }
        if (
          (current.clubUtility.status === 'available') !==
          (realized.clubUtility.status === 'available' &&
            remaining.clubUtility.status === 'available')
        ) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'parties', partyIndex, 'views', 3, 'clubUtility'],
            message:
              'Current club-utility availability must propagate from realized and remaining.',
          });
        }
      }
    }
  });

export const aflTradeValuationCalculationSchema = z
  .object({
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    content: aflTradeValuationCalculationContentSchema,
  })
  .strict()
  .superRefine((calculation, context) => {
    addAflTradeContentAddressIssue(
      'valuation-calculation',
      calculation.valuationCalculationId,
      calculation.content,
      context,
      ['valuationCalculationId']
    );
  });

export type AflTradeValuationCalculationContent = z.infer<
  typeof aflTradeValuationCalculationContentSchema
>;
export type AflTradeValuationCalculation = z.infer<typeof aflTradeValuationCalculationSchema>;

export type AflTradeValuationCalculationInputIssueCode =
  | 'case_reference_mismatch'
  | 'bundle_mismatch'
  | 'value_unit_mismatch'
  | 'asset_boundary_mismatch'
  | 'club_utility_profile_mismatch'
  | 'club_utility_asset_role_mismatch';

export class AflTradeValuationCalculationInputError extends Error {
  readonly code: AflTradeValuationCalculationInputIssueCode;

  constructor(code: AflTradeValuationCalculationInputIssueCode, message: string) {
    super(message);
    this.name = 'AflTradeValuationCalculationInputError';
    this.code = code;
  }
}

function assertCalculationInputs(
  valuationCase: AflTradeValuationCase,
  drawSet: AflTradeComponentDrawSet,
  ledger: AflTradeRealizedContributionLedger,
  policy: AflTradePackagePolicy
) {
  const caseContent = valuationCase.content;
  if (
    caseContent.componentDrawSetId !== drawSet.componentDrawSetId ||
    caseContent.realizedContributionLedgerId !== ledger.realizedContributionLedgerId ||
    caseContent.packagePolicyId !== policy.packagePolicyId
  ) {
    throw new AflTradeValuationCalculationInputError(
      'case_reference_mismatch',
      'The valuation case must reference the supplied draw set, realized ledger, and package policy.'
    );
  }
  const bundleIds = [
    caseContent.valuationBundleId,
    drawSet.content.valuationBundleId,
    ledger.content.valuationBundleId,
    policy.content.valuationBundleId,
  ];
  if (new Set(bundleIds).size !== 1) {
    throw new AflTradeValuationCalculationInputError(
      'bundle_mismatch',
      'Every calculation input must use the same valuation bundle.'
    );
  }
  const valueUnitIds = [
    caseContent.valueUnitId,
    drawSet.content.valueUnitId,
    ledger.content.valueUnitId,
    policy.content.valueUnitId,
  ];
  if (new Set(valueUnitIds).size !== 1) {
    throw new AflTradeValuationCalculationInputError(
      'value_unit_mismatch',
      'Every calculation input must use the same football-value unit.'
    );
  }

  const caseRootIds = caseContent.parties.flatMap((party) => party.receivedRootAssetIds).sort();
  const drawAssetIds = drawSet.content.assets.map((asset) => asset.assetId);
  if (
    caseRootIds.length !== drawAssetIds.length ||
    caseRootIds.some((assetId, index) => assetId !== drawAssetIds[index]) ||
    ledger.content.records.some((record) => !caseRootIds.includes(record.rootAssetId))
  ) {
    throw new AflTradeValuationCalculationInputError(
      'asset_boundary_mismatch',
      'The draw set and realized ledger must stay inside the valuation case trade-root frontier.'
    );
  }

  if (policy.content.clubUtility.status === 'available') {
    const caseClubIds = caseContent.parties.map((party) => party.aflClubId);
    const profileClubIds = policy.content.clubUtility.profiles.map((profile) => profile.aflClubId);
    if (
      caseClubIds.length !== profileClubIds.length ||
      caseClubIds.some((clubId, index) => clubId !== profileClubIds[index])
    ) {
      throw new AflTradeValuationCalculationInputError(
        'club_utility_profile_mismatch',
        'Available club utility requires exactly one profile for every receiving AFL club.'
      );
    }
    const supportedIds = new Set(
      drawSet.content.assets
        .filter((asset) => asset.status === 'supported')
        .map((asset) => asset.assetId)
    );
    for (const party of caseContent.parties) {
      const profile = policy.content.clubUtility.profiles.find(
        (candidate) => candidate.aflClubId === party.aflClubId
      )!;
      const expectedAssignments = party.receivedRootAssetIds
        .filter((assetId) => supportedIds.has(assetId))
        .sort();
      const actualAssignments = profile.assetRoleAssignments.map((item) => item.assetId);
      if (
        expectedAssignments.length !== actualAssignments.length ||
        expectedAssignments.some((assetId, index) => assetId !== actualAssignments[index])
      ) {
        throw new AflTradeValuationCalculationInputError(
          'club_utility_asset_role_mismatch',
          'Club utility requires one evidence-backed role assignment for every supported root and no others.'
        );
      }
    }
  }
}

type UniversalLayers = z.infer<typeof universalLayersSchema>;
type UniversalValue = z.infer<typeof universalValueSchema>;
type ClubUtilityValue = z.infer<typeof clubUtilityValueSchema>;

interface RootCalculation {
  universal: UniversalValue;
  clubUtility: ClubUtilityValue;
}

function availableUniversal(layers: UniversalLayers): UniversalValue {
  return { status: 'available', layers };
}

function unavailableUniversal(
  partialLayers: UniversalLayers,
  reasonCodes: readonly string[]
): UniversalValue {
  return { status: 'unavailable', partialLayers, reasonCodes: [...new Set(reasonCodes)].sort() };
}

function combineUniversal(values: readonly UniversalValue[]): UniversalValue {
  const layers = values.reduce((sum, value) => addLayers(sum, valueLayers(value)), {
    gross: 0,
    listSpotAdjusted: 0,
    scarcityAdjusted: 0,
  });
  const unavailable = values.filter(
    (value): value is z.infer<typeof unavailableUniversalValueSchema> =>
      value.status === 'unavailable'
  );
  return unavailable.length === 0
    ? availableUniversal(layers)
    : unavailableUniversal(
        layers,
        unavailable.flatMap((value) => value.reasonCodes)
      );
}

function combineClubUtility(values: readonly ClubUtilityValue[]): ClubUtilityValue {
  const unavailable = values.filter(
    (value): value is z.infer<typeof unavailableClubUtilitySchema> => value.status === 'unavailable'
  );
  if (unavailable.some((value) => value.partialValue === null)) {
    return {
      status: 'unavailable',
      partialValue: null,
      reasonCodes: [...new Set(unavailable.flatMap((value) => value.reasonCodes))].sort(),
    };
  }
  const partialValue = values.reduce((sum, value) => sum + (clubUtilityPartial(value) ?? 0), 0);
  return unavailable.length === 0
    ? { status: 'available', value: partialValue }
    : {
        status: 'unavailable',
        partialValue,
        reasonCodes: [...new Set(unavailable.flatMap((value) => value.reasonCodes))].sort(),
      };
}

function addUniversal(left: UniversalValue, right: UniversalValue): UniversalValue {
  return combineUniversal([left, right]);
}

function addClubUtility(left: ClubUtilityValue, right: ClubUtilityValue): ClubUtilityValue {
  return combineClubUtility([left, right]);
}

function scarcityTransform(value: number, policy: AflTradePackagePolicy): number {
  if (value <= 0) return value;
  let transformed = 0;
  for (const segment of policy.content.universalValueLayers.scarcity.segments) {
    const upper = segment.upperBoundExclusive ?? Number.POSITIVE_INFINITY;
    const width = Math.max(0, Math.min(value, upper) - segment.lowerBoundInclusive);
    transformed += width * segment.marginalMultiplier;
    if (value <= upper) break;
  }
  return transformed;
}

function overflowRetentionRate(overflowRank: number, policy: AflTradePackagePolicy): number {
  const tier = policy.content.universalValueLayers.listSpot.overflowRetentionTiers.find(
    (candidate) =>
      candidate.firstOverflowRank <= overflowRank &&
      (candidate.lastOverflowRank === null || overflowRank <= candidate.lastOverflowRank)
  );
  if (!tier)
    throw new TypeError(`No list-spot retention tier covers overflow rank ${overflowRank}.`);
  return tier.retentionRate;
}

function realizedEvidenceForRoot(rootAssetId: string, ledger: AflTradeRealizedContributionLedger) {
  const records = ledger.content.records.filter((record) => record.rootAssetId === rootAssetId);
  const observedRecordCount = records.filter((record) => record.state === 'observed').length;
  const unavailableRecordCount = records.length - observedRecordCount;
  const state =
    observedRecordCount > 0 && unavailableRecordCount === 0
      ? ('observed_only' as const)
      : observedRecordCount > 0
        ? ('partially_unavailable' as const)
        : unavailableRecordCount > 0
          ? ('unavailable_only' as const)
          : ('no_records' as const);
  return { observedRecordCount, unavailableRecordCount, state };
}

function realizedRootCalculation(
  rootAssetId: string,
  ledger: AflTradeRealizedContributionLedger,
  utilityAvailable: boolean
): RootCalculation {
  const records = ledger.content.records.filter((record) => record.rootAssetId === rootAssetId);
  const observed = records
    .filter((record) => record.state === 'observed')
    .reduce((sum, record) => sum + record.contribution, 0);
  const evidence = realizedEvidenceForRoot(rootAssetId, ledger);
  const layers = { gross: observed, listSpotAdjusted: observed, scarcityAdjusted: observed };
  const universal =
    evidence.state === 'observed_only'
      ? availableUniversal(layers)
      : unavailableUniversal(layers, [
          evidence.state === 'no_records'
            ? 'realized_evidence_absent'
            : 'realized_evidence_unavailable',
        ]);
  const clubUtility: ClubUtilityValue = utilityAvailable
    ? universal.status === 'available'
      ? { status: 'available', value: observed }
      : {
          status: 'unavailable',
          partialValue: observed,
          reasonCodes: universal.reasonCodes,
        }
    : {
        status: 'unavailable',
        partialValue: null,
        reasonCodes: ['club_utility_policy_unavailable'],
      };
  return { universal, clubUtility };
}

function forecastRootCalculations(
  party: AflTradeValuationCase['content']['parties'][number],
  view: 'at_trade' | 'remaining',
  draw: AflTradeComponentDrawSet['content']['draws'][number],
  drawSet: AflTradeComponentDrawSet,
  policy: AflTradePackagePolicy
): Map<string, RootCalculation> {
  const metadataById = new Map(drawSet.content.assets.map((asset) => [asset.assetId, asset]));
  const outcomeById = new Map(draw.assetOutcomes.map((outcome) => [outcome.assetId, outcome]));
  const grossByAsset = new Map<string, number>();
  const listAdjustedByAsset = new Map<string, number>();
  const scarcityAdjustedByAsset = new Map<string, number>();
  const utilityByAsset = new Map<string, number>();
  const seasonEntries = new Map<number, Array<{ assetId: string; contribution: number }>>();

  for (const assetId of party.receivedRootAssetIds) {
    grossByAsset.set(assetId, 0);
    listAdjustedByAsset.set(assetId, 0);
    scarcityAdjustedByAsset.set(assetId, 0);
    utilityByAsset.set(assetId, 0);
    if (metadataById.get(assetId)?.status !== 'supported') continue;
    const forecast = outcomeById
      .get(assetId)!
      .forecasts.find((candidate) => candidate.view === view)!;
    for (const season of forecast.seasons) {
      const entries = seasonEntries.get(season.seasonOffset) ?? [];
      entries.push({ assetId, contribution: season.timingAdjustedContribution });
      seasonEntries.set(season.seasonOffset, entries);
      grossByAsset.set(assetId, grossByAsset.get(assetId)! + season.timingAdjustedContribution);
    }
  }

  const utilityProfile =
    policy.content.clubUtility.status === 'available'
      ? policy.content.clubUtility.profiles.find(
          (profile) => profile.aflClubId === party.aflClubId
        )!
      : null;
  const assignmentByAsset = new Map(
    utilityProfile?.assetRoleAssignments.map((assignment) => [assignment.assetId, assignment]) ?? []
  );

  for (const [seasonOffset, entries] of [...seasonEntries.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const positive = entries
      .filter((entry) => entry.contribution > 0)
      .sort(
        (left, right) =>
          right.contribution - left.contribution || left.assetId.localeCompare(right.assetId)
      );
    const positiveRankByAsset = new Map(
      positive.map((entry, index) => [entry.assetId, index + 1] as const)
    );
    for (const entry of entries) {
      const rank = positiveRankByAsset.get(entry.assetId);
      const capacity =
        policy.content.universalValueLayers.listSpot.unconstrainedPositiveContributorsPerSeason;
      const retention =
        rank === undefined || rank <= capacity ? 1 : overflowRetentionRate(rank - capacity, policy);
      const listAdjusted =
        entry.contribution > 0 ? entry.contribution * retention : entry.contribution;
      listAdjustedByAsset.set(
        entry.assetId,
        listAdjustedByAsset.get(entry.assetId)! + listAdjusted
      );
      scarcityAdjustedByAsset.set(
        entry.assetId,
        scarcityAdjustedByAsset.get(entry.assetId)! + scarcityTransform(listAdjusted, policy)
      );
    }

    if (utilityProfile) {
      const timingMultiplier =
        utilityProfile.seasonTimingMultipliers.find((item) => item.seasonOffset === seasonOffset)
          ?.multiplier ?? utilityProfile.defaultSeasonTimingMultiplier;
      const utilityEntries = entries.map((entry) => ({
        ...entry,
        contribution: entry.contribution * timingMultiplier,
        roleKey: assignmentByAsset.get(entry.assetId)!.roleKey,
      }));
      for (const roleRule of utilityProfile.roleRules) {
        const roleEntries = utilityEntries.filter((entry) => entry.roleKey === roleRule.roleKey);
        const positiveRoleEntries = roleEntries
          .filter((entry) => entry.contribution > 0)
          .sort(
            (left, right) =>
              right.contribution - left.contribution || left.assetId.localeCompare(right.assetId)
          );
        const roleRankByAsset = new Map(
          positiveRoleEntries.map((entry, index) => [entry.assetId, index + 1] as const)
        );
        for (const entry of roleEntries) {
          const rank = roleRankByAsset.get(entry.assetId);
          const retention =
            rank !== undefined && rank > roleRule.uncongestedContributorsPerSeason
              ? roleRule.overflowRetentionRate
              : 1;
          utilityByAsset.set(
            entry.assetId,
            utilityByAsset.get(entry.assetId)! +
              (entry.contribution > 0 ? entry.contribution * retention : entry.contribution)
          );
        }
      }
    }
  }

  return new Map(
    party.receivedRootAssetIds.map((assetId) => {
      const metadata = metadataById.get(assetId)!;
      const layers = {
        gross: grossByAsset.get(assetId)!,
        listSpotAdjusted: listAdjustedByAsset.get(assetId)!,
        scarcityAdjusted: scarcityAdjustedByAsset.get(assetId)!,
      };
      const universal: UniversalValue =
        metadata.status === 'supported'
          ? availableUniversal(layers)
          : unavailableUniversal(layers, [`excluded_asset:${metadata.reasonCode}`]);
      const clubUtility: ClubUtilityValue =
        policy.content.clubUtility.status === 'unavailable'
          ? {
              status: 'unavailable',
              partialValue: null,
              reasonCodes: ['club_utility_policy_unavailable'],
            }
          : metadata.status === 'supported'
            ? { status: 'available', value: utilityByAsset.get(assetId)! }
            : {
                status: 'unavailable',
                partialValue: 0,
                reasonCodes: [`excluded_asset:${metadata.reasonCode}`],
              };
      return [assetId, { universal, clubUtility }] as const;
    })
  );
}

function buildPartyDraw(
  party: AflTradeValuationCase['content']['parties'][number],
  draw: AflTradeComponentDrawSet['content']['draws'][number],
  drawSet: AflTradeComponentDrawSet,
  ledger: AflTradeRealizedContributionLedger,
  policy: AflTradePackagePolicy
) {
  const metadataById = new Map(drawSet.content.assets.map((asset) => [asset.assetId, asset]));
  const utilityAvailable = policy.content.clubUtility.status === 'available';
  const atTrade = forecastRootCalculations(party, 'at_trade', draw, drawSet, policy);
  const remaining = forecastRootCalculations(party, 'remaining', draw, drawSet, policy);
  const realized = new Map(
    party.receivedRootAssetIds.map((assetId) => [
      assetId,
      realizedRootCalculation(assetId, ledger, utilityAvailable),
    ])
  );
  const current = new Map(
    party.receivedRootAssetIds.map((assetId) => [
      assetId,
      {
        universal: addUniversal(
          realized.get(assetId)!.universal,
          remaining.get(assetId)!.universal
        ),
        clubUtility: addClubUtility(
          realized.get(assetId)!.clubUtility,
          remaining.get(assetId)!.clubUtility
        ),
      },
    ])
  );
  const byView = { at_trade: atTrade, realized, remaining, current };

  const views = AFL_TRADE_VALUATION_VIEWS.map((view) => {
    const values = byView[view];
    const roots = party.receivedRootAssetIds.map((assetId) => ({
      assetId,
      forecastSupport: metadataById.get(assetId)!.status,
      universal: values.get(assetId)!.universal,
      clubUtility: values.get(assetId)!.clubUtility,
      realizedEvidence: realizedEvidenceForRoot(assetId, ledger),
    }));
    return {
      view,
      roots,
      universal: combineUniversal(roots.map((root) => root.universal)),
      clubUtility: combineClubUtility(roots.map((root) => root.clubUtility)),
    };
  });
  return { aflClubId: party.aflClubId, views };
}

export function calculateAflTradeValuation(
  unparsedValuationCase: AflTradeValuationCase,
  unparsedDrawSet: AflTradeComponentDrawSet,
  unparsedLedger: AflTradeRealizedContributionLedger,
  unparsedPolicy: AflTradePackagePolicy
): AflTradeValuationCalculation {
  const valuationCase = aflTradeValuationCaseSchema.parse(unparsedValuationCase);
  const drawSet = aflTradeComponentDrawSetSchema.parse(unparsedDrawSet);
  const ledger = aflTradeRealizedContributionLedgerSchema.parse(unparsedLedger);
  const policy = aflTradePackagePolicySchema.parse(unparsedPolicy);
  assertCalculationInputs(valuationCase, drawSet, ledger, policy);

  const content = aflTradeValuationCalculationContentSchema.parse({
    schemaVersion: 'afl-trade-valuation-calculation/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationCaseId: valuationCase.valuationCaseId,
    valuationBundleId: valuationCase.content.valuationBundleId,
    componentDrawSetId: drawSet.componentDrawSetId,
    realizedContributionLedgerId: ledger.realizedContributionLedgerId,
    packagePolicyId: policy.packagePolicyId,
    valueUnitId: valuationCase.content.valueUnitId,
    execution: drawSet.content.execution,
    realizedPolicyTreatment:
      'measured_contribution_is_not_rewritten_by_list_spot_scarcity_or_club_utility_policy',
    currentOutcomeIdentity: 'realized_plus_remaining_per_root_draw_club_and_layer',
    missingnessTreatment: 'unavailable_inputs_propagate_with_partial_values_never_coerced_to_zero',
    draws: drawSet.content.draws.map((draw) => ({
      drawIndex: draw.drawIndex,
      drawKey: draw.drawKey,
      probabilityWeight: draw.probabilityWeight,
      parties: valuationCase.content.parties.map((party) =>
        buildPartyDraw(party, draw, drawSet, ledger, policy)
      ),
    })),
    limitation:
      'Deterministic source-independent calculation only; output is not source approval, model calibration, Gate approval, or publication readiness.',
  });
  return aflTradeValuationCalculationSchema.parse({
    valuationCalculationId: createAflTradeContentAddress('valuation-calculation', content),
    content,
  });
}
