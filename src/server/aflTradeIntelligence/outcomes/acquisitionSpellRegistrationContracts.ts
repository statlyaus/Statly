import { canonicalDepartureSpellBindingSchema } from '../source/canonicalPlayerDeparture';
import { draftSessionDateWindowSchema } from '../source/draftSessionDatePrecision';
import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const id = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const instant = z.string().datetime({ precision: 3 }).regex(/Z$/);
const scope = {
  environment: z.enum(['test_fixture', 'non_production']),
  competition: z.enum(['AFLM', 'AFLW']),
};
const evidence = z
  .array(aflTradeArtifactRefSchema)
  .min(1)
  .max(50)
  .refine(
    (refs) =>
      refs.every((ref, index) => index === 0 || refs[index - 1]!.artifactId < ref.artifactId),
    'Evidence must be unique and ordered by artifact ID.'
  );
const ruleContent = z
  .object({
    schemaVersion: z.literal('afl-trade-acquisition-registration-rule/v1'),
    ...scope,
    ruleVersion: id,
    entry: z.literal('exact_promoted_incoming_player_asset_on_event_date'),
    departure: z.literal('exact_reviewed_departure_event_day_excluded'),
    intervals: z.literal('inclusive_start_inclusive_end_no_same_club_overlap'),
    missingEvidence: z.literal('reject_never_infer_from_appearances'),
    evidence,
    createdAt: instant,
  })
  .strict();

const windowRuleContent = ruleContent.extend({
  schemaVersion: z.literal('afl-trade-acquisition-registration-rule/v2'),
  entry: z.literal('reviewed_incoming_asset_with_explicit_date_precision'),
  departure: z.literal('reviewed_departure_bounds_day_excluded'),
  intervals: z.literal('possible_and_certain_membership_no_inferred_boundary_days'),
});

export const aflTradeAcquisitionSpellRegistrationRuleSchema = z
  .object({
    ruleId: aflTradeContentAddressedIdSchema('acquisition-spell-rule'),
    content: z.union([ruleContent, windowRuleContent]),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.content.evidence.some(
        (ref) => Date.parse(ref.createdAt) > Date.parse(record.content.createdAt)
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Rule predates its evidence.' });
    }
    if (record.ruleId !== createAflTradeContentAddress('acquisition-spell-rule', record.content)) {
      context.addIssue({
        code: 'custom',
        path: ['ruleId'],
        message: 'Rule content address differs.',
      });
    }
  });

const event = z
  .object({
    promotionId: aflTradeContentAddressedIdSchema('external-canonical-promotion'),
    eventVersionId: id,
    assetVersionId: id,
    eventDate: z.string().date(),
    evidence,
  })
  .strict();
const spellContent = z
  .object({
    schemaVersion: z.literal('afl-trade-acquisition-registration/v1'),
    ...scope,
    playerId: id,
    clubId: id,
    entry: event,
    departure: event.nullable(),
    ruleId: aflTradeContentAddressedIdSchema('acquisition-spell-rule'),
    version: z.number().int().positive(),
    supersedesSpellVersionId: aflTradeContentAddressedIdSchema(
      'acquisition-spell-version'
    ).nullable(),
    observedThrough: z.string().date(),
    continuityEvidence: evidence,
    createdAt: instant,
  })
  .strict();

const windowEvent = event.extend({
  eventDate: z.null(),
  datePrecision: draftSessionDateWindowSchema,
});
const precisionEvent = z.union([event, windowEvent]);
const windowSpellContent = spellContent.extend({
  schemaVersion: z.literal('afl-trade-acquisition-registration/v2'),
  entry: precisionEvent,
  departure: z.union([precisionEvent, canonicalDepartureSpellBindingSchema]).nullable(),
});

function eventBounds(
  value: z.infer<typeof precisionEvent> | z.infer<typeof canonicalDepartureSpellBindingSchema>
) {
  return value.eventDate === null
    ? { earliest: value.datePrecision.earliestDate, latest: value.datePrecision.latestDate }
    : { earliest: value.eventDate, latest: value.eventDate };
}

export const aflTradeAcquisitionSpellRegistrationSchema = z
  .object({
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    content: z.union([spellContent, windowSpellContent]),
  })
  .strict()
  .superRefine((record, context) => {
    const c = record.content;
    const entry = eventBounds(c.entry);
    const departure = c.departure === null ? null : eventBounds(c.departure);
    if (
      c.schemaVersion === 'afl-trade-acquisition-registration/v2' &&
      c.entry.eventDate !== null &&
      (c.departure === null || c.departure.eventDate !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Window registration v2 requires explicit uncertain event precision.',
      });
    }
    const refs = [...c.entry.evidence, ...c.continuityEvidence, ...(c.departure?.evidence ?? [])];
    if (
      entry.latest > c.observedThrough ||
      c.observedThrough > c.createdAt.slice(0, 10) ||
      (departure !== null &&
        (departure.earliest <= entry.latest || departure.latest > c.observedThrough)) ||
      (c.version === 1) !== (c.supersedesSpellVersionId === null) ||
      refs.some((ref) => Date.parse(ref.createdAt) > Date.parse(c.createdAt))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Spell chronology or version ancestry is invalid.',
      });
    }
    if (
      record.spellVersionId !==
      createAflTradeContentAddress('acquisition-spell-version', record.content)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['spellVersionId'],
        message: 'Spell content address differs.',
      });
    }
  });

export type AflTradeAcquisitionSpellRegistrationRule = z.infer<
  typeof aflTradeAcquisitionSpellRegistrationRuleSchema
>;
export type AflTradeAcquisitionSpellRegistration = z.infer<
  typeof aflTradeAcquisitionSpellRegistrationSchema
>;

export function createAflTradeAcquisitionSpellRegistrationRule(
  input: Omit<
    z.input<typeof ruleContent>,
    'schemaVersion' | 'entry' | 'departure' | 'intervals' | 'missingEvidence'
  >
): AflTradeAcquisitionSpellRegistrationRule {
  const content = ruleContent.parse({
    ...input,
    schemaVersion: 'afl-trade-acquisition-registration-rule/v1',
    entry: 'exact_promoted_incoming_player_asset_on_event_date',
    departure: 'exact_reviewed_departure_event_day_excluded',
    intervals: 'inclusive_start_inclusive_end_no_same_club_overlap',
    missingEvidence: 'reject_never_infer_from_appearances',
  });
  return aflTradeAcquisitionSpellRegistrationRuleSchema.parse({
    ruleId: createAflTradeContentAddress('acquisition-spell-rule', content),
    content,
  });
}

export function createAflTradeAcquisitionSpellRegistration(
  input: Omit<z.input<typeof spellContent>, 'schemaVersion'>
): AflTradeAcquisitionSpellRegistration & { content: z.infer<typeof spellContent> } {
  const content = spellContent.parse({
    ...input,
    schemaVersion: 'afl-trade-acquisition-registration/v1',
  });
  const registration = aflTradeAcquisitionSpellRegistrationSchema.parse({
    spellVersionId: createAflTradeContentAddress('acquisition-spell-version', content),
    content,
  });
  return { ...registration, content };
}

export function createAflTradeWindowAcquisitionSpellRegistrationRule(
  input: Omit<
    z.input<typeof windowRuleContent>,
    'schemaVersion' | 'entry' | 'departure' | 'intervals' | 'missingEvidence'
  >
): AflTradeAcquisitionSpellRegistrationRule {
  const content = windowRuleContent.parse({
    ...input,
    schemaVersion: 'afl-trade-acquisition-registration-rule/v2',
    entry: 'reviewed_incoming_asset_with_explicit_date_precision',
    departure: 'reviewed_departure_bounds_day_excluded',
    intervals: 'possible_and_certain_membership_no_inferred_boundary_days',
    missingEvidence: 'reject_never_infer_from_appearances',
  });
  return aflTradeAcquisitionSpellRegistrationRuleSchema.parse({
    ruleId: createAflTradeContentAddress('acquisition-spell-rule', content),
    content,
  });
}

export function createAflTradeWindowAcquisitionSpellRegistration(
  input: Omit<z.input<typeof windowSpellContent>, 'schemaVersion'>
): AflTradeAcquisitionSpellRegistration {
  const content = windowSpellContent.parse({
    ...input,
    schemaVersion: 'afl-trade-acquisition-registration/v2',
  });
  return aflTradeAcquisitionSpellRegistrationSchema.parse({
    spellVersionId: createAflTradeContentAddress('acquisition-spell-version', content),
    content,
  });
}

/** Logical membership bounds from reviewed dates and continuity; does not grant source authority. */
export function deriveAflTradeAcquisitionMembershipBounds(input: unknown) {
  const { content } = aflTradeAcquisitionSpellRegistrationSchema.parse(input);
  const entry = eventBounds(content.entry);
  const departure = content.departure === null ? null : eventBounds(content.departure);
  const previousDay = (date: string) =>
    new Date(Date.parse(date + 'T00:00:00.000Z') - 86400000).toISOString().slice(0, 10);
  return {
    exactStartDate: content.entry.eventDate,
    exactEndDate: content.departure?.eventDate ? previousDay(content.departure.eventDate) : null,
    observedThrough: content.observedThrough,
    possible: {
      startDate: entry.earliest,
      endDate: departure ? previousDay(departure.latest) : content.observedThrough,
    },
    certain: {
      startDate: entry.latest,
      endDate: departure ? previousDay(departure.earliest) : content.observedThrough,
    },
  };
}
