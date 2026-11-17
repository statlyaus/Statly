import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationInputBlockerSchema } from './preparedValuationInputSet';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const blockedDecisionSchema = z
  .object({
    state: z.literal('blocked'),
    blockers: z.array(aflTradeValuationInputBlockerSchema).min(1).max(1_000),
  })
  .strict();

const eligibleDecisionSchema = z
  .object({
    state: z.literal('eligible_for_dataset_admission'),
  })
  .strict();

export const AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION =
  'afl-trade-valuation-source-qualification-report/v1' as const;

export const aflTradeValuationSourceQualificationReportContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_SOURCE_QUALIFICATION_REPORT_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    operation: z.literal('valuation_model_training_and_derived_feature_creation'),
    valuationScopeKey: publicIdSchema,
    factualReleaseScopeKey: publicIdSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseArtifact: aflTradeArtifactRefSchema,
    releaseMembershipArtifact: aflTradeArtifactRefSchema,
    releaseTradeIds: z.array(publicIdSchema).min(1).max(10_000),
    sourceRightsEvidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(1_000),
    decision: z.discriminatedUnion('state', [blockedDecisionSchema, eligibleDecisionSchema]),
    evaluatedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Source qualification only; not dataset admission, model approval, numerical output, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const tradeIds = content.releaseTradeIds;
    if (
      new Set(tradeIds).size !== tradeIds.length ||
      tradeIds.some((tradeId, index) => index > 0 && tradeIds[index - 1]! > tradeId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['releaseTradeIds'],
        message: 'Release trade IDs must be unique and canonically ordered.',
      });
    }

    const sourceEvidenceIds = content.sourceRightsEvidenceRefs.map(({ artifactId }) => artifactId);
    if (
      new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length ||
      sourceEvidenceIds.some(
        (artifactId, index) => index > 0 && sourceEvidenceIds[index - 1]! > artifactId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRightsEvidenceRefs'],
        message: 'Source-rights evidence must be unique and canonically ordered.',
      });
    }

    if (content.decision.state === 'blocked') {
      const blockerKeys = content.decision.blockers.map(
        ({ code, subject }) => `${code}\u0000${subject.kind}\u0000${subject.id}`
      );
      if (
        new Set(blockerKeys).size !== blockerKeys.length ||
        blockerKeys.some((key, index) => index > 0 && blockerKeys[index - 1]! > key)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['decision', 'blockers'],
          message: 'Source blockers must be unique and canonically ordered.',
        });
      }
      if (
        content.decision.blockers.some(
          (blocker) =>
            blocker.code !== 'source_blocked' ||
            blocker.subject.kind !== 'source' ||
            blocker.evidenceRefs.length !== 1 ||
            !sourceEvidenceIds.includes(blocker.evidenceRefs[0]!.artifactId)
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['decision', 'blockers'],
          message: 'Every blocker must cite one exact retained release source-rights artifact.',
        });
      }
    }

    const evaluatedAt = Date.parse(content.evaluatedAt);
    if (
      [
        content.factualReleaseArtifact,
        content.releaseMembershipArtifact,
        ...content.sourceRightsEvidenceRefs,
      ].some((artifact) => Date.parse(artifact.createdAt) > evaluatedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every source qualification parent must exist before evaluation.',
      });
    }
  });

export const aflTradeValuationSourceQualificationReportSchema = z
  .object({
    qualificationReportId: aflTradeContentAddressedIdSchema('valuation-source-qualification'),
    content: aflTradeValuationSourceQualificationReportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'valuation-source-qualification',
      report.qualificationReportId,
      report.content,
      context,
      ['qualificationReportId']
    );
  });

export type AflTradeValuationSourceQualificationReport = z.infer<
  typeof aflTradeValuationSourceQualificationReportSchema
>;

export function createAflTradeValuationSourceQualificationReport(
  input: z.input<typeof aflTradeValuationSourceQualificationReportContentSchema>
): AflTradeValuationSourceQualificationReport {
  const content = aflTradeValuationSourceQualificationReportContentSchema.parse(input);
  return aflTradeValuationSourceQualificationReportSchema.parse({
    qualificationReportId: createAflTradeContentAddress(
      'valuation-source-qualification',
      content
    ),
    content,
  });
}
