import { z } from 'zod';

import type { AflTradeExternalCaptureScheduleRunResult } from './externalDraftTradeScheduledRunner';
import type {
  DueAflTradeExternalCaptureOccurrence,
  ListDueAflTradeExternalCaptureOccurrencesInput,
} from './postgresExternalDraftTradeScheduleRepository';

const isoInstantSchema = z.iso.datetime({ offset: true });
const scheduleIdSchema = z.string().regex(/^external-capture-schedule:[a-f0-9]{64}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const dispatchInputSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    observedAt: isoInstantSchema,
    workerId: z.string().trim().min(1).max(240),
    maximumOccurrences: z.number().int().min(1).max(1_000),
  })
  .strict();

const dueOccurrenceSchema = z
  .object({ scheduleId: scheduleIdSchema, dueAt: isoInstantSchema })
  .strict();

export type AflTradeExternalCaptureDispatchResult =
  | (DueAflTradeExternalCaptureOccurrence & {
      status: 'completed';
      result: AflTradeExternalCaptureScheduleRunResult;
    })
  | (DueAflTradeExternalCaptureOccurrence & {
      status: 'dispatch_failed';
      failureCode: string;
    });

export interface AflTradeExternalCaptureDispatcherDependencies {
  repository: {
    listDue(
      input: ListDueAflTradeExternalCaptureOccurrencesInput
    ): Promise<DueAflTradeExternalCaptureOccurrence[]>;
  };
  createLeaseTokenSha256(): string;
  runOccurrence(input: {
    scheduleId: string;
    dueAt: string;
    observedAt: string;
    workerId: string;
    leaseTokenSha256: string;
  }): Promise<AflTradeExternalCaptureScheduleRunResult>;
}

function boundedFailureCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'UNEXPECTED_DISPATCH_FAILURE';
}

export async function dispatchDueAflTradeExternalCaptures(
  unparsedInput: {
    environment: 'test_fixture' | 'non_production' | 'production';
    observedAt: string;
    workerId: string;
    maximumOccurrences: number;
  },
  dependencies: AflTradeExternalCaptureDispatcherDependencies
) {
  const input = dispatchInputSchema.parse(unparsedInput);
  const selected = z
    .array(dueOccurrenceSchema)
    .max(input.maximumOccurrences)
    .parse(
      await dependencies.repository.listDue({
        environment: input.environment,
        observedAt: input.observedAt,
        limit: input.maximumOccurrences,
      })
    );
  const results: AflTradeExternalCaptureDispatchResult[] = [];
  for (const occurrence of selected) {
    try {
      const leaseTokenSha256 = sha256Schema.parse(dependencies.createLeaseTokenSha256());
      const result = await dependencies.runOccurrence({
        ...occurrence,
        observedAt: input.observedAt,
        workerId: input.workerId,
        leaseTokenSha256,
      });
      results.push({ ...occurrence, status: 'completed', result });
    } catch (error) {
      results.push({
        ...occurrence,
        status: 'dispatch_failed',
        failureCode: boundedFailureCode(error),
      });
    }
  }
  return {
    observedAt: input.observedAt,
    selectedCount: selected.length,
    saturated: selected.length === input.maximumOccurrences,
    results,
  };
}
