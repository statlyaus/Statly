import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { draftSessionDateWindowSchema } from './draftSessionDatePrecision';
const refs = z
  .array(aflTradeArtifactRefSchema)
  .min(1)
  .max(50)
  .refine(
    (values) =>
      values.every(
        (value, index) => index === 0 || values[index - 1]!.artifactId < value.artifactId
      ),
    'Evidence must be unique and sorted.'
  );
const entryBase = z.object({
  promotionId: aflTradeContentAddressedIdSchema('external-canonical-promotion'),
  eventVersionId: z.string().min(1),
  assetVersionId: z.string().min(1),
  evidence: refs,
});
export const canonicalDepartureAcquisitionSchema = z.union([
  entryBase.extend({ eventDate: z.iso.date() }).strict(),
  entryBase.extend({ eventDate: z.null(), datePrecision: draftSessionDateWindowSchema }).strict(),
]);
const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-canonical-player-departure/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.literal('AFLM'),
    playerId: z.string().min(1).max(240),
    fromClubId: z.string().min(1).max(240),
    toClubId: z.null(),
    acquisition: canonicalDepartureAcquisitionSchema,
    departureYear: z.number().int().min(1897).max(2200),
    reason: z.enum(['delisting', 'contract_release', 'resignation']),
    recordedPlayer: z.string().trim().min(1).max(500),
    recordedClub: z.string().trim().min(1).max(500),
    sourceEvidenceId: aflTradeContentAddressedIdSchema('external-evidence'),
    sourceBatchId: aflTradeContentAddressedIdSchema('external-evidence-batch'),
    evidence: refs.length(1),
    createdAt: z.string().datetime({ precision: 3 }).regex(/Z$/),
  })
  .strict()
  .superRefine((c, ctx) => {
    const entryLast = c.acquisition.eventDate ?? c.acquisition.datePrecision.latestDate;
    if (
      entryLast >= `${c.departureYear}-01-01` ||
      `${c.departureYear}-12-31` > c.createdAt.slice(0, 10) ||
      [...c.evidence, ...c.acquisition.evidence].some(
        (r) => Date.parse(r.createdAt) > Date.parse(c.createdAt)
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Departure chronology or evidence time is invalid.',
      });
  });
export const canonicalPlayerDepartureSchema = z
  .object({
    departureEventId: aflTradeContentAddressedIdSchema('canonical-player-departure'),
    content: contentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    if (
      record.departureEventId !==
      createAflTradeContentAddress('canonical-player-departure', record.content)
    )
      ctx.addIssue({ code: 'custom', message: 'Departure content address differs.' });
  });
export type CanonicalPlayerDeparture = z.infer<typeof canonicalPlayerDepartureSchema>;
export function createCanonicalPlayerDeparture(
  input: Omit<z.input<typeof contentSchema>, 'schemaVersion'>
): CanonicalPlayerDeparture {
  const content = contentSchema.parse({
    ...input,
    schemaVersion: 'afl-trade-canonical-player-departure/v1',
  });
  return canonicalPlayerDepartureSchema.parse({
    departureEventId: createAflTradeContentAddress('canonical-player-departure', content),
    content,
  });
}
export const canonicalDepartureSpellBindingSchema = z
  .object({
    departureEventId: aflTradeContentAddressedIdSchema('canonical-player-departure'),
    eventDate: z.null(),
    datePrecision: draftSessionDateWindowSchema,
    evidence: refs,
  })
  .strict();
/** Date bounds express recorded year precision, not a substituted departure day. */
export function canonicalDepartureSpellBinding(record: CanonicalPlayerDeparture) {
  const parsed = canonicalPlayerDepartureSchema.parse(record);
  const year = parsed.content.departureYear;
  return canonicalDepartureSpellBindingSchema.parse({
    departureEventId: parsed.departureEventId,
    eventDate: null,
    datePrecision: {
      precision: 'window',
      eventDate: null,
      earliestDate: `${year}-01-01`,
      latestDate: `${year}-12-31`,
    },
    evidence: parsed.content.evidence,
  });
}
