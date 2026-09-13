import { expect, it } from 'vitest';
import { projectReportedDraftSessionEvidence } from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';
const input = {
  draftYear: 2021,
  draftType: 'national',
  selections: [
    { selectionId: 'one', selectionNumber: 1 },
    { selectionId: 'three', selectionNumber: 3 },
    { selectionId: 'four', selectionNumber: 4 },
  ],
  sessions: [
    {
      sessionOrdinal: 1,
      eventDate: '2021-11-24',
      officialName: 'AFL Draft',
      selectionNumbers: [1],
      evidenceIds: ['first'],
    },
    {
      sessionOrdinal: 2,
      eventDate: '2021-11-25',
      officialName: 'AFL Draft',
      selectionNumbers: [3, 4],
      evidenceIds: ['second'],
    },
  ],
  selectedSelectionIds: ['four'],
};
it('proves the full reported inventory and preserves the selected second-session identity', () => {
  const before = structuredClone(input),
    proof = projectReportedDraftSessionEvidence(input);
  expect(proof.inventorySelectionIds).toEqual(['four', 'one', 'three']);
  expect(proof.selectedSessions).toEqual([
    {
      draftYear: 2021,
      draftType: 'national',
      sessionOrdinal: 2,
      eventDate: '2021-11-25',
      officialName: 'AFL Draft',
      selectionIds: ['four'],
      evidenceIds: ['second'],
    },
  ]);
  expect(input).toEqual(before);
});
it('merges agreeing sources without duplicating session membership', () => {
  const proof = projectReportedDraftSessionEvidence({
    ...input,
    sessions: [...input.sessions, { ...input.sessions[1]!, evidenceIds: ['third'] }],
  });
  expect(proof.inventorySessions).toHaveLength(2);
  expect(proof.selectedSessions[0]!.evidenceIds).toEqual(['second', 'third']);
});
it('rejects incomplete, overlapping, extraneous or contradictory session claims', () => {
  for (const changed of [
    { ...input.sessions[1]!, selectionNumbers: [4] },
    { ...input.sessions[1]!, selectionNumbers: [1, 3, 4] },
    { ...input.sessions[1]!, selectionNumbers: [3, 4, 5] },
    { ...input.sessions[1]!, selectionNumbers: [3, 3, 4] },
    { ...input.sessions[1]!, sessionOrdinal: 3 },
    { ...input.sessions[1]!, eventDate: '2021-11-23' },
    { ...input.sessions[1]!, eventDate: '2021-02-30' },
    { ...input.sessions[1]!, eventDate: '2020-11-25' },
    { ...input.sessions[1]!, evidenceIds: [] },
  ])
    expect(() =>
      projectReportedDraftSessionEvidence({ ...input, sessions: [input.sessions[0]!, changed] })
    ).toThrow();
  expect(() =>
    projectReportedDraftSessionEvidence({
      ...input,
      sessions: [...input.sessions, { ...input.sessions[1]!, eventDate: '2021-11-26' }],
    })
  ).toThrow('disagree');
});
it('rejects invalid inventory or selected membership even if reported sessions agree', () => {
  for (const selections of [
    [input.selections[0]!, input.selections[2]!],
    [...input.selections, input.selections[0]!],
  ])
    expect(() => projectReportedDraftSessionEvidence({ ...input, selections })).toThrow();
  for (const selectedSelectionIds of [[], ['missing'], ['four', 'four']])
    expect(() => projectReportedDraftSessionEvidence({ ...input, selectedSelectionIds })).toThrow(
      'selected membership'
    );
});
