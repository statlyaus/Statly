import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * The pure half of `npm run outcomes:sources:register-draftees`: the reviewed plan, the player id
 * rule and the per-draftee checks. Each line of the plan is one national draftee who becomes a new
 * canonical player, linked to the Draftguru subject it is created from and, when given, to its
 * Footyinfo subject. See the runbook section "Registering a season's national draftees".
 */

const DISTINCT_FROM_ORDER = 'distinctFromPlayerIds must be unique and in ascending order.';

export const drafteeRegistrationPlanEntrySchema = z
  .object({
    draftguruNativeId: z.string().trim().min(1).max(240),
    displayName: z.string().trim().min(1).max(500),
    draftingClub: z.string().trim().min(1).max(120),
    season: z.number().int().min(1897).max(2200),
    pick: z.number().int().positive().max(200),
    footyinfoNativeId: z.string().trim().min(1).max(240).optional(),
    /** A Footyinfo spelling whose name key differs from displayName (Cam for Cameron Nairn). */
    footyinfoRecordedName: z.string().trim().min(1).max(500).optional(),
    distinctFromPlayerIds: z
      .array(z.string().trim().min(1).max(300))
      .min(1)
      .max(50)
      .refine((ids) => ids.every((id, index) => index === 0 || ids[index - 1]! < id), {
        message: DISTINCT_FROM_ORDER,
      })
      .optional(),
  })
  .strict()
  .refine(
    (entry) => entry.footyinfoRecordedName === undefined || entry.footyinfoNativeId !== undefined,
    {
      message: 'footyinfoRecordedName requires footyinfoNativeId.',
    }
  );

export type DrafteeRegistrationPlanEntry = z.infer<typeof drafteeRegistrationPlanEntrySchema>;

/** Reads the reviewed JSONL plan: one draftee per non-blank line, each Draftguru id once. */
export function parseDrafteeRegistrationPlan(text: string): DrafteeRegistrationPlanEntry[] {
  const entries: DrafteeRegistrationPlanEntry[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new TypeError(`Plan line ${index + 1} is not JSON.`);
    }
    const parsed = drafteeRegistrationPlanEntrySchema.safeParse(value);
    if (!parsed.success) {
      throw new TypeError(`Plan line ${index + 1} is invalid: ${parsed.error.issues[0]?.message}`);
    }
    entries.push(parsed.data);
  });
  if (entries.length === 0) throw new TypeError('The plan lists no draftees.');
  for (const key of ['draftguruNativeId', 'footyinfoNativeId'] as const) {
    const ids = entries.flatMap((entry) => (entry[key] === undefined ? [] : [entry[key]]));
    if (new Set(ids).size !== ids.length) throw new TypeError(`The plan repeats a ${key}.`);
  }
  return entries;
}

/** Migration 0276's normalised name: lower case, letters and digits only. */
export function canonicalPlayerNameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Player ids of earlier plan lines with the same name key. The run creates them first, so this
 * line is held until its `distinctFromPlayerIds` lists them, as it would be once they exist.
 */
export function earlierSameNamePlanPlayerIds(
  entries: readonly DrafteeRegistrationPlanEntry[],
  index: number
): string[] {
  const key = canonicalPlayerNameKey(entries[index]!.displayName);
  return entries
    .slice(0, index)
    .filter((entry) => canonicalPlayerNameKey(entry.displayName) === key)
    .map((entry) => draftguruDrafteePlayerId(entry.draftguruNativeId));
}

/** The 2025 rule: `player:` and the SHA-256 of `draftguru/player/<nativeId>`, birth date unknown. */
export function draftguruDrafteePlayerId(nativeId: string): string {
  return `player:${createHash('sha256').update(`draftguru/player/${nativeId}`, 'utf8').digest('hex')}`;
}

/** The parts of an identity review package item the draftee checks read. */
export interface DrafteeSubjectItem {
  readonly subjectId: string;
  readonly workItem: {
    readonly content: {
      readonly subject: {
        readonly content: {
          readonly provider: string;
          readonly entityKind: string;
          readonly identityScope:
            | { readonly kind: 'provider_native_id'; readonly nativeId: string }
            | { readonly kind: 'exact_recorded_name' };
        };
      };
      readonly observedNames: readonly string[];
      readonly validFromSeason: number;
      readonly validThroughSeason: number;
    };
  };
}

/** The completion's player subject with this provider-native id, or null. */
export function findDrafteeSubject<Item extends DrafteeSubjectItem>(
  items: readonly Item[],
  provider: 'draftguru' | 'footyinfo',
  nativeId: string
): Item | null {
  return (
    items.find(({ workItem }) => {
      const subject = workItem.content.subject.content;
      return (
        subject.provider === provider &&
        subject.entityKind === 'player' &&
        subject.identityScope.kind === 'provider_native_id' &&
        subject.identityScope.nativeId === nativeId
      );
    }) ?? null
  );
}

export type DrafteeRefusalReason =
  | 'no_draftguru_subject'
  | 'no_footyinfo_subject'
  | 'draftguru_name_not_observed'
  | 'draftguru_season_not_observed'
  | 'footyinfo_season_not_observed'
  | 'footyinfo_name_not_observed'
  | 'distinct_from_not_same_name';

export type DrafteeRegistrationCheck<Item extends DrafteeSubjectItem> =
  | { status: 'refused'; reasons: DrafteeRefusalReason[]; listedNotSameName: string[] }
  | { status: 'hold'; unreviewedSameNamePlayerIds: string[] }
  | { status: 'create'; draftguru: Item; footyinfo: Item | null };

function observesSeason(item: DrafteeSubjectItem, season: number): boolean {
  const { validFromSeason, validThroughSeason } = item.workItem.content;
  return validFromSeason <= season && season <= validThroughSeason;
}

/**
 * Checks one draftee against the completion and the approved players sharing its normalised name
 * (`sameNamePlayerIds`, its own id excluded). A refusal needs a corrected plan or completion; a hold
 * needs review of the same-name players and their ids in `distinctFromPlayerIds` (migration 0276).
 */
export function checkDrafteeRegistration<Item extends DrafteeSubjectItem>(
  entry: DrafteeRegistrationPlanEntry,
  items: readonly Item[],
  sameNamePlayerIds: readonly string[]
): DrafteeRegistrationCheck<Item> {
  const reasons: DrafteeRefusalReason[] = [];
  const draftguru = findDrafteeSubject(items, 'draftguru', entry.draftguruNativeId);
  if (draftguru === null) {
    reasons.push('no_draftguru_subject');
  } else {
    if (!draftguru.workItem.content.observedNames.includes(entry.displayName)) {
      reasons.push('draftguru_name_not_observed');
    }
    if (!observesSeason(draftguru, entry.season)) reasons.push('draftguru_season_not_observed');
  }
  const footyinfo =
    entry.footyinfoNativeId === undefined
      ? null
      : findDrafteeSubject(items, 'footyinfo', entry.footyinfoNativeId);
  if (entry.footyinfoNativeId !== undefined) {
    if (footyinfo === null) {
      reasons.push('no_footyinfo_subject');
    } else {
      if (!observesSeason(footyinfo, entry.season)) reasons.push('footyinfo_season_not_observed');
      const observed = footyinfo.workItem.content.observedNames;
      const key = canonicalPlayerNameKey(entry.displayName);
      if (
        entry.footyinfoRecordedName === undefined
          ? !observed.some((name) => canonicalPlayerNameKey(name) === key)
          : !observed.includes(entry.footyinfoRecordedName)
      ) {
        reasons.push('footyinfo_name_not_observed');
      }
    }
  }
  const listed = entry.distinctFromPlayerIds ?? [];
  const listedNotSameName = listed.filter((id) => !sameNamePlayerIds.includes(id));
  if (listedNotSameName.length > 0) reasons.push('distinct_from_not_same_name');
  if (reasons.length > 0 || draftguru === null) {
    return { status: 'refused', reasons, listedNotSameName };
  }
  const unreviewed = sameNamePlayerIds.filter((id) => !listed.includes(id));
  if (unreviewed.length > 0) {
    return { status: 'hold', unreviewedSameNamePlayerIds: [...unreviewed].sort() };
  }
  return { status: 'create', draftguru, footyinfo };
}
