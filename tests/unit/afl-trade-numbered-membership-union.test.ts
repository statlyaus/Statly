import { expect, it } from 'vitest';
import { resolveCompletedDraftNumberedUnion } from '@/server/aflTradeIntelligence/source/completedDraftNumberedUnion';
const scope = { draftYear: 2010, draftType: 'national' };
const source = (id: string, documentId: string) => ({
  ...scope,
  evidenceId: id,
  captureId: 'capture:' + id,
  artifactId: 'artifact:' + id,
  documentId,
});
const slotsSource = source('slots', 'official_afl:news:469544');
const inventoryNumbers = [...Array.from({ length: 77 }, (_, i) => i + 1), 103, 104];
const input = {
  ...scope,
  inventoryNumbers,
  total: {
    ...source(
      'total',
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'
    ),
    kind: 'completed_draft_list_total' as const,
    population: 'national_selections_and_rookie_promotions' as const,
    playerCount: 107,
  },
  additions: {
    ...source('additions', 'official_afl:news:114795'),
    kind: 'draft_rookie_list_additions' as const,
    clubs: [
      { recordedClub: 'A', recordedNames: Array.from({ length: 28 }, (_, i) => 'Rookie ' + i) },
    ],
  },
  slots: {
    ...slotsSource,
    kind: 'draft_rookie_promotion_slots' as const,
    clubs: [
      {
        recordedClub: 'A',
        selectionNumbers: [...Array.from({ length: 25 }, (_, i) => i + 78), 105, 106, 107],
      },
    ],
  },
  members: [
    ...Array.from({ length: 77 }, (_, i) => ({
      ...slotsSource,
      evidenceId: 'member:' + i,
      kind: 'completed_draft_member_number' as const,
      recordedName: 'Member ' + i,
      selectionNumber: i + 1,
    })),
    {
      ...source('polo', 'official_afl:news:45435'),
      kind: 'completed_draft_member_number' as const,
      recordedName: 'Dean Polo',
      selectionNumber: 103,
    },
    {
      ...source(
        'young',
        'https://www.collingwoodfc.com.au/news/132825/the-pies-2010-afl-draft-picks-are'
      ),
      kind: 'completed_draft_member_number' as const,
      recordedName: 'Tom Young',
      selectionNumber: 104,
    },
  ],
};
it('derives104 from independently exhausted membership while preserving original claims', () => {
  const before = structuredClone(input),
    result = resolveCompletedDraftNumberedUnion(input);
  expect(result.selectionNumbers).toEqual(inventoryNumbers);
  expect(result.terminalMember.recordedName).toBe('Tom Young');
  expect(result.terminalBasis).toBe('maximum_number_in_independently_exhausted_membership');
  expect(result.evidenceIds).toHaveLength(82);
  expect(input).toEqual(before);
});
it.each([
  'missing',
  'duplicate',
  'source',
  'name',
  'number',
  'capture',
  'artifact',
  'population',
  'reused-source',
  'reused-evidence',
  'inventory',
])('rejects incomplete or unbound union: %s', (mode) => {
  const bad: any = structuredClone(input);
  if (mode === 'missing') bad.members.pop();
  if (mode === 'duplicate') bad.members[1] = bad.members[0];
  if (mode === 'source') bad.members[78].documentId = 'other';
  if (mode === 'name') bad.members[78].recordedName = 'Other';
  if (mode === 'number') bad.members[78].selectionNumber = 105;
  if (mode === 'capture') bad.members[0].captureId = 'other';
  if (mode === 'artifact') bad.members[0].artifactId = 'other';
  if (mode === 'population') bad.total.playerCount = 108;
  if (mode === 'reused-source') bad.members[78].artifactId = bad.members[77].artifactId;
  if (mode === 'reused-evidence') bad.members[0].evidenceId = bad.slots.evidenceId;
  if (mode === 'inventory') bad.inventoryNumbers[0] = 78;
  expect(() => resolveCompletedDraftNumberedUnion(bad)).toThrow();
});

it('accepts the complete union in projection but still requires a terminal identity boundary', async () => {
  const { projectCombinedDraftSessionEvidence } =
    await import('@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence');
  const selections = inventoryNumbers.map((n) => ({
    selectionId: `s:${n}`,
    selectionNumber: n,
    playerId: `p:${n}`,
    clubId: `c:${n}`,
  }));
  const facts: any[] = [
    input.total,
    input.additions,
    input.slots,
    ...input.members,
    {
      ...source('date', 'date'),
      kind: 'completed_session_date',
      sessionOrdinal: 1,
      eventDate: '2010-11-18',
    },
    { ...source('completion', 'completion'), kind: 'completed_session', sessionOrdinal: 1 },
    {
      ...source('first', 'first'),
      kind: 'session_boundary',
      sessionOrdinal: 1,
      boundary: 'first',
      selectionNumber: 1,
      playerId: 'p:1',
      clubId: 'c:1',
    },
  ];
  const projection = {
    ...scope,
    officialName: 'Fixture2010 national',
    selections,
    selectedSelectionIds: ['s:104'],
    facts,
  };
  expect(() => projectCombinedDraftSessionEvidence(projection)).toThrow(/terminal boundary/);
  facts.push({
    ...source('last', 'last'),
    kind: 'session_boundary',
    sessionOrdinal: 1,
    boundary: 'last',
    selectionNumber: 104,
    playerId: 'p:104',
    clubId: 'c:104',
  });
  expect(projectCombinedDraftSessionEvidence(projection).selectedSessions[0].selectionIds).toEqual([
    's:104',
  ]);
  facts[facts.length - 1].clubId = 'wrong';
  expect(() => projectCombinedDraftSessionEvidence(projection)).toThrow(/identity/);
});
