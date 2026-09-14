import type { CompletedDraftMembershipSource } from './completedDraftMembership';

interface ListTotal extends CompletedDraftMembershipSource {
  kind: 'completed_draft_list_total';
  population: 'national_selections_and_rookie_promotions';
  playerCount: number;
}
interface RookieAdditions extends CompletedDraftMembershipSource {
  kind: 'draft_rookie_list_additions';
  clubs: readonly { recordedClub: string; recordedNames: readonly string[] }[];
}
interface RookieSlots extends CompletedDraftMembershipSource {
  kind: 'draft_rookie_promotion_slots';
  clubs: readonly { recordedClub: string; selectionNumbers: readonly number[] }[];
}

/** Derive a count from separately authenticated populations; never emit a reported-total claim. */
export function resolveCompletedDraftListTotal(input: {
  draftYear: number;
  draftType: string;
  inventoryNumbers: readonly number[];
  total: ListTotal;
  additions: RookieAdditions;
  slots: RookieSlots;
}) {
  const fail = (): never => {
    throw new TypeError('Completed list total requires independent, exact rookie populations.');
  };
  const { total, additions, slots } = input;
  const sources = [total, additions, slots];
  if (
    input.draftYear !== 2010 ||
    input.draftType !== 'national' ||
    total.kind !== 'completed_draft_list_total' ||
    total.population !== 'national_selections_and_rookie_promotions' ||
    additions.kind !== 'draft_rookie_list_additions' ||
    slots.kind !== 'draft_rookie_promotion_slots' ||
    total.documentId !==
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf' ||
    additions.documentId !== 'official_afl:news:114795' ||
    slots.documentId !== 'official_afl:news:469544' ||
    sources.some((s) => s.draftYear !== input.draftYear || s.draftType !== input.draftType) ||
    ['evidenceId', 'captureId', 'artifactId', 'documentId'].some((key) => {
      const values = sources.map((s) => s[key as keyof CompletedDraftMembershipSource]);
      return (
        values.some((v) => typeof v !== 'string' || !v.trim() || v !== v.trim()) ||
        new Set(values).size !== sources.length
      );
    }) ||
    !Number.isInteger(total.playerCount) ||
    total.playerCount < 1
  )
    fail();
  const clubValid = (name: string) => name.length > 0 && name === name.trim();
  if (
    !additions.clubs.length ||
    additions.clubs.length !== slots.clubs.length ||
    additions.clubs.some((c) => !clubValid(c.recordedClub) || !c.recordedNames.length) ||
    slots.clubs.some((c) => !clubValid(c.recordedClub) || !c.selectionNumbers.length) ||
    new Set(additions.clubs.map((c) => c.recordedClub)).size !== additions.clubs.length ||
    new Set(slots.clubs.map((c) => c.recordedClub)).size !== slots.clubs.length
  )
    fail();
  // Exact labels from the reviewed2010 source pair above, not a global club alias table.
  const reviewedSlotLabels: Record<string, string> = {
    ADELAIDE: 'Adelaide Crows',
    'BRISBANE LIONS': 'Brisbane Lions',
    CARLTON: 'Carlton',
    COLLINGWOOD: 'Collingwood',
    ESSENDON: 'Essendon',
    FREMANTLE: 'Fremantle',
    GEELONG: 'Geelong Cats',
    MELBOURNE: 'Melbourne',
    'NORTH MELBOURNE': 'North Melbourne',
    'PORT ADELAIDE': 'Port Adelaide',
    RICHMOND: 'Richmond',
    'ST KILDA': 'St Kilda',
    'SYDNEY SWANS': 'Sydney Swans',
    'WEST COAST': 'West Coast Eagles',
    'WESTERN BULLDOGS': 'Western Bulldogs',
  };
  const clubLabelBindings: { additionsLabel: string; slotsLabel: string }[] = [];
  const matchedLabels = new Set<string>();
  for (const club of additions.clubs) {
    const slotLabel = reviewedSlotLabels[club.recordedClub] ?? club.recordedClub;
    const marked = slots.clubs.find((c) => c.recordedClub === slotLabel);
    if (
      !marked ||
      matchedLabels.has(slotLabel) ||
      marked.selectionNumbers.length !== club.recordedNames.length
    )
      fail();
    matchedLabels.add(slotLabel);
    if (slotLabel !== club.recordedClub)
      clubLabelBindings.push({ additionsLabel: club.recordedClub, slotsLabel: slotLabel });
  }
  const names = additions.clubs.flatMap((c) => c.recordedNames);
  const excluded = slots.clubs.flatMap((c) => c.selectionNumbers);
  const inventory = [...input.inventoryNumbers];
  if (
    names.some((n) => !clubValid(n)) ||
    new Set(names).size !== names.length ||
    [...inventory, ...excluded].some((n) => !Number.isInteger(n) || n < 1) ||
    new Set([...inventory, ...excluded]).size !== inventory.length + excluded.length ||
    names.length !== excluded.length ||
    inventory.length === 0 ||
    total.playerCount !== inventory.length + excluded.length
  )
    fail();
  return {
    schemaVersion: 'afl-trade-completed-draft-list-total/v1' as const,
    reportedListAdditions: total.playerCount,
    classifiedRookieAdditions: names.length,
    derivedSelectionCount: total.playerCount - names.length,
    excludedSelectionNumbers: excluded.sort((a, b) => a - b),
    evidenceIds: sources.map((s) => s.evidenceId).sort(),
    ...(clubLabelBindings.length ? { clubLabelBindings } : {}),
  };
}
