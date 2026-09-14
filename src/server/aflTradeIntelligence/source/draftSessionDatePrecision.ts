import { z } from 'zod';

/** Bounds describe when a selection happened, never a substituted event day. */
export const draftSessionDateWindowSchema = z.object({
  precision: z.literal('window'),
  eventDate: z.null(),
  earliestDate: z.iso.date(),
  latestDate: z.iso.date(),
}).strict().superRefine((value, context) => {
  if (value.earliestDate >= value.latestDate ||
      value.earliestDate.slice(0, 4) !== value.latestDate.slice(0, 4)) {
    context.addIssue({ code: 'custom', message: 'A session window requires distinct ordered dates within one draft year.' });
  }
});

export const draftSessionDatePrecisionSchema = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('day'), eventDate: z.iso.date() }).strict(),
  draftSessionDateWindowSchema,
]);

export type DraftSessionDatePrecision = z.infer<typeof draftSessionDatePrecisionSchema>;

export function parseDraftSessionDatePrecision(input: unknown, draftYear: number): DraftSessionDatePrecision {
  const value = draftSessionDatePrecisionSchema.parse(input);
  const first = value.precision === 'day' ? value.eventDate : value.earliestDate;
  if (!Number.isInteger(draftYear) || draftYear < 1897 || draftYear > 2200 ||
      Number(first.slice(0, 4)) !== draftYear) {
    throw new TypeError('Session date precision must belong to the stated draft year.');
  }
  return value;
}

/** Only non-overlapping bounds establish strict chronology; overlap does not prove order. */
export function draftSessionDefinitelyPrecedes(
  earlier: DraftSessionDatePrecision,
  later: DraftSessionDatePrecision
): boolean {
  const left = draftSessionDatePrecisionSchema.parse(earlier);
  const right = draftSessionDatePrecisionSchema.parse(later);
  const lastPossible = left.precision === 'day' ? left.eventDate : left.latestDate;
  const firstPossible = right.precision === 'day' ? right.eventDate : right.earliestDate;
  return lastPossible < firstPossible;
}
