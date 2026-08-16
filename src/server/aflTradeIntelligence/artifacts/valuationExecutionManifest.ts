import { z } from 'zod';

import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const executionSchema = z
  .object({
    executorVersion: publicIdSchema,
    codeCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    cleanWorktree: z.literal(true),
    jobId: publicIdSchema,
    attempt: z.number().int().positive(),
    initiatedBy: publicIdSchema,
    workerIdentity: publicIdSchema,
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    executionLogArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const outputsSchema = z
  .object({
    outputInventoryRootArtifact: aflTradeArtifactRefSchema,
    validationReportArtifact: aflTradeArtifactRefSchema,
    coverageAndExclusionReportArtifact: aflTradeArtifactRefSchema,
    modelCardArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const AFL_TRADE_VALUATION_EXECUTION_MANIFEST_SCHEMA_VERSION =
  'afl-trade-valuation-execution-manifest/v1' as const;

export const aflTradeValuationExecutionManifestContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_EXECUTION_MANIFEST_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    scopeKey: publicIdSchema,
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle'),
    valuationInputBundleArtifact: aflTradeArtifactRefSchema,
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetArtifact: aflTradeArtifactRefSchema,
    execution: executionSchema,
    outputs: outputsSchema,
    createdAt: isoDateTimeSchema,
    publicationEligible: z.literal(false),
    limitation: z.literal(
      'Execution and output custody only; not numerical validity, publication approval, or activation authority.'
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const startedAt = Date.parse(manifest.execution.startedAt);
    const finishedAt = Date.parse(manifest.execution.finishedAt);
    const createdAt = Date.parse(manifest.createdAt);

    if (finishedAt < startedAt || createdAt < finishedAt) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'Execution must finish after it starts and before the manifest is created.',
      });
    }

    const inputArtifacts = [
      manifest.valuationInputBundleArtifact,
      manifest.preparedInputSetArtifact,
    ];
    if (inputArtifacts.some((artifact) => Date.parse(artifact.createdAt) > startedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Input artifacts must exist before execution starts.',
      });
    }

    const outputArtifacts = [
      manifest.execution.executionLogArtifact,
      manifest.outputs.outputInventoryRootArtifact,
      manifest.outputs.validationReportArtifact,
      manifest.outputs.coverageAndExclusionReportArtifact,
      manifest.outputs.modelCardArtifact,
    ];
    if (outputArtifacts.some((artifact) => Date.parse(artifact.createdAt) < startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Output artifacts cannot predate execution start.',
      });
    }
    if (outputArtifacts.some((artifact) => Date.parse(artifact.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Output artifacts must exist before the execution manifest is created.',
      });
    }

    const artifactIds = [...inputArtifacts, ...outputArtifacts].map(
      (artifact) => artifact.artifactId
    );
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Each execution manifest artifact role must reference distinct immutable bytes.',
      });
    }
  });

export const aflTradeValuationExecutionManifestSchema = z
  .object({
    valuationExecutionId: aflTradeContentAddressedIdSchema('valuation-execution'),
    content: aflTradeValuationExecutionManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue(
      'valuation-execution',
      manifest.valuationExecutionId,
      manifest.content,
      context,
      ['valuationExecutionId']
    );
  });

export type AflTradeValuationExecutionManifestContent = z.infer<
  typeof aflTradeValuationExecutionManifestContentSchema
>;
export type AflTradeValuationExecutionManifest = z.infer<
  typeof aflTradeValuationExecutionManifestSchema
>;
