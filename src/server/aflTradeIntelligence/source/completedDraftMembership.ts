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
  const unnumbered = included.filter((member) => member.selectionNumber === null);
  if (
    bindings.length !== unnumbered.length ||
    bindings.some(
      (binding) =>
        !unnumbered.some((member) => member.recordedName === binding.recordedName) ||
        binding.documentId === roster.documentId ||
        binding.captureId === roster.captureId ||
        binding.artifactId === roster.artifactId
    )
  )
    fail();
  const numbers = included
    .map((member) => {
      const number =
        member.selectionNumber ??
        bindings.find((binding) => binding.recordedName === member.recordedName)?.selectionNumber;
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
