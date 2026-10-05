import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeComponentDrawSetSchema } from './componentDrawSet';
import { aflTradePackagePolicySchema } from './packagePolicy';
import { aflTradeRealizedContributionLedgerSchema } from './realizedContributionLedger';
import { aflTradeValuationCaseSchema } from './valuationCaseContracts';

export const GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION =
  'governed-private-valuation-calculation-input/v3' as const;

const LIMITATION =
  'Private governed pre-calculation input only; exact factual, source-use, model-run, Gate 3, and kernel ancestry is required. It is not a result, publication, production, or activation authority.' as const;
const componentRoles = [
  'player_contribution_and_availability',
  'draft_pick_and_future_pick_distribution',
] as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).min(1).max(500);

const confirmedFactsSchema = z
  .object({
    resultId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-result'),
    resultArtifact: aflTradeArtifactRefSchema,
    valuationScopeKey: publicIdSchema,
    transactionPromotionId: aflTradeContentAddressedIdSchema(
      'private-workbook-transaction-promotion'
    ),
    tradeId: publicIdSchema,
    valueUnitId: publicIdSchema,
    assetIds: z.array(publicIdSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((facts, context) => {
    if (
      new Set(facts.assetIds).size !== facts.assetIds.length ||
      facts.assetIds.some(
        (assetId, index) => index > 0 && facts.assetIds[index - 1]! > assetId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetIds'],
        message: 'Confirmed factual asset IDs must be unique and canonically ordered.',
      });
    }
  });

const sourceUseAssessmentSchema = z
  .object({
    assessmentId: aflTradeContentAddressedIdSchema('hpn-private-source-use-assessment'),
    assessmentArtifact: aflTradeArtifactRefSchema,
    state: z.literal('permitted_private_calculation'),
    operation: z.literal('derived_feature_creation'),
    valuationScopeKey: publicIdSchema,
    modelTraining: z.literal('blocked'),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const privateEvaluationSchema = z
  .object({
    decisionId: publicIdSchema,
    decisionArtifact: aflTradeArtifactRefSchema,
    state: z.literal('authorized_private_calculation'),
    environment: z.literal('non_production'),
    modelTrainingAuthorized: z.literal(false),
    liveCaptureAuthorized: z.literal(false),
    publicationAuthorized: z.literal(false),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const factualReleaseSchema = z
  .object({
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    releaseArtifact: aflTradeArtifactRefSchema,
    state: z.literal('active'),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const componentAuthorityShape = {
  protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
  runId: aflTradeContentAddressedIdSchema('model-run'),
  datasetId: aflTradeContentAddressedIdSchema('dataset'),
  gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
  environment: z.literal('non_production'),
  outcome: z.literal('succeeded'),
  gate3State: z.literal('approved'),
  runArtifact: aflTradeArtifactRefSchema,
  gate3DecisionArtifact: aflTradeArtifactRefSchema,
  evidenceRefs: evidenceRefsSchema,
};
const playerComponentAuthoritySchema = z
  .object({
    role: z.literal('player_contribution_and_availability'),
    modelKind: z.literal('player_contribution_and_availability'),
    ...componentAuthorityShape,
  })
  .strict();
const pickComponentAuthoritySchema = z
  .object({
    role: z.literal('draft_pick_and_future_pick_distribution'),
    modelKind: z.literal('draft_pick_and_future_pick_distribution'),
    ...componentAuthorityShape,
  })
  .strict();
const componentAuthoritySchema = z.discriminatedUnion('role', [
  playerComponentAuthoritySchema,
  pickComponentAuthoritySchema,
]);

const valuationBundleAuthoritySchema = z
  .object({
    bundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    bundleArtifact: aflTradeArtifactRefSchema,
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gate3DecisionArtifact: aflTradeArtifactRefSchema,
    environment: z.literal('non_production'),
    gate3State: z.literal('approved'),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

export const governedPrivateValuationAuthoritySchema = z
  .object({
    kind: z.literal('governed_private_nonproduction'),
    confirmedFacts: confirmedFactsSchema,
    sourceUseAssessments: z.array(sourceUseAssessmentSchema).min(1).max(100),
    privateEvaluation: privateEvaluationSchema,
    factualRelease: factualReleaseSchema,
    components: z.array(componentAuthoritySchema).length(componentRoles.length),
    valuationBundle: valuationBundleAuthoritySchema,
    publicationProhibited: z.literal(true),
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      authority.components.some(
        ({ role }, index) => role !== componentRoles[index]
      ) ||
      new Set(authority.components.map(({ role }) => role)).size !== componentRoles.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Governed authority requires both component roles in canonical order.',
      });
    }
    const assessmentIds = authority.sourceUseAssessments.map(({ assessmentId }) => assessmentId);
    if (
      new Set(assessmentIds).size !== assessmentIds.length ||
      assessmentIds.some(
        (assessmentId, index) =>
          index > 0 && authority.sourceUseAssessments[index - 1]!.assessmentId > assessmentId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUseAssessments'],
        message: 'Source-use assessments must be unique and canonically ordered.',
      });
    }
  });

const contentSchema = z
  .object({
    schemaVersion: z.literal(GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION),
    authority: governedPrivateValuationAuthoritySchema,
    tradeId: publicIdSchema,
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationCase: aflTradeValuationCaseSchema,
    componentDrawSet: aflTradeComponentDrawSetSchema,
    realizedContributionLedger: aflTradeRealizedContributionLedgerSchema,
    packagePolicy: aflTradePackagePolicySchema,
    createdAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((input, context) => {
    const facts = input.authority.confirmedFacts;
    const valuationCase = input.valuationCase.content;
    const drawSet = input.componentDrawSet.content;
    const ledger = input.realizedContributionLedger.content;
    const policy = input.packagePolicy.content;
    if (
      input.tradeId !== facts.tradeId ||
      input.tradeId !== valuationCase.tradeId ||
      facts.valueUnitId !== valuationCase.valueUnitId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Governed calculation factual trade or value-unit ancestry mismatch.',
      });
    }
    if (
      input.authority.sourceUseAssessments.some(
        ({ valuationScopeKey }) => valuationScopeKey !== facts.valuationScopeKey
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authority', 'sourceUseAssessments'],
        message: 'Every source-use assessment must match the confirmed valuation scope.',
      });
    }
    if (
      [valuationCase, drawSet, ledger, policy].some(
        ({ valuationInputBundleId }) => valuationInputBundleId !== input.valuationInputBundleId
      ) ||
      [
        valuationCase.valuationBundleId,
        drawSet.valuationBundleId,
        ledger.valuationBundleId,
        policy.valuationBundleId,
        input.authority.valuationBundle.bundleId,
      ].some((bundleId) => bundleId !== valuationCase.valuationBundleId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Governed calculation bundle ancestry mismatch.',
      });
    }
    if (
      valuationCase.componentDrawSetId !== input.componentDrawSet.componentDrawSetId ||
      valuationCase.realizedContributionLedgerId !==
        input.realizedContributionLedger.realizedContributionLedgerId ||
      valuationCase.packagePolicyId !== input.packagePolicy.packagePolicyId ||
      valuationCase.lineageGraphId !== ledger.lineageGraphId ||
      [drawSet.valueUnitId, ledger.valueUnitId, policy.valueUnitId].some(
        (valueUnitId) => valueUnitId !== valuationCase.valueUnitId
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Governed calculation parents are not one exact kernel input.',
      });
    }

    const drawAssetIds = drawSet.assets.map(({ assetId }) => assetId);
    if (
      facts.assetIds.length !== drawAssetIds.length ||
      facts.assetIds.some((assetId, index) => assetId !== drawAssetIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authority', 'confirmedFacts', 'assetIds'],
        message: 'Governed calculation must classify the exact confirmed factual assets.',
      });
    }
    for (const [index, component] of drawSet.components.entries()) {
      const authority = input.authority.components[index];
      if (
        authority === undefined ||
        authority.role !== component.role ||
        authority.modelKind !== component.modelKind ||
        authority.protocolId !== component.protocolId ||
        authority.runId !== component.runId ||
        authority.datasetId !== component.datasetId ||
        authority.gate3DecisionId !== component.gate3DecisionId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['authority', 'components', index],
          message: 'Gate 3 component authority must exactly match the component draw set.',
        });
      }
    }

    const authorityRefs = [
      facts.resultArtifact,
      ...input.authority.sourceUseAssessments.flatMap((assessment) => [
        assessment.assessmentArtifact,
        ...assessment.evidenceRefs,
      ]),
      input.authority.privateEvaluation.decisionArtifact,
      ...input.authority.privateEvaluation.evidenceRefs,
      input.authority.factualRelease.releaseArtifact,
      ...input.authority.factualRelease.evidenceRefs,
      ...input.authority.components.flatMap((component) => [
        component.runArtifact,
        component.gate3DecisionArtifact,
        ...component.evidenceRefs,
      ]),
      input.authority.valuationBundle.bundleArtifact,
      input.authority.valuationBundle.gate3DecisionArtifact,
      ...input.authority.valuationBundle.evidenceRefs,
    ];
    const createdAt = Date.parse(input.createdAt);
    if (authorityRefs.some((reference) => Date.parse(reference.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Governed calculation input cannot predate any exact authority parent.',
      });
    }
  });

export const governedPrivateValuationCalculationInputSchema = z
  .object({
    calculationInputId: aflTradeContentAddressedIdSchema(
      'governed-private-valuation-calculation-input'
    ),
    content: contentSchema,
  })
  .strict()
  .superRefine((input, context) => {
    addAflTradeContentAddressIssue(
      'governed-private-valuation-calculation-input',
      input.calculationInputId,
      input.content,
      context,
      ['calculationInputId']
    );
  });

export type GovernedPrivateValuationCalculationInput = z.infer<
  typeof governedPrivateValuationCalculationInputSchema
>;

export function createGovernedPrivateValuationCalculationInput(
  input: Omit<z.input<typeof contentSchema>, 'limitation'>
): GovernedPrivateValuationCalculationInput {
  const content = contentSchema.parse({
    ...input,
    limitation: LIMITATION,
  });
  return governedPrivateValuationCalculationInputSchema.parse({
    calculationInputId: createAflTradeContentAddress(
      'governed-private-valuation-calculation-input',
      content
    ),
    content,
  });
}
