import { z } from 'zod';

export const pickCustodyDateSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.object({ precision: z.literal('day'), date: z.iso.date() }).strict(),
  z.object({ precision: z.literal('year'), year: z.number().int().min(1988).max(2200) }).strict(),
]);

/** Database columns distinguish an observed instant from a historical day or year. */
export function pickCustodyDateColumns(input: unknown) {
  const value = pickCustodyDateSchema.parse(input);
  return typeof value === 'string'
    ? { observedAt: value, observedDate: null }
    : { observedAt: null, observedDate: value };
}

/** Capture provenance follows the observed movement, independently of the pick's draft year. */
export function pickCustodyObservationYear(input: unknown): number {
  const value = pickCustodyDateSchema.parse(input);
  if (typeof value === 'string') return new Date(value).getUTCFullYear();
  return value.precision === 'year' ? value.year : Number(value.date.slice(0, 4));
}

/** The span an observation covers, in ms: an instant, or the whole of a recorded day or year. */
function observedSpan(
  observedAt: z.infer<typeof pickCustodyDateSchema>
): readonly [number, number] {
  if (typeof observedAt === 'string') {
    const at = Date.parse(observedAt);
    return [at, at];
  }
  if (observedAt.precision === 'day') {
    const start = Date.parse(`${observedAt.date}T00:00:00.000Z`);
    return [start, start + 86_400_000 - 1];
  }
  return [Date.UTC(observedAt.year, 0, 1), Date.UTC(observedAt.year + 1, 0, 1) - 1];
}

/** The one row observed strictly after every other; none when the latest observations overlap. */
export function latestPickCustodyObservation<
  Row extends { observedAt: z.infer<typeof pickCustodyDateSchema> },
>(rows: readonly Row[]): Row | undefined {
  const spans = rows.map((row) => [row, observedSpan(row.observedAt)] as const);
  const latest = spans.filter(([row, [start]]) =>
    spans.every(([other, [, end]]) => other === row || start > end)
  );
  return latest.length === 1 ? latest[0]![0] : undefined;
}
