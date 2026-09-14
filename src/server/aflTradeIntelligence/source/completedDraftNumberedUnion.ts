import type { CompletedDraftMemberNumber } from './completedDraftMembership';
import { resolveCompletedDraftListTotal } from './completedDraftListTotal';

const fail = (): never => {
  throw new TypeError(
    'Reviewed2010 numbered membership requires the complete independent source union.'
  );
};
const mainDocument = 'official_afl:news:469544';
const poloDocument = 'official_afl:news:45435';
const youngDocument =
  'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are';

/** Exhaust independently counted national membership before deriving its terminal number. */
export function resolveCompletedDraftNumberedUnion(
  input: NumberedUnionInput
) {
  const population = resolveCompletedDraftListTotal(input);
  const members = [...input.members].sort((a, b) => a.selectionNumber - b.selectionNumber);
  const numbers = members.map((m) => m.selectionNumber);
  const inventory = [...input.inventoryNumbers].sort((a, b) => a - b);
  assertCompleteNumberedMembership(population, members, numbers, inventory);
  for (const member of members) assertNumberedMemberSource(member, input.slots);
  const polo = members.find((m) => m.documentId === poloDocument);
  const terminal = members.find((m) => m.documentId === youngDocument);
  if (!polo || !terminal) return fail();
  const sources = [input.total, input.additions, input.slots, polo, terminal];
  for (const key of ['captureId', 'artifactId', 'documentId'] as const)
    if (new Set(sources.map((s) => s[key])).size !== 5) fail();
  if (members.some((m) => population.evidenceIds.includes(m.evidenceId))) fail();
  return {
    schemaVersion: 'afl-trade-completed-draft-numbered-union/v1' as const,
    selectionNumbers: numbers,
    population,
    terminalMember: { ...terminal },
    terminalBasis: 'maximum_number_in_independently_exhausted_membership' as const,
    evidenceIds: [...population.evidenceIds, ...members.map((m) => m.evidenceId)].sort(),
  };
}

type NumberedUnionInput = Parameters<typeof resolveCompletedDraftListTotal>[0] & {
  members: readonly CompletedDraftMemberNumber[];
};

function assertCompleteNumberedMembership(
  population: ReturnType<typeof resolveCompletedDraftListTotal>,
  members: CompletedDraftMemberNumber[],
  numbers: number[],
  inventory: number[]
): void {
  if (
    population.derivedSelectionCount !== 79 ||
    members.length !== 79 ||
    new Set(numbers).size !== 79 ||
    new Set(members.map((m) => m.recordedName)).size !== 79 ||
    new Set(members.map((m) => m.evidenceId)).size !== 79 ||
    members.some(
      (m) =>
        m.kind !== 'completed_draft_member_number' ||
        m.draftYear !== 2010 ||
        m.draftType !== 'national' ||
        [m.evidenceId, m.captureId, m.artifactId, m.documentId, m.recordedName].some(
          (v) => !v || v !== v.trim()
        )
    ) ||
    numbers.some((n, i) => n !== inventory[i]) ||
    members.filter((m) => m.documentId === mainDocument).length !== 77
  )
    fail();
}

function assertNumberedMemberSource(
  member: CompletedDraftMemberNumber,
  slots: NumberedUnionInput['slots']
): void {
  if (member.documentId === mainDocument) {
    if (
      member.captureId !== slots.captureId ||
      member.artifactId !== slots.artifactId ||
      member.selectionNumber >= 103
    )
      fail();
  } else if (member.documentId === poloDocument) {
    if (member.selectionNumber !== 103 || member.recordedName !== 'Dean Polo') fail();
  } else if (member.documentId === youngDocument) {
    if (member.selectionNumber !== 104 || member.recordedName !== 'Tom Young') fail();
  } else fail();
}
