export interface CompletedDraftMembershipSource {
  evidenceId: string;
  captureId: string;
  artifactId: string;
  documentId: string;
  draftYear: number;
  draftType: string;
}

export interface CompletedDraftMembershipRoster extends CompletedDraftMembershipSource {
  kind: 'completed_draft_membership_roster';
  members: readonly { recordedName: string; selectionNumber: number | null }[];
}

export interface CompletedDraftMemberNumber extends CompletedDraftMembershipSource {
  kind: 'completed_draft_member_number';
  recordedName: string;
  selectionNumber: number;
}

export interface CompletedDraftMemberExclusion extends CompletedDraftMembershipSource {
  kind: 'completed_draft_member_exclusion';
  recordedName: string;
  reason: 'rookie_elevation';
}

// Reviewed source discrepancy: the club's completed-draft report explicitly places
// Sutcliffe at 71 and the pass at 72; the full list transposes those two entries.
// Keep the roster's 72 and both evidence references; resolve only this exact pair.
function reviewedNumberCorrection(
  roster: CompletedDraftMembershipRoster,
  member: CompletedDraftMembershipRoster['members'][number],
  binding: CompletedDraftMemberNumber | undefined
): binding is CompletedDraftMemberNumber {
  return Boolean(
    binding &&
    roster.draftYear === 2011 &&
    roster.draftType === 'national' &&
    roster.documentId === 'official_afl:news:506746' &&
    binding.documentId === 'official_afl:news:75034' &&
    member.recordedName === 'Cameron Sutcliffe' &&
    binding.recordedName === member.recordedName &&
    member.selectionNumber === 72 &&
    binding.selectionNumber === 71
  );
}

/** Join explicit names across source documents; never derive missing numbers from the inventory. */
export function resolveCompletedDraftMembership(input: {
  draftYear: number;
  draftType: string;
  inventoryNumbers: readonly number[];
  roster: CompletedDraftMembershipRoster;
  bindings: readonly CompletedDraftMemberNumber[];
  exclusions?: readonly CompletedDraftMemberExclusion[];
}): {
  schemaVersion: 'afl-trade-completed-draft-membership/v1';
  selectionNumbers: number[];
  evidenceIds: string[];
} {
  const { roster, bindings, exclusions = [] } = input;
  const fail = (): never => {
    throw new TypeError(
      'Completed membership requires exact, unique, source-bound member numbers.'
    );
  };
  const validNumber = (n: number) => Number.isInteger(n) && n > 0;
  const validName = (name: string) => name.length > 0 && name.trim() === name;
  const sources = [roster, ...bindings, ...exclusions];
  if (
    !Number.isInteger(input.draftYear) ||
    !input.draftType ||
    sources.some(
      (source) =>
        source.draftYear !== input.draftYear ||
        source.draftType !== input.draftType ||
        [source.evidenceId, source.captureId, source.artifactId, source.documentId].some(
          (id) => !id || id.trim() !== id
        )
    ) ||
    new Set(sources.map((source) => source.evidenceId)).size !== sources.length ||
    roster.members.length === 0 ||
    roster.members.length !== input.inventoryNumbers.length + exclusions.length ||
    roster.members.some((member) => !validName(member.recordedName)) ||
    new Set(roster.members.map((member) => member.recordedName)).size !== roster.members.length ||
    bindings.some((binding) => !validName(binding.recordedName)) ||
    new Set(bindings.map((binding) => binding.recordedName)).size !== bindings.length
  )
    fail();
  const recordedNumbers = roster.members.flatMap((member) =>
    member.selectionNumber === null ? [] : [member.selectionNumber]
  );
  if (new Set(recordedNumbers).size !== recordedNumbers.length) fail();
  const excludedNames = new Set(exclusions.map((exclusion) => exclusion.recordedName));
  if (
    excludedNames.size !== exclusions.length ||
    exclusions.some((exclusion) => {
      const member = roster.members.find((row) => row.recordedName === exclusion.recordedName);
      return (
        !validName(exclusion.recordedName) ||
        exclusion.reason !== 'rookie_elevation' ||
        input.draftType !== 'national' ||
        !member ||
        member.selectionNumber === null ||
        !validNumber(member.selectionNumber) ||
        input.inventoryNumbers.includes(member.selectionNumber) ||
        exclusion.documentId === roster.documentId ||
        exclusion.captureId === roster.captureId ||
        exclusion.artifactId === roster.artifactId
      );
    })
  )
    fail();
  const included = roster.members.filter((member) => !excludedNames.has(member.recordedName));
  if (included.length === 0) fail();
  const requiringBindings = included.filter(
    (member) =>
      member.selectionNumber === null ||
      reviewedNumberCorrection(
        roster,
        member,
        bindings.find((binding) => binding.recordedName === member.recordedName)
      )
  );
  const correctedNames = new Set(
    requiringBindings
      .filter((member) => member.selectionNumber !== null)
      .map((member) => member.recordedName)
  );
  if (
    bindings.length !== requiringBindings.length ||
    bindings.some(
      (binding) =>
        !requiringBindings.some((member) => member.recordedName === binding.recordedName) ||
        binding.documentId === roster.documentId ||
        binding.captureId === roster.captureId ||
        binding.artifactId === roster.artifactId
    )
  )
    fail();
  const numbers = included
    .map((member) => {
      const binding = bindings.find((item) => item.recordedName === member.recordedName);
      const number = correctedNames.has(member.recordedName)
        ? binding?.selectionNumber
        : (member.selectionNumber ?? binding?.selectionNumber);
      if (number === undefined || !validNumber(number)) return fail();
      return number;
    })
    .sort((a, b) => a - b);
  const expected = [...input.inventoryNumbers].sort((a, b) => a - b);
  if (
    expected.some((number) => !validNumber(number)) ||
    new Set(numbers).size !== numbers.length ||
    numbers.some((number, index) => number !== expected[index])
  )
    fail();
  return {
    schemaVersion: 'afl-trade-completed-draft-membership/v1',
    selectionNumbers: numbers,
    evidenceIds: sources.map((source) => source.evidenceId).sort(),
  };
}

export interface CompletedDraftSelectionCapacity extends CompletedDraftMembershipSource {
  kind: 'draft_selection_capacity';
  maximumSelections: number;
}

/** A reviewed limit plus independently recorded use of every available right proves exhaustion.
 * This does not relabel prospective capacity as a source-reported completed total.
 */
export function resolveCompletedDraftCapacityExhaustion(input: {
  draftYear: number;
  draftType: string;
  inventoryNumbers: readonly number[];
  capacity: CompletedDraftSelectionCapacity;
  roster: CompletedDraftMembershipRoster;
  completion: CompletedDraftMembershipSource & {
    kind: 'completed_session';
    sessionOrdinal: number;
  };
}) {
  const { capacity, roster, completion } = input;
  const fail = (): never => {
    throw new TypeError(
      'Capacity exhaustion requires the reviewed limit and independently completed use of every numbered right.'
    );
  };
  const sources = [capacity, roster, completion];
  if (
    input.draftYear !== 2012 ||
    input.draftType !== 'mini_draft' ||
    roster.kind !== 'completed_draft_membership_roster' ||
    completion.kind !== 'completed_session' ||
    completion.sessionOrdinal !== 1 ||
    capacity.kind !== 'draft_selection_capacity' ||
    capacity.maximumSelections !== 2 ||
    capacity.documentId !==
      'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained' ||
    roster.documentId !== 'official_afl:news:453694' ||
    sources.some(
      (source) =>
        source.draftYear !== input.draftYear ||
        source.draftType !== input.draftType ||
        [source.evidenceId, source.captureId, source.artifactId, source.documentId].some(
          (id) => !id || id.trim() !== id
        )
    ) ||
    new Set(sources.map((source) => source.evidenceId)).size !== sources.length ||
    completion.documentId !== roster.documentId ||
    completion.captureId !== roster.captureId ||
    completion.artifactId !== roster.artifactId ||
    capacity.captureId === roster.captureId ||
    capacity.artifactId === roster.artifactId ||
    input.inventoryNumbers.length !== capacity.maximumSelections ||
    [...input.inventoryNumbers].sort((a, b) => a - b).some((number, index) => number !== index + 1)
  )
    fail();
  const membership = resolveCompletedDraftMembership({ ...input, bindings: [] });
  return {
    schemaVersion: 'afl-trade-completed-draft-capacity-exhaustion/v1' as const,
    maximumSelections: capacity.maximumSelections,
    selectionNumbers: membership.selectionNumbers,
    evidenceIds: sources.map((source) => source.evidenceId).sort(),
  };
}
