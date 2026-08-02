import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const temporalWindowSchema = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Window must be non-empty.' });
    }
  });

const successfulOutcomeSchema = z
  .object({
    status: z.literal('succeeded'),
    modelArtifact: aflTradeArtifactRefSchema,
    validationReportArtifact: aflTradeArtifactRefSchema,
    modelCardArtifact: aflTradeArtifactRefSchema,
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const unsuccessfulOutcomeSchema = z
  .object({
    status: z.enum(['failed', 'cancelled']),
    failureClassification: z.enum([
      'invalid_input',
      'data_quality',
      'training_failure',
      'validation_failure',
      'infrastructure_failure',
      'operator_cancelled',
    ]),
    failureArtifact: aflTradeArtifactRefSchema,
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflTradeModelRunManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-run/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    modelId: publicIdSchema,
    modelVersion: publicIdSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    codeCommitSha: gitCommitSchema,
    cleanWorktree: z.literal(true),
    seed: z.number().int().nonnegative(),
    job: z
      .object({
        jobId: publicIdSchema,
        attempt: z.number().int().positive(),
        initiatedBy: publicIdSchema,
        workerIdentity: publicIdSchema,
      })
      .strict(),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    windows: z
      .object({
        train: temporalWindowSchema,
        calibration: temporalWindowSchema,
        validation: temporalWindowSchema,
        finalTest: temporalWindowSchema,
        embargoDays: z.number().int().nonnegative(),
      })
      .strict(),
    sourceCodeArtifact: aflTradeArtifactRefSchema,
    dependencyLockArtifact: aflTradeArtifactRefSchema,
    runtimeArtifact: aflTradeArtifactRefSchema,
    containerArtifact: aflTradeArtifactRefSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
    environmentArtifact: aflTradeArtifactRefSchema,
    featureDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(1000),
    outcome: z.discriminatedUnion('status', [successfulOutcomeSchema, unsuccessfulOutcomeSchema]),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A model run cannot finish before it starts.',
      });
    }
    const windows = [
      manifest.windows.train,
      manifest.windows.calibration,
      manifest.windows.validation,
      manifest.windows.finalTest,
    ];
    for (let index = 1; index < windows.length; index += 1) {
      const requiredFrom =
        Date.parse(windows[index - 1].to) + manifest.windows.embargoDays * 86_400_000;
      if (Date.parse(windows[index].from) < requiredFrom) {
        context.addIssue({
          code: 'custom',
          path: ['windows'],
          message: 'Model windows must be chronological and respect the declared embargo.',
        });
        break;
      }
    }
  });

export const aflTradeModelRunManifestSchema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: aflTradeModelRunManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });

export type AflTradeModelRunManifest = z.infer<typeof aflTradeModelRunManifestSchema>;
