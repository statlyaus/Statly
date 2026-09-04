import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchOperationId,
  governedPrivateEvaluationBatchSchema,
  type GovernedPrivateEvaluationBatch,
} from './internal/governedPrivateEvaluationBatch';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import type {
  GovernedPrivateEvaluationBatchHead,
  GovernedPrivateEvaluationBatchTransitionResult,
} from './internal/postgresGovernedPrivateEvaluationBatchRepository';
import { aflTradePrivatePreparedValuationDispatchAuthoritySchema } from './preparedValuationInputSet';

const idSchema = z.string().trim().min(1).max(400);
const blockerCodeSchema = z.enum([
  'source_blocked',
  'insufficient_data',
  'identity_unresolved',
  'lineage_unresolved',
  'model_not_approved',
  'reconciliation_failed',
  'engineering_unavailable',
  'component_output_unavailable',
  'unsupported_trade',
  'policy_unavailable',
  'temporal_evidence_unavailable',
]);
const requestSchema = z
  .object({
    scopeKey: idSchema,
    operationId: aflTradeContentAddressedIdSchema('private-evaluation-cohort-run'),
  })
  .strict();

const capturedEntrySchema = z.discriminatedUnion('state', [
  z.object({ tradeId: idSchema, state: z.literal('ready') }).strict(),
  z
    .object({
      tradeId: idSchema,
      state: z.literal('unavailable'),
      blockers: z
        .array(
          z
            .object({ code: blockerCodeSchema, message: z.string().trim().min(1).max(2_000) })
            .strict()
        )
        .min(1)
        .max(10_000),
    })
    .strict(),
]);

const capturedCommonShape = {
  scopeKey: idSchema,
  preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
  preparedInputSetRevision: z.number().int().positive(),
  factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
  modelQualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
  modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
  modelPairRevision: z.number().int().positive(),
  expectedBatchRevision: z.number().int().nonnegative(),
  entries: z.array(capturedEntrySchema).min(1).max(10_000),
  capturedAt: z.iso.datetime({ offset: true }),
} as const;

function refineCapturedEntries(
  capture: { readonly entries: readonly z.infer<typeof capturedEntrySchema>[] },
  context: z.RefinementCtx
): void {
  const ids = capture.entries.map(({ tradeId }) => tradeId);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => index > 0 && ids[index - 1]! > id)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: 'Cohort trades must be unique and ordered.',
    });
  }
}

const publicCapturedSchema = z
  .object({
    ...capturedCommonShape,
    factualReleaseRevision: z.number().int().positive(),
  })
  .strict()
  .superRefine(refineCapturedEntries);

const privateCapturedSchema = z
  .object({
    ...capturedCommonShape,
    preparationOperationId: aflTradeContentAddressedIdSchema(
      'valuation-cohort-preparation-operation'
    ),
    currentModelEvidenceOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-model-evidence-operation'
    ),
    dispatchAuthority: aflTradePrivatePreparedValuationDispatchAuthoritySchema,
  })
  .strict()
  .superRefine((capture, context) => {
    refineCapturedEntries(capture, context);
    if (
      capture.dispatchAuthority.requestId === '' ||
      capture.dispatchAuthority.factualOutputId === ''
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dispatchAuthority'],
        message: 'Private cohort dispatch authority must be complete.',
      });
    }
  });

const capturedSchema = z.union([publicCapturedSchema, privateCapturedSchema]);

type Request = z.infer<typeof requestSchema>;
type Capture = z.infer<typeof capturedSchema>;

export const aflTradePrivateEvaluationCohortUnexpectedDiagnosticsSchema = z
  .array(
    z
      .object({
        tradeId: idSchema,
        stage: z.literal('stage_automated'),
        name: z.string().trim().min(1).max(400),
        message: z.string().trim().min(1).max(4_000),
      })
      .strict()
  )
  .min(1)
  .max(10_000);

export type AflTradePrivateEvaluationCohortUnexpectedDiagnostic = z.infer<
  typeof aflTradePrivateEvaluationCohortUnexpectedDiagnosticsSchema
>[number];

export class AflTradePrivateEvaluationCohortStaleAuthorityError extends Error {}

function boundedDiagnosticField(value: unknown, fallback: string, maximumLength: number): string {
  const normalized = String(value).trim();
  const bounded = Array.from(normalized === '' ? fallback : normalized)
    .slice(0, maximumLength)
    .join('')
    .trim();
  return bounded === '' ? fallback : bounded;
}

type CurrentBatch = Readonly<{
  batch: GovernedPrivateEvaluationBatch;
  head: GovernedPrivateEvaluationBatchHead;
  authority:
    | Readonly<{ factualReleaseRevision: number; modelPairRevision: number }>
    | Readonly<{
        preparationOperationId: string;
        currentModelEvidenceOperationId: string;
        dispatchAuthority: z.infer<
          typeof aflTradePrivatePreparedValuationDispatchAuthoritySchema
        >;
        modelPairRevision: number;
      }>
    | null;
}>;

interface Dependencies {
  readonly maximumConcurrency?: number;
  readonly captureCurrent: (request: Request) => Promise<{
    readonly capture: Capture;
    readonly currentBatch: CurrentBatch | null;
  }>;
  readonly stageTrade: (input: {
    readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
    readonly operationId: string;
  }) => Promise<
    | Readonly<{ state: 'activated'; generationId: string; generatedAt: string }>
    | Readonly<{
        state: 'unavailable';
        blockers: readonly Readonly<{ code: string; message: string }>[];
      }>
    | Readonly<{ state: 'retry_pending'; availableAt: string }>
    | Readonly<{
        state: 'exhausted';
        stage: string;
        cause: Readonly<{ code: string; message: string }>;
      }>
    | Readonly<{ state: 'stale_authority' }>
  >;
  readonly retainUnexpectedDiagnostics: (input: {
    readonly request: Request;
    readonly capture: Capture;
    readonly diagnostics: readonly AflTradePrivateEvaluationCohortUnexpectedDiagnostic[];
  }) => Promise<void | readonly AflTradePrivateEvaluationCohortUnexpectedDiagnostic[]>;
  readonly registerBatch: (
    batch: GovernedPrivateEvaluationBatch
  ) => Promise<GovernedPrivateEvaluationBatch>;
  readonly advanceBatch: (input: {
    readonly scopeKey: string;
    readonly batchId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly action: 'activate';
    readonly cohortOperationId: string;
  }) => Promise<GovernedPrivateEvaluationBatchTransitionResult>;
}

export function createAflTradePrivateEvaluationCohortRunOperationId(
  input:
    | {
        readonly scopeKey: string;
        readonly preparedInputSetId: string;
        readonly preparedInputSetRevision: number;
        readonly modelQualificationWorkId: string;
        readonly factualReleaseRevision: number;
        readonly modelPairRevision: number;
        readonly expectedBatchRevision: number;
      }
    | {
        readonly scopeKey: string;
        readonly preparedInputSetId: string;
        readonly preparedInputSetRevision: number;
        readonly preparationOperationId: string;
        readonly currentModelEvidenceOperationId: string;
        readonly dispatchAuthority: z.input<
          typeof aflTradePrivatePreparedValuationDispatchAuthoritySchema
        >;
        readonly modelQualificationWorkId: string;
        readonly modelPairRevision: number;
        readonly expectedBatchRevision: number;
      }
): string {
  return createAflTradeContentAddress('private-evaluation-cohort-run', input);
}

function isAlreadyCurrent(capture: Capture, current: CurrentBatch | null): current is CurrentBatch {
  const exactAuthority =
    'dispatchAuthority' in capture
      ? current !== null &&
        current.authority !== null &&
        'dispatchAuthority' in current.authority &&
        current.authority.preparationOperationId === capture.preparationOperationId &&
        current.authority.currentModelEvidenceOperationId ===
          capture.currentModelEvidenceOperationId &&
        current.authority.dispatchAuthority.requestId === capture.dispatchAuthority.requestId &&
        current.authority.dispatchAuthority.factualOutputId ===
          capture.dispatchAuthority.factualOutputId &&
        current.authority.dispatchAuthority.hpnCalculationId ===
          capture.dispatchAuthority.hpnCalculationId &&
        current.authority.dispatchAuthority.modelOperationId ===
          capture.dispatchAuthority.modelOperationId
      : current !== null &&
        current.authority !== null &&
        'factualReleaseRevision' in current.authority &&
        current.authority.factualReleaseRevision === capture.factualReleaseRevision;
  return (
    current !== null &&
    current.head.revision === capture.expectedBatchRevision &&
    current.authority !== null &&
    exactAuthority &&
    current.authority.modelPairRevision === capture.modelPairRevision &&
    current.batch.content.scopeKey === capture.scopeKey &&
    current.batch.content.preparedInputSetId === capture.preparedInputSetId &&
    current.batch.content.preparedInputSetRevision === capture.preparedInputSetRevision &&
    current.batch.content.factualReleaseId === capture.factualReleaseId &&
    current.batch.content.modelQualificationId === capture.modelQualificationId &&
    current.batch.content.modelQualificationWorkId === capture.modelQualificationWorkId
  );
}

export function createAflTradePrivateEvaluationCohortRunner(dependencies: Dependencies) {
  const maximumConcurrency = dependencies.maximumConcurrency ?? 8;
  if (
    !Number.isSafeInteger(maximumConcurrency) ||
    maximumConcurrency < 1 ||
    maximumConcurrency > 32
  ) {
    throw new TypeError('Private evaluation cohort concurrency must be between 1 and 32.');
  }
  return {
    async run(unparsedRequest: Request) {
      const request = requestSchema.parse(unparsedRequest);
      const captured = await dependencies.captureCurrent(request);
      const capture = capturedSchema.parse(captured.capture);
      if (capture.scopeKey !== request.scopeKey) {
        throw new TypeError('Private evaluation cohort capture escaped its requested scope.');
      }
      const expectedOperationId = createAflTradePrivateEvaluationCohortRunOperationId({
        scopeKey: capture.scopeKey,
        preparedInputSetId: capture.preparedInputSetId,
        preparedInputSetRevision: capture.preparedInputSetRevision,
        ...('dispatchAuthority' in capture
          ? {
              preparationOperationId: capture.preparationOperationId,
              currentModelEvidenceOperationId: capture.currentModelEvidenceOperationId,
              dispatchAuthority: capture.dispatchAuthority,
              modelQualificationWorkId: capture.modelQualificationWorkId,
              modelPairRevision: capture.modelPairRevision,
            }
          : {
              modelQualificationWorkId: capture.modelQualificationWorkId,
              factualReleaseRevision: capture.factualReleaseRevision,
              modelPairRevision: capture.modelPairRevision,
            }),
        expectedBatchRevision: capture.expectedBatchRevision,
      });
      if (request.operationId !== expectedOperationId) {
        throw new TypeError(
          'Private evaluation cohort operation does not bind captured authority.'
        );
      }
      if (isAlreadyCurrent(capture, captured.currentBatch)) {
        return { state: 'already_current' as const, ...captured.currentBatch };
      }

      const diagnostics: AflTradePrivateEvaluationCohortUnexpectedDiagnostic[] = [];
      let stale = false;
      const pendingTradeIds: string[] = [];
      const exhaustedTradeIds: string[] = [];
      type CompletedEntry = Readonly<{
        entry: GovernedPrivateEvaluationBatch['content']['entries'][number];
        generatedAt: string | null;
      }> | null;
      const entries = new Array<CompletedEntry>(capture.entries.length);
      let nextIndex = 0;
      const attempt = async (entry: Capture['entries'][number]): Promise<CompletedEntry> => {
        if (entry.state === 'unavailable') {
          return {
            entry: {
              tradeId: entry.tradeId,
              state: 'unavailable' as const,
              blockers: entry.blockers,
            },
            generatedAt: null,
          };
        }
        try {
          const result = await dependencies.stageTrade({
            selector: { valuationScopeKey: capture.scopeKey, tradeId: entry.tradeId },
            operationId: createAflTradeContentAddress('private-evaluation-operation', {
              cohortOperationId: request.operationId,
              preparedInputSetId: capture.preparedInputSetId,
              tradeId: entry.tradeId,
            }),
          });
          if (result.state === 'activated') {
            const generatedAt = z.iso.datetime({ offset: true }).parse(result.generatedAt);
            return {
              entry: {
                tradeId: entry.tradeId,
                state: 'ready' as const,
                generationId: result.generationId,
              },
              generatedAt,
            };
          }
          if (result.state === 'stale_authority') {
            stale = true;
            return null;
          }
          if (result.state === 'retry_pending') {
            pendingTradeIds.push(entry.tradeId);
            return null;
          }
          if (result.state === 'exhausted') {
            exhaustedTradeIds.push(entry.tradeId);
            return null;
          }
          return {
            entry: {
              tradeId: entry.tradeId,
              state: 'unavailable' as const,
              blockers: result.blockers.map(({ code, message }) => ({
                code: blockerCodeSchema.parse(code),
                message,
              })),
            },
            generatedAt: null,
          };
        } catch (error) {
          diagnostics.push({
            tradeId: entry.tradeId,
            stage: 'stage_automated',
            name: boundedDiagnosticField(
              error instanceof Error ? error.name : 'NonErrorThrow',
              'Error',
              400
            ),
            message: boundedDiagnosticField(
              error instanceof Error ? error.message : error,
              'Unknown thrown value.',
              4_000
            ),
          });
          return null;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(maximumConcurrency, capture.entries.length) }, async () => {
          while (nextIndex < capture.entries.length) {
            const index = nextIndex++;
            entries[index] = await attempt(capture.entries[index]!);
          }
        })
      );

      diagnostics.sort((left, right) =>
        compareAflTradeCodeUnits(left.tradeId, right.tradeId)
      );
      if (diagnostics.length > 0) {
        const retained = await dependencies.retainUnexpectedDiagnostics({
          request,
          capture,
          diagnostics,
        });
        return {
          state: 'unexpected_failure' as const,
          diagnostics: retained ?? diagnostics,
        };
      }
      if (stale) {
        return { state: 'stale_authority' as const };
      }
      pendingTradeIds.sort();
      if (pendingTradeIds.length > 0) {
        return { state: 'retry_pending' as const, pendingTradeIds };
      }
      exhaustedTradeIds.sort();
      if (exhaustedTradeIds.length > 0) {
        return { state: 'exhausted' as const, exhaustedTradeIds };
      }
      if (entries.some((entry) => entry === null)) {
        return { state: 'stale_authority' as const };
      }
      const completed = entries.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null
      );
      const createdAt = completed.reduce(
        (latest, completedEntry) =>
          completedEntry.generatedAt !== null &&
          Date.parse(completedEntry.generatedAt) > Date.parse(latest)
            ? completedEntry.generatedAt
            : latest,
        capture.capturedAt
      );
      const batch = createGovernedPrivateEvaluationBatch({
        scopeKey: capture.scopeKey,
        preparedInputSetId: capture.preparedInputSetId,
        preparedInputSetRevision: capture.preparedInputSetRevision,
        factualReleaseId: capture.factualReleaseId,
        modelQualificationId: capture.modelQualificationId,
        modelQualificationWorkId: capture.modelQualificationWorkId,
        entries: completed.map(({ entry }) => entry),
        createdAt,
      });
      try {
        const retained = governedPrivateEvaluationBatchSchema.parse(
          await dependencies.registerBatch(batch)
        );
        const transition = await dependencies.advanceBatch({
          scopeKey: capture.scopeKey,
          batchId: retained.batchId,
          expectedRevision: capture.expectedBatchRevision,
          operationId: createGovernedPrivateEvaluationBatchOperationId({
            scopeKey: capture.scopeKey,
            batchId: retained.batchId,
            expectedRevision: capture.expectedBatchRevision,
            action: 'activate',
          }),
          action: 'activate',
          cohortOperationId: request.operationId,
        });
        return { state: 'activated' as const, batch: retained, transition };
      } catch (error) {
        if (error instanceof AflTradePrivateEvaluationCohortStaleAuthorityError) {
          return { state: 'stale_authority' as const };
        }
        throw error;
      }
    },
  };
}
