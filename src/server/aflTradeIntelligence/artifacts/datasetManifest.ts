import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeDatasetManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-dataset/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    createdAt: isoDateTimeSchema,
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    gate2DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceRegisterIds: z.array(publicIdSchema).min(1).max(50),
    knowledgeCutoffAt: isoDateTimeSchema,
    effectiveFrom: isoDateTimeSchema,
    effectiveTo: isoDateTimeSchema,
    rowCount: z.number().int().nonnegative(),
    includedCohorts: z.array(publicIdSchema).min(1).max(500),
    excludedCohorts: z.array(publicIdSchema).max(500),
    featureDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(1000),
    featureSchemaArtifact: aflTradeArtifactRefSchema,
    targetDefinitionArtifact: aflTradeArtifactRefSchema,
    splitAssignmentArtifact: aflTradeArtifactRefSchema,
    datasetArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.sourceRegisterIds).size !== manifest.sourceRegisterIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRegisterIds'],
        message: 'Dataset source-register references must be unique.',
      });
    }
    if (new Set(manifest.includedCohorts).size !== manifest.includedCohorts.length) {
      context.addIssue({
        code: 'custom',
        path: ['includedCohorts'],
        message: 'Included dataset cohorts must be unique.',
      });
    }
    if (new Set(manifest.excludedCohorts).size !== manifest.excludedCohorts.length) {
      context.addIssue({
        code: 'custom',
        path: ['excludedCohorts'],
        message: 'Excluded dataset cohorts must be unique.',
      });
    }
    const excluded = new Set(manifest.excludedCohorts);
    if (manifest.includedCohorts.some((cohort) => excluded.has(cohort))) {
      context.addIssue({
        code: 'custom',
        path: ['excludedCohorts'],
        message: 'A dataset cohort cannot be both included and excluded.',
      });
    }
    if (Date.parse(manifest.effectiveTo) <= Date.parse(manifest.effectiveFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'The dataset effective range must be non-empty.',
      });
    }
    if (Date.parse(manifest.createdAt) < Date.parse(manifest.knowledgeCutoffAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A dataset cannot be created before its knowledge cutoff.',
      });
    }
  });

export const aflTradeDatasetManifestSchema = z
  .object({
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    content: aflTradeDatasetManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('dataset', manifest.datasetId, manifest.content, context, [
      'datasetId',
    ]);
  });

export type AflTradeDatasetManifest = z.infer<typeof aflTradeDatasetManifestSchema>;
