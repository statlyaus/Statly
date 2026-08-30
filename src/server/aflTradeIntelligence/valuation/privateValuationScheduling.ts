import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_TIME_ZONE = 'Australia/Melbourne' as const;
export const AFL_TRADE_PRIVATE_VALUATION_SCHEDULE = {
  weekday: 1,
  hour: 19,
  minute: 0,
} as const;

const instantSchema = z.string().datetime({ offset: true });
const boundedIdSchema = z.string().trim().min(1).max(400);

export const aflTradePrivateValuationDispatchTriggerSchema = z.enum([
  'weekly',
  'model_qualified',
  'ad_hoc',
]);

export type AflTradePrivateValuationDispatchTrigger = z.infer<
  typeof aflTradePrivateValuationDispatchTriggerSchema
>;

export const aflTradePrivateValuationDispatchRequestSchema = z
  .object({
    requestId: z.string().regex(/^private-valuation-dispatch:[a-f0-9]{64}$/),
    scopeKey: boundedIdSchema,
    trigger: aflTradePrivateValuationDispatchTriggerSchema,
    scheduledFor: instantSchema,
    authorityKey: boundedIdSchema,
  })
  .strict();

function localMonday(date: Date): Date {
  const localDate = formatInTimeZone(date, AFL_TRADE_PRIVATE_VALUATION_TIME_ZONE, 'yyyy-MM-dd');
  const localMidnight = new Date(`${localDate}T00:00:00.000Z`);
  const weekday = Number(
    formatInTimeZone(date, AFL_TRADE_PRIVATE_VALUATION_TIME_ZONE, 'i')
  );
  localMidnight.setUTCDate(localMidnight.getUTCDate() - (weekday - 1));
  return localMidnight;
}

export function latestDueAflTradePrivateValuationOccurrence(now: string): string {
  const parsedNow = new Date(instantSchema.parse(now));
  const monday = localMonday(parsedNow);
  let occurrence = fromZonedTime(
    `${monday.toISOString().slice(0, 10)} 19:00:00.000`,
    AFL_TRADE_PRIVATE_VALUATION_TIME_ZONE
  );
  if (occurrence.getTime() > parsedNow.getTime()) {
    monday.setUTCDate(monday.getUTCDate() - 7);
    occurrence = fromZonedTime(
      `${monday.toISOString().slice(0, 10)} 19:00:00.000`,
      AFL_TRADE_PRIVATE_VALUATION_TIME_ZONE
    );
  }
  return occurrence.toISOString();
}

export function planAflTradePrivateValuationStartupCatchUp(input: {
  readonly now: string;
  readonly lastScheduledFor: string | null;
}): string | null {
  const latest = latestDueAflTradePrivateValuationOccurrence(input.now);
  if (
    input.lastScheduledFor !== null &&
    Date.parse(instantSchema.parse(input.lastScheduledFor)) >= Date.parse(latest)
  ) {
    return null;
  }
  return latest;
}

export function createAflTradePrivateValuationDispatchRequestId(input: {
  readonly scopeKey: string;
  readonly trigger: AflTradePrivateValuationDispatchTrigger;
  readonly scheduledFor: string;
  readonly authorityKey: string;
}): string {
  const parsed = {
    scopeKey: boundedIdSchema.parse(input.scopeKey),
    trigger: aflTradePrivateValuationDispatchTriggerSchema.parse(input.trigger),
    scheduledFor: instantSchema.parse(input.scheduledFor),
    authorityKey: boundedIdSchema.parse(input.authorityKey),
  };
  return createAflTradeContentAddress('private-valuation-dispatch', parsed);
}

export function createAflTradePrivateValuationDispatchEvidenceKey(
  request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>
): string {
  return aflTradePrivateValuationDispatchRequestSchema.parse(request).requestId;
}
