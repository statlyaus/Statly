import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import type { GovernedValuationModelQualification } from './governedValuationModelQualification';

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const governedValuationModelQualificationWorkContentSchema = z
  .object({
    schemaVersion: z.literal('governed-valuation-model-qualification-work/v1'),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    qualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    playerRunId: aflTradeContentAddressedIdSchema('model-run'),
    pickRunId: aflTradeContentAddressedIdSchema('model-run'),
    playerGate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    pickGate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    availableAt: z.iso.datetime({ offset: true }),
    cause: z.literal('current_qualified_model_pair_advanced'),
    status: z.literal('pending'),
    publicationEligible: z.literal(false),
  })
  .strict();

export const governedValuationModelQualificationWorkSchema = z
  .object({
    workId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    content: governedValuationModelQualificationWorkContentSchema,
  })
  .strict()
  .superRefine((work, context) => {
    addAflTradeContentAddressIssue('model-qualification-work', work.workId, work.content, context, [
      'workId',
    ]);
  });

export type GovernedValuationModelQualificationWork = z.infer<
  typeof governedValuationModelQualificationWorkSchema
>;

export function createGovernedValuationModelQualificationWork(input: {
  readonly qualification: GovernedValuationModelQualification;
  readonly playerGate3DecisionId: string;
  readonly pickGate3DecisionId: string;
  readonly availableAt: string;
}): GovernedValuationModelQualificationWork {
  if (input.qualification.content.outcome !== 'qualified') {
    throw new RangeError('Immediate qualification work requires a passing model pair.');
  }
  const content = governedValuationModelQualificationWorkContentSchema.parse({
    schemaVersion: 'governed-valuation-model-qualification-work/v1',
    environment: 'non_production',
    scopeKey: input.qualification.content.scopeKey,
    qualificationId: input.qualification.qualificationId,
    playerRunId: input.qualification.content.player.runId,
    pickRunId: input.qualification.content.pick.runId,
    playerGate3DecisionId: input.playerGate3DecisionId,
    pickGate3DecisionId: input.pickGate3DecisionId,
    availableAt: input.availableAt,
    cause: 'current_qualified_model_pair_advanced',
    status: 'pending',
    publicationEligible: false,
  });
  return governedValuationModelQualificationWorkSchema.parse({
    workId: createAflTradeContentAddress('model-qualification-work', content),
    content,
  });
}
