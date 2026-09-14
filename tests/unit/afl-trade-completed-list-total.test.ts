import { expect, it } from 'vitest';
import { resolveCompletedDraftListTotal } from '@/server/aflTradeIntelligence/source/completedDraftListTotal';
const scope = { draftYear: 2010, draftType: 'national' };
const source = (id: string, documentId: string) => ({
  ...scope,
  evidenceId: id,
  captureId: `capture-${id}`,
  artifactId: `artifact-${id}`,
  documentId,
});
const input = {
  ...scope,
  inventoryNumbers: [1, 3],
  total: {
    ...source(
      'total',
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'
    ),
    kind: 'completed_draft_list_total' as const,
    population: 'national_selections_and_rookie_promotions' as const,
    playerCount: 4,
  },
  additions: {
    ...source('additions', 'official_afl:news:114795'),
    kind: 'draft_rookie_list_additions' as const,
    clubs: [
      { recordedClub: 'A', recordedNames: ['One'] },
      { recordedClub: 'B', recordedNames: ['Two'] },
    ],
  },
  slots: {
    ...source('slots', 'official_afl:news:469544'),
    kind: 'draft_rookie_promotion_slots' as const,
    clubs: [
      { recordedClub: 'B', selectionNumbers: [4] },
      { recordedClub: 'A', selectionNumbers: [2] },
    ],
  },
};
it('derives a separate count without inventing names for marked slots or changing inputs', () => {
  const before = structuredClone(input);
  expect(resolveCompletedDraftListTotal(input)).toEqual({
    schemaVersion: 'afl-trade-completed-draft-list-total/v1',
    reportedListAdditions: 4,
    classifiedRookieAdditions: 2,
    derivedSelectionCount: 2,
    excludedSelectionNumbers: [2, 4],
    evidenceIds: ['additions', 'slots', 'total'],
  });
  expect(input).toEqual(before);
});
it.each([
  'year',
  'population',
  'source',
  'capture',
  'artifact',
  'evidence',
  'count',
  'overlap',
  'duplicate',
  'empty',
  'name',
  'clubs',
  'club-count',
  'fraction',
])('rejects invalid proof: %s', (mode) => {
  const bad: any = structuredClone(input);
  if (mode === 'year') bad.draftYear = 2011;
  if (mode === 'population') bad.total.population = 'all_offseason_additions';
  if (mode === 'source') bad.additions.documentId = 'unreviewed';
  if (mode === 'capture') bad.slots.captureId = bad.total.captureId;
  if (mode === 'artifact') bad.slots.artifactId = bad.total.artifactId;
  if (mode === 'evidence') bad.slots.evidenceId = bad.total.evidenceId;
  if (mode === 'count') bad.total.playerCount = 5;
  if (mode === 'overlap') bad.inventoryNumbers = [1, 2];
  if (mode === 'duplicate') bad.inventoryNumbers = [1, 1];
  if (mode === 'empty') bad.additions.clubs = [];
  if (mode === 'name') bad.additions.clubs[1].recordedNames = ['One'];
  if (mode === 'clubs') bad.slots.clubs[0].recordedClub = 'C';
  if (mode === 'club-count') bad.slots.clubs[0].selectionNumbers = [4, 5];
  if (mode === 'fraction') bad.slots.clubs[0].selectionNumbers = [4.5];
  expect(() => resolveCompletedDraftListTotal(bad)).toThrow();
});

it('binds only reviewed2010 club labels and retains both originals', () => {
  const actual = structuredClone(input);
  actual.additions.clubs[0]!.recordedClub = 'ADELAIDE';
  actual.slots.clubs[1]!.recordedClub = 'Adelaide Crows';
  const before = structuredClone(actual);
  expect(resolveCompletedDraftListTotal(actual).clubLabelBindings).toEqual([
    { additionsLabel: 'ADELAIDE', slotsLabel: 'Adelaide Crows' },
  ]);
  expect(actual).toEqual(before);
  actual.additions.documentId = 'official_afl:news:other';
  expect(() => resolveCompletedDraftListTotal(actual)).toThrow();
});
it('rejects approximate labels and two addition labels mapped to one slot club', () => {
  const actual = structuredClone(input);
  actual.additions.clubs[0]!.recordedClub = 'Adelaide';
  actual.slots.clubs[1]!.recordedClub = 'Adelaide Crows';
  expect(() => resolveCompletedDraftListTotal(actual)).toThrow();
  actual.additions.clubs[0]!.recordedClub = 'ADELAIDE';
  actual.additions.clubs[1]!.recordedClub = 'Adelaide Crows';
  expect(() => resolveCompletedDraftListTotal(actual)).toThrow();
});
