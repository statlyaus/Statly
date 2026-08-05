import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';
import {
  aflTradeValuationSnapshotSetSchema,
  type AflTradeValuationSnapshotSet,
} from './valuationSnapshots';

const finiteNumberSchema = z.number().finite();
const viewSchema = z.enum(AFL_TRADE_VALUATION_VIEWS);
const layerSchema = z.enum(['gross', 'list_spot_adjusted', 'scarcity_adjusted']);
const claimKindSchema = z.enum([
  'measured_fact',
  'model_estimate',
  'assumption',
  'unavailable_information',
  'low_confidence_output',
]);

const distributionStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('distribution_summary'),
    claimKind: z.literal('model_estimate'),
    polarity: z.literal('neutral'),
    reasonCode: z.literal('package_distribution_summary'),
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    view: viewSchema,
    layer: layerSchema,
    mean: finiteNumberSchema,
    median: finiteNumberSchema,
    valuationSnapshotId: aflTradeContentAddressedIdSchema('valuation-snapshot'),
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const rootDriverStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('root_driver'),
    claimKind: z.literal('model_estimate'),
    polarity: z.enum(['positive', 'negative']),
    reasonCode: z.enum(['positive_root_driver', 'negative_root_driver']),
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    view: viewSchema,
    layer: layerSchema,
    rootAssetId: aflTradePublicIdSchema,
    weightedMean: finiteNumberSchema,
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const realizedFactStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('realized_fact'),
    claimKind: z.literal('measured_fact'),
    polarity: z.literal('neutral'),
    reasonCode: z.literal('recorded_receiving_club_contribution'),
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    rootAssetId: aflTradePublicIdSchema,
    contribution: finiteNumberSchema,
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const unavailableStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('unavailable'),
    claimKind: z.literal('unavailable_information'),
    polarity: z.literal('neutral'),
    reasonCode: z.literal('complete_result_unavailable'),
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    view: viewSchema,
    reasonCodes: z.array(aflTradePublicIdSchema).min(1).max(100),
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const confidenceStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('confidence_warning'),
    claimKind: z.literal('low_confidence_output'),
    polarity: z.literal('neutral'),
    reasonCode: z.literal('confidence_low_or_unavailable'),
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    view: viewSchema,
    confidenceState: z.enum(['low', 'unavailable']),
    detailReasonCode: aflTradePublicIdSchema,
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const assumptionStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('definition_assumption'),
    claimKind: z.literal('assumption'),
    polarity: z.literal('neutral'),
    reasonCode: z.enum([
      'low_return_definition_assumption',
      'elite_outcome_definition_assumption',
      'practical_equivalence_definition_assumption',
    ]),
    definitionName: z.enum(['low return', 'elite outcome', 'practical equivalence']),
    definitionArtifact: aflTradeArtifactRefSchema,
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

const comparisonStatementSchema = z
  .object({
    statementId: aflTradePublicIdSchema,
    template: z.literal('pairwise_comparison'),
    claimKind: z.literal('model_estimate'),
    polarity: z.literal('neutral'),
    reasonCode: z.literal('pairwise_finish_ahead_probability'),
    view: viewSchema,
    layer: layerSchema,
    leftAflClubId: aflTradePublicIdSchema,
    leftClubName: z.string().trim().min(1).max(120),
    rightAflClubId: aflTradePublicIdSchema,
    rightClubName: z.string().trim().min(1).max(120),
    leftAheadProbability: finiteNumberSchema.min(0).max(1),
    practicallyEquivalentProbability: finiteNumberSchema.min(0).max(1),
    rightAheadProbability: finiteNumberSchema.min(0).max(1),
    valuationSnapshotId: aflTradeContentAddressedIdSchema('valuation-snapshot'),
    renderedText: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aflTradeStructuredExplanationStatementSchema = z.discriminatedUnion('template', [
  distributionStatementSchema,
  rootDriverStatementSchema,
  realizedFactStatementSchema,
  unavailableStatementSchema,
  confidenceStatementSchema,
  assumptionStatementSchema,
  comparisonStatementSchema,
]);

export type AflTradeStructuredExplanationStatement = z.infer<
  typeof aflTradeStructuredExplanationStatementSchema
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K & keyof T> : never;
type ExplanationStatementSource = DistributiveOmit<
  AflTradeStructuredExplanationStatement,
  'renderedText'
>;
type ExplanationStatementInput = DistributiveOmit<
  AflTradeStructuredExplanationStatement,
  'statementId' | 'renderedText'
>;

function formatValue(value: number): string {
  return value.toFixed(2);
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderAflTradeStructuredExplanationStatement(
  statement: ExplanationStatementSource
): string {
  switch (statement.template) {
    case 'distribution_summary':
      return `${statement.clubName}'s ${statement.view.replaceAll('_', ' ')} model estimate has a mean of ${formatValue(statement.mean)} and median of ${formatValue(statement.median)} ${statement.layer.replaceAll('_', ' ')} value units.`;
    case 'root_driver':
      return `${statement.rootAssetId} is a ${statement.polarity} driver for ${statement.clubName}, with a model-estimated mean of ${formatValue(statement.weightedMean)} ${statement.layer.replaceAll('_', ' ')} value units.`;
    case 'realized_fact':
      return `${statement.clubName} has ${formatValue(statement.contribution)} recorded receiving-club value units from ${statement.rootAssetId}.`;
    case 'unavailable':
      return `${statement.clubName}'s complete ${statement.view.replaceAll('_', ' ')} result is unavailable because: ${statement.reasonCodes.join(', ')}.`;
    case 'confidence_warning':
      return `${statement.clubName}'s ${statement.view.replaceAll('_', ' ')} output has ${statement.confidenceState} confidence (${statement.detailReasonCode}).`;
    case 'definition_assumption':
      return `The ${statement.definitionName} label uses the immutable governed definition ${statement.definitionArtifact.artifactId}.`;
    case 'pairwise_comparison':
      return `For ${statement.view.replaceAll('_', ' ')}, ${statement.leftClubName} finishes ahead with ${formatProbability(statement.leftAheadProbability)}, ${statement.rightClubName} with ${formatProbability(statement.rightAheadProbability)}, and practical equivalence is ${formatProbability(statement.practicallyEquivalentProbability)}.`;
  }
}

export const aflTradeStructuredExplanationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-structured-explanation/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationSnapshotSetId: aflTradeContentAddressedIdSchema('valuation-snapshot-set'),
    sourceOfTruth: z.literal('fixed_templates_reason_codes_and_replayable_numeric_sources'),
    unconstrainedGenerativeClaims: z.literal('prohibited'),
    supportedClaimKinds: z.array(claimKindSchema).length(claimKindSchema.options.length),
    statements: z.array(aflTradeStructuredExplanationStatementSchema).min(1).max(10_000),
    limitation: z.literal(
      'Structured source-independent explanations only; fixture text is not source approval, model calibration, Gate approval, or publication readiness.'
    ),
  })
  .strict()
  .superRefine((explanation, context) => {
    if (
      explanation.supportedClaimKinds.some((kind, index) => kind !== claimKindSchema.options[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supportedClaimKinds'],
        message: 'Supported claim kinds must use canonical order.',
      });
    }
    const statementIds = explanation.statements.map((statement) => statement.statementId);
    if (
      new Set(statementIds).size !== statementIds.length ||
      statementIds.some((statementId, index) => statementId !== `statement:${index + 1}`)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['statements'],
        message: 'Explanation statements require unique contiguous canonical identities.',
      });
    }
    for (const [index, statement] of explanation.statements.entries()) {
      const { renderedText: _renderedText, ...source } = statement;
      if (
        statement.renderedText !==
        renderAflTradeStructuredExplanationStatement(source as ExplanationStatementSource)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['statements', index, 'renderedText'],
          message: 'Rendered explanation text must equal its fixed template and structured values.',
        });
      }
    }
  });

export const aflTradeStructuredExplanationSchema = z
  .object({
    structuredExplanationId: aflTradeContentAddressedIdSchema('structured-explanation'),
    content: aflTradeStructuredExplanationContentSchema,
  })
  .strict()
  .superRefine((explanation, context) => {
    addAflTradeContentAddressIssue(
      'structured-explanation',
      explanation.structuredExplanationId,
      explanation.content,
      context,
      ['structuredExplanationId']
    );
  });

export type AflTradeStructuredExplanation = z.infer<typeof aflTradeStructuredExplanationSchema>;

function withRenderedText(
  statement: ExplanationStatementSource
): AflTradeStructuredExplanationStatement {
  return {
    ...statement,
    renderedText: renderAflTradeStructuredExplanationStatement(statement),
  } as AflTradeStructuredExplanationStatement;
}

function rootWeightedMean(
  calculation: AflTradeValuationCalculation,
  clubId: string,
  rootAssetId: string,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
): number | null {
  let weightedValue = 0;
  for (const draw of calculation.content.draws) {
    const root = draw.parties
      .find((party) => party.aflClubId === clubId)!
      .views.find((candidate) => candidate.view === view)!
      .roots.find((candidate) => candidate.assetId === rootAssetId)!;
    if (root.universal.status !== 'available') return null;
    weightedValue += root.universal.layers.scarcityAdjusted * draw.probabilityWeight;
  }
  return weightedValue;
}

function addStatement(
  statements: AflTradeStructuredExplanationStatement[],
  statement: ExplanationStatementInput
) {
  statements.push(
    withRenderedText({
      ...statement,
      statementId: `statement:${statements.length + 1}`,
    } as ExplanationStatementSource)
  );
}

export function createAflTradeStructuredExplanation(
  unparsedCalculation: AflTradeValuationCalculation,
  unparsedSnapshotSet: AflTradeValuationSnapshotSet,
  unparsedValuationCase: AflTradeValuationCase
): AflTradeStructuredExplanation {
  const calculation = aflTradeValuationCalculationSchema.parse(unparsedCalculation);
  const snapshotSet = aflTradeValuationSnapshotSetSchema.parse(unparsedSnapshotSet);
  const valuationCase = aflTradeValuationCaseSchema.parse(unparsedValuationCase);
  if (
    calculation.content.valuationCaseId !== valuationCase.valuationCaseId ||
    snapshotSet.content.valuationCaseId !== valuationCase.valuationCaseId ||
    snapshotSet.content.valuationCalculationId !== calculation.valuationCalculationId
  ) {
    throw new TypeError('Explanation inputs must reference one valuation case and calculation.');
  }

  const statements: AflTradeStructuredExplanationStatement[] = [];
  const definitions = snapshotSet.content.snapshots[0].content.definitions;
  for (const assumption of [
    {
      reasonCode: 'low_return_definition_assumption' as const,
      definitionName: 'low return' as const,
      definitionArtifact: definitions.lowReturnDefinitionArtifact,
    },
    {
      reasonCode: 'elite_outcome_definition_assumption' as const,
      definitionName: 'elite outcome' as const,
      definitionArtifact: definitions.eliteOutcomeDefinitionArtifact,
    },
    {
      reasonCode: 'practical_equivalence_definition_assumption' as const,
      definitionName: 'practical equivalence' as const,
      definitionArtifact: definitions.practicalEquivalenceDefinitionArtifact,
    },
  ]) {
    addStatement(statements, {
      template: 'definition_assumption',
      claimKind: 'assumption',
      polarity: 'neutral',
      ...assumption,
    });
  }

  for (const snapshot of snapshotSet.content.snapshots) {
    const view = snapshot.content.viewContext.view;
    for (const party of valuationCase.content.parties) {
      const partySnapshot = snapshot.content.parties.find(
        (candidate) => candidate.aflClubId === party.aflClubId
      )!;
      const scarcity = partySnapshot.universal.find(
        (entry) => entry.layer === 'scarcity_adjusted'
      )!.distribution;
      if (scarcity.status === 'available') {
        addStatement(statements, {
          template: 'distribution_summary',
          claimKind: 'model_estimate',
          polarity: 'neutral',
          reasonCode: 'package_distribution_summary',
          aflClubId: party.aflClubId,
          clubName: party.clubName,
          view,
          layer: 'scarcity_adjusted',
          mean: scarcity.statistics.mean,
          median: scarcity.statistics.median,
          valuationSnapshotId: snapshot.valuationSnapshotId,
        });
      } else {
        addStatement(statements, {
          template: 'unavailable',
          claimKind: 'unavailable_information',
          polarity: 'neutral',
          reasonCode: 'complete_result_unavailable',
          aflClubId: party.aflClubId,
          clubName: party.clubName,
          view,
          reasonCodes: scarcity.reasonCodes,
        });
      }

      if (view === 'realized' || view === 'current') {
        const firstDrawParty = calculation.content.draws[0].parties.find(
          (candidate) => candidate.aflClubId === party.aflClubId
        )!;
        const realizedView = firstDrawParty.views.find(
          (candidate) => candidate.view === 'realized'
        )!;
        for (const root of realizedView.roots) {
          if (root.universal.status === 'available') {
            addStatement(statements, {
              template: 'realized_fact',
              claimKind: 'measured_fact',
              polarity: 'neutral',
              reasonCode: 'recorded_receiving_club_contribution',
              aflClubId: party.aflClubId,
              clubName: party.clubName,
              rootAssetId: root.assetId,
              contribution: root.universal.layers.gross,
              valuationCalculationId: calculation.valuationCalculationId,
            });
          }
        }
      }

      const drivers = party.receivedRootAssetIds
        .map((rootAssetId) => ({
          rootAssetId,
          weightedMean: rootWeightedMean(calculation, party.aflClubId, rootAssetId, view),
        }))
        .filter((driver): driver is { rootAssetId: string; weightedMean: number } =>
          Number.isFinite(driver.weightedMean)
        );
      const selectedDrivers = [
        ...drivers
          .filter((driver) => driver.weightedMean > 0)
          .sort((left, right) => right.weightedMean - left.weightedMean)
          .slice(0, 2),
        ...drivers
          .filter((driver) => driver.weightedMean < 0)
          .sort((left, right) => left.weightedMean - right.weightedMean)
          .slice(0, 2),
      ];
      for (const driver of selectedDrivers) {
        const positive = driver.weightedMean > 0;
        addStatement(statements, {
          template: 'root_driver',
          claimKind: 'model_estimate',
          polarity: positive ? 'positive' : 'negative',
          reasonCode: positive ? 'positive_root_driver' : 'negative_root_driver',
          aflClubId: party.aflClubId,
          clubName: party.clubName,
          view,
          layer: 'scarcity_adjusted',
          rootAssetId: driver.rootAssetId,
          weightedMean: driver.weightedMean,
          valuationCalculationId: calculation.valuationCalculationId,
        });
      }

      if (
        definitions.confidence.status === 'unavailable' ||
        definitions.confidence.band === 'low'
      ) {
        addStatement(statements, {
          template: 'confidence_warning',
          claimKind: 'low_confidence_output',
          polarity: 'neutral',
          reasonCode: 'confidence_low_or_unavailable',
          aflClubId: party.aflClubId,
          clubName: party.clubName,
          view,
          confidenceState: definitions.confidence.status === 'unavailable' ? 'unavailable' : 'low',
          detailReasonCode:
            definitions.confidence.status === 'unavailable'
              ? definitions.confidence.reasonCode
              : 'governed-confidence-band-low',
        });
      }
    }

    for (const comparison of snapshot.content.pairwiseComparisons) {
      const scarcity = comparison.universal.find(
        (entry) => entry.layer === 'scarcity_adjusted'
      )!.comparison;
      if (scarcity.status !== 'available') continue;
      addStatement(statements, {
        template: 'pairwise_comparison',
        claimKind: 'model_estimate',
        polarity: 'neutral',
        reasonCode: 'pairwise_finish_ahead_probability',
        view,
        layer: 'scarcity_adjusted',
        leftAflClubId: comparison.leftAflClubId,
        leftClubName: valuationCase.content.parties.find(
          (party) => party.aflClubId === comparison.leftAflClubId
        )!.clubName,
        rightAflClubId: comparison.rightAflClubId,
        rightClubName: valuationCase.content.parties.find(
          (party) => party.aflClubId === comparison.rightAflClubId
        )!.clubName,
        leftAheadProbability: scarcity.probabilities.leftAhead,
        practicallyEquivalentProbability: scarcity.probabilities.practicallyEquivalent,
        rightAheadProbability: scarcity.probabilities.rightAhead,
        valuationSnapshotId: snapshot.valuationSnapshotId,
      });
    }
  }

  const content = aflTradeStructuredExplanationContentSchema.parse({
    schemaVersion: 'afl-trade-structured-explanation/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: calculation.valuationCalculationId,
    valuationSnapshotSetId: snapshotSet.valuationSnapshotSetId,
    sourceOfTruth: 'fixed_templates_reason_codes_and_replayable_numeric_sources',
    unconstrainedGenerativeClaims: 'prohibited',
    supportedClaimKinds: claimKindSchema.options,
    statements,
    limitation:
      'Structured source-independent explanations only; fixture text is not source approval, model calibration, Gate approval, or publication readiness.',
  });
  return aflTradeStructuredExplanationSchema.parse({
    structuredExplanationId: createAflTradeContentAddress('structured-explanation', content),
    content,
  });
}

export interface AflTradeExplanationParityValidation {
  valid: boolean;
  issueStatementIds: string[];
}

export function validateAflTradeStructuredExplanationParity(
  unparsedExplanation: AflTradeStructuredExplanation,
  unparsedCalculation: AflTradeValuationCalculation,
  unparsedSnapshotSet: AflTradeValuationSnapshotSet
): AflTradeExplanationParityValidation {
  const explanation = aflTradeStructuredExplanationSchema.parse(unparsedExplanation);
  const calculation = aflTradeValuationCalculationSchema.parse(unparsedCalculation);
  const snapshotSet = aflTradeValuationSnapshotSetSchema.parse(unparsedSnapshotSet);
  const issueStatementIds: string[] = [];
  if (
    explanation.content.valuationCalculationId !== calculation.valuationCalculationId ||
    explanation.content.valuationSnapshotSetId !== snapshotSet.valuationSnapshotSetId
  ) {
    return {
      valid: false,
      issueStatementIds: explanation.content.statements.map((statement) => statement.statementId),
    };
  }

  for (const statement of explanation.content.statements) {
    let valid = true;
    if (statement.template === 'distribution_summary') {
      const snapshot = snapshotSet.content.snapshots.find(
        (candidate) => candidate.valuationSnapshotId === statement.valuationSnapshotId
      );
      const distribution = snapshot?.content.parties
        .find((party) => party.aflClubId === statement.aflClubId)
        ?.universal.find((entry) => entry.layer === statement.layer)?.distribution;
      valid =
        distribution?.status === 'available' &&
        distribution.statistics.mean === statement.mean &&
        distribution.statistics.median === statement.median;
    } else if (statement.template === 'root_driver') {
      valid =
        statement.valuationCalculationId === calculation.valuationCalculationId &&
        rootWeightedMean(
          calculation,
          statement.aflClubId,
          statement.rootAssetId,
          statement.view
        ) === statement.weightedMean;
    } else if (statement.template === 'realized_fact') {
      const root = calculation.content.draws[0].parties
        .find((party) => party.aflClubId === statement.aflClubId)
        ?.views.find((view) => view.view === 'realized')
        ?.roots.find((candidate) => candidate.assetId === statement.rootAssetId);
      valid =
        statement.valuationCalculationId === calculation.valuationCalculationId &&
        root?.universal.status === 'available' &&
        root.universal.layers.gross === statement.contribution;
    } else if (statement.template === 'pairwise_comparison') {
      const snapshot = snapshotSet.content.snapshots.find(
        (candidate) => candidate.valuationSnapshotId === statement.valuationSnapshotId
      );
      const comparison = snapshot?.content.pairwiseComparisons
        .find(
          (candidate) =>
            candidate.leftAflClubId === statement.leftAflClubId &&
            candidate.rightAflClubId === statement.rightAflClubId
        )
        ?.universal.find((entry) => entry.layer === statement.layer)?.comparison;
      valid =
        comparison?.status === 'available' &&
        comparison.probabilities.leftAhead === statement.leftAheadProbability &&
        comparison.probabilities.practicallyEquivalent ===
          statement.practicallyEquivalentProbability &&
        comparison.probabilities.rightAhead === statement.rightAheadProbability;
    }
    if (!valid) issueStatementIds.push(statement.statementId);
  }
  return { valid: issueStatementIds.length === 0, issueStatementIds };
}
