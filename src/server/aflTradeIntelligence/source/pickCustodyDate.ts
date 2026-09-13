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
