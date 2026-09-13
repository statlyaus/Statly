import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import { specialDraftEntitlementSchema } from './specialDraftEntitlement';

const id = z.string().trim().min(1);
const instant = z.iso.datetime({ offset: true });
const eventDate = z.union([
  instant,
  z.object({ precision: z.literal('day'), date: z.iso.date() }).strict(),
  z.object({ precision: z.literal('year'), year: z.number().int().min(1988).max(2200) }).strict(),
]);

/** Bounds are used for consistency checks only, never persisted as invented event times. */
export function specialEntitlementDateBounds(value: z.infer<typeof eventDate>) {
  if (typeof value === 'string') {
    const at = Date.parse(value);
    return {
      earliest: at,
      latest: at,
      year: new Date(at).getUTCFullYear(),
      day: new Date(at).toISOString().slice(0, 10),
    };
  }
  if (value.precision === 'day') {
    const start = Date.parse(`${value.date}T00:00:00.000Z`);
    return {
      earliest: start,
      latest: start + 86_400_000 - 1,
      year: Number(value.date.slice(0, 4)),
      day: value.date,
    };
  }
  return {
    earliest: Date.UTC(value.year, 0, 1),
    latest: Date.UTC(value.year + 1, 0, 1) - 1,
    year: value.year,
    day: null,
  };
}
const evidence = z
  .object({
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    contentSha256: aflTradeSha256Schema,
    sourceUrl: z.url(),
  })
  .strict();
const event = z.object({
  entitlementId: id,
  occurredAt: eventDate,
  evidence: z.array(evidence).min(1),
});

export const specialEntitlementLinkInputSchema = z
  .object({
    asset: specialDraftEntitlementSchema,
    award: event.extend({ component: id, holderClubId: id }).strict(),
    activation: event
      .extend({ draftYear: z.number().int().min(1988).max(2200) })
      .strict()
      .nullable()
      .optional(),
    custody: z
      .array(
        event
          .extend({
            transferId: id,
            fromClubId: id,
            toClubId: id,
          })
          .strict()
      )
      .min(1),
    renumbering: z
      .array(
        event
          .extend({
            transferId: id,
            sourcePickId: aflTradeContentAddressedIdSchema('draft-pick'),
            targetPickId: aflTradeContentAddressedIdSchema('draft-pick'),
          })
          .strict()
      )
      .max(10000)
      .optional(),
    selection: event
      .extend({
        draftYear: z.number().int().min(1988).max(2200),
        draftType: z.enum(['national', 'mini_draft']),
        selectionNumber: z.number().int().positive(),
        clubId: id,
        playerId: id,
      })
      .strict(),
  })
  .strict();

type LinkBundle = z.infer<typeof specialEntitlementLinkInputSchema>;
type LinkEvent = z.infer<typeof event>;

function validateAwardAndSelection(
  bundle: LinkBundle,
  events: readonly LinkEvent[],
  issues: Set<string>
): void {
  const { asset, award, activation, selection } = bundle;
  if (asset.entitlementType === 'expansion_compensation' && !activation)
    issues.add('missing_applicable_activation');
  if (events.some((item) => item.entitlementId !== award.entitlementId)) {
    issues.add('entitlement_identity_mismatch');
  }
  // Source component is retained verbatim; CMP labels are not interpreted as AFL bands.
  if (award.component !== asset.sourceLabel) issues.add('award_component_mismatch');
  if (
    (activation && activation.draftYear !== selection.draftYear) ||
    (asset.draftYear !== null && asset.draftYear !== selection.draftYear)
  ) {
    issues.add('exercise_year_mismatch');
  }
  if (
    (asset.entitlementType === 'mini_draft') !== (selection.draftType === 'mini_draft') ||
    (asset.entitlementType === 'mini_draft' && asset.selectionOrdinal !== selection.selectionNumber)
  ) {
    issues.add('selection_kind_or_ordinal_mismatch');
  }
  validateLinkChronology(bundle, issues);
}

function validateLinkChronology(bundle: LinkBundle, issues: Set<string>): void {
  const { award, activation, selection } = bundle;
  const awardDate = specialEntitlementDateBounds(award.occurredAt);
  const activationDate = activation ? specialEntitlementDateBounds(activation.occurredAt) : null;
  const selectionDate = specialEntitlementDateBounds(selection.occurredAt);
  if (
    selectionDate.year !== selection.draftYear ||
    (activationDate && activationDate.latest < awardDate.earliest) ||
    Math.max(activationDate?.earliest ?? awardDate.earliest, awardDate.earliest) >
      selectionDate.latest
  ) {
    issues.add('activation_or_selection_chronology_invalid');
  }
}

function validateCustodyChain(bundle: LinkBundle, issues: Set<string>): void {
  const { award, custody, selection } = bundle;
  const awardDate = specialEntitlementDateBounds(award.occurredAt);
  const selectionDate = specialEntitlementDateBounds(selection.occurredAt);
  let holder = award.holderClubId;
  let earliestPossibleAt = awardDate.earliest;
  const transferIds = new Set<string>();
  for (const transfer of custody) {
    if (transferIds.has(transfer.transferId)) issues.add('duplicate_transfer');
    transferIds.add(transfer.transferId);
    if (transfer.fromClubId !== holder || transfer.fromClubId === transfer.toClubId) {
      issues.add('custody_discontinuity');
    }
    const transferDate = specialEntitlementDateBounds(transfer.occurredAt);
    earliestPossibleAt = Math.max(earliestPossibleAt, transferDate.earliest);
    if (earliestPossibleAt > transferDate.latest || earliestPossibleAt > selectionDate.latest) {
      issues.add('custody_chronology_invalid');
    }
    holder = transfer.toClubId;
  }
  if (holder !== selection.clubId) issues.add('selection_holder_mismatch');
}

function validateRenumbering(bundle: LinkBundle, issues: Set<string>): void {
  const seen = new Set<string>();
  const targets = new Map<string, string>();
  const selectionDate = specialEntitlementDateBounds(bundle.selection.occurredAt);
  for (const binding of bundle.renumbering ?? []) {
    const custody = bundle.custody.find((edge) => edge.transferId === binding.transferId);
    if (!custody || seen.has(binding.transferId) || binding.sourcePickId === binding.targetPickId) {
      issues.add('renumbering_binding_invalid');
    }
    seen.add(binding.transferId);
    const prior = targets.get(binding.sourcePickId);
    if (prior !== undefined && prior !== binding.targetPickId)
      issues.add('renumbering_successor_conflict');
    targets.set(binding.sourcePickId, binding.targetPickId);
    const date = specialEntitlementDateBounds(binding.occurredAt);
    if (
      date.year !== bundle.selection.draftYear ||
      date.earliest > selectionDate.latest ||
      (custody && date.latest < specialEntitlementDateBounds(custody.occurredAt).earliest)
    ) {
      issues.add('renumbering_chronology_invalid');
    }
  }
}

function validateCaptureBindings(events: readonly LinkEvent[], issues: Set<string>): void {
  const captureBindings = new Map<string, string>();
  for (const item of events) {
    for (const reference of item.evidence) {
      const binding = JSON.stringify([reference.contentSha256, reference.sourceUrl]);
      const previous = captureBindings.get(reference.captureId);
      if (previous !== undefined && previous !== binding) issues.add('capture_binding_conflict');
      captureBindings.set(reference.captureId, binding);
    }
  }
}

/**
 * Checks internal consistency of a retrospective evidence bundle only. References must still
 * be authenticated against the capture/authority ledger by the admission boundary. This result
 * is neither a canonical asset nor authority to promote or construct historical model inputs.
 */
export function validateSpecialEntitlementLink(input: unknown) {
  const parsed = specialEntitlementLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'blocked' as const, issues: ['missing_or_invalid_evidence'], link: null };
  }
  const bundle = parsed.data;
  const { award, activation, custody, selection } = bundle;
  const events = [
    award,
    ...(activation ? [activation] : []),
    ...custody,
    ...(bundle.renumbering ?? []),
    selection,
  ];
  const issues = new Set<string>();
  validateAwardAndSelection(bundle, events, issues);
  validateCustodyChain(bundle, issues);
  validateRenumbering(bundle, issues);
  validateCaptureBindings(events, issues);
  return {
    status: issues.size ? ('blocked' as const) : ('internally_consistent' as const),
    issues: [...issues],
    link: issues.size
      ? null
      : {
          scope: 'retrospective_only' as const,
          chronologyPrecision: events.every((event) => typeof event.occurredAt === 'string')
            ? ('instant' as const)
            : ('partial' as const),
          authorityVerified: false as const,
          promotionEligible: false as const,
          evidenceBundle: bundle,
        },
  };
}
