import type { AflTradeExternalProviderIngestionResult } from './externalDraftTradeProviderIngestion';
import type {
  ClaimAflTradeExternalCaptureOccurrenceInput,
  CompleteAflTradeExternalCaptureOccurrenceInput,
} from './postgresExternalDraftTradeScheduleRepository';

export interface AflTradeExternalCaptureScheduleRunnerRepository {
  claim(input: ClaimAflTradeExternalCaptureOccurrenceInput): Promise<{
    action:
      | 'claim'
      | 'deduplicate'
      | 'not_due'
      | 'skip_late'
      | 'defer_lease'
      | 'defer_retry'
      | 'defer_circuit'
      | 'dead_letter';
    retryAt: string | null;
    proposedClaim: CompleteAflTradeExternalCaptureOccurrenceInput['claim'] | null;
    command: Parameters<AflTradeExternalCaptureScheduleRunnerDependencies['ingest']>[0] | null;
  }>;
  complete(input: CompleteAflTradeExternalCaptureOccurrenceInput): Promise<void>;
}

export interface AflTradeExternalCaptureScheduleRunnerDependencies {
  repository: AflTradeExternalCaptureScheduleRunnerRepository;
  clock: { now(): string };
  ingest(
    command: import('./externalDraftTradeProviderIngestion').AflTradeExternalProviderIngestionCommand
  ): Promise<AflTradeExternalProviderIngestionResult>;
}

export type AflTradeExternalCaptureScheduleRunResult =
  | {
      status: 'not_run';
      action: Exclude<
        Awaited<ReturnType<AflTradeExternalCaptureScheduleRunnerRepository['claim']>>['action'],
        'claim'
      >;
      retryAt: string | null;
    }
  | {
      status: 'completed';
      captureStatus: 'staged' | 'not_modified';
      resultId: string;
    }
  | { status: 'retry_scheduled'; failureCode: string };

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
  return 'UNEXPECTED_CAPTURE_FAILURE';
}

export async function runScheduledAflTradeExternalCapture(
  input: ClaimAflTradeExternalCaptureOccurrenceInput,
  dependencies: AflTradeExternalCaptureScheduleRunnerDependencies
): Promise<AflTradeExternalCaptureScheduleRunResult> {
  const decision = await dependencies.repository.claim(input);
  if (decision.action !== 'claim' || decision.proposedClaim === null || decision.command === null) {
    return {
      status: 'not_run',
      action: decision.action as Exclude<typeof decision.action, 'claim'>,
      retryAt: decision.retryAt,
    };
  }

  const claim = decision.proposedClaim;
  try {
    const ingestion = await dependencies.ingest(decision.command);
    const completedAt = dependencies.clock.now();
    if (ingestion.status === 'deferred') {
      const failureCode = 'PROVIDER_ADMISSION_DEFERRED';
      await dependencies.repository.complete({
        claim,
        completedAt,
        outcome: { status: 'failed', failureCode },
      });
      return { status: 'retry_scheduled', failureCode };
    }
    const result = ingestion.result;
    const resultId = result.status === 'not_modified' ? result.attemptId : result.batchId;
    await dependencies.repository.complete({
      claim,
      completedAt,
      outcome: {
        status: result.status === 'not_modified' ? 'not_modified' : 'completed',
        resultId,
      },
    });
    return { status: 'completed', captureStatus: result.status, resultId };
  } catch (error) {
    const failureCode = boundedFailureCode(error);
    await dependencies.repository.complete({
      claim,
      completedAt: dependencies.clock.now(),
      outcome: { status: 'failed', failureCode },
    });
    return { status: 'retry_scheduled', failureCode };
  }
}
