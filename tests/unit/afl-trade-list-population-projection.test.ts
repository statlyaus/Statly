import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { expect, it } from 'vitest';
import {
  projectCombinedDraftSessionEvidence,
  type CombinedDraftSessionFact,
} from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';
const scope = { draftYear: 2010, draftType: 'national' };
const source = (id: string, documentId = id) => ({
  ...scope,
  evidenceId: id,
  captureId: `capture:${documentId}`,
  artifactId: `artifact:${documentId}`,
  documentId,
});
const selections = [1, 3].map((selectionNumber) => ({
  selectionNumber,
  selectionId: `selection:${selectionNumber}`,
  playerId: `player:${selectionNumber}`,
  clubId: `club:${selectionNumber}`,
}));
const facts: CombinedDraftSessionFact[] = [
  {
    ...source(
      'total',
      'https://resources.afl.com.au/afl/document/2019/12/05/0b3bf9a6-8f7d-4094-8591-d10f5babd3cf/afl_annual_report_2010_V2-min.pdf'
    ),
    kind: 'completed_draft_list_total',
    population: 'national_selections_and_rookie_promotions',
    playerCount: 4,
  },
  {
    ...source('additions', 'official_afl:news:114795'),
    kind: 'draft_rookie_list_additions',
    clubs: [{ recordedClub: 'A', recordedNames: ['Rookie1', 'Rookie2'] }],
  },
  {
    ...source('slots', 'official_afl:news:469544'),
    kind: 'draft_rookie_promotion_slots',
    clubs: [{ recordedClub: 'A', selectionNumbers: [2, 4] }],
  },
  { ...source('inventory'), kind: 'completed_draft_inventory', selectionNumbers: [1, 3] },
  { ...source('date'), kind: 'completed_session_date', sessionOrdinal: 1, eventDate: '2010-11-18' },
  { ...source('completion'), kind: 'completed_session', sessionOrdinal: 1 },
  ...selections.map((s, i) => ({
    ...source(`boundary:${i}`),
    kind: 'session_boundary' as const,
    sessionOrdinal: 1,
    boundary: i === 0 ? ('first' as const) : ('last' as const),
    selectionNumber: s.selectionNumber,
    playerId: s.playerId,
    clubId: s.clubId,
  })),
];
const input = {
  ...scope,
  officialName: '2010 national draft fixture',
  selections,
  selectedSelectionIds: ['selection:3'],
  facts,
};
it('projects only the requested member while retaining every population evidence ID', () => {
  const before = structuredClone(input);
  const result = projectCombinedDraftSessionEvidence(input);
  expect(result.inventorySelectionIds).toEqual(['selection:1', 'selection:3']);
  expect(result.selectedSessions[0].selectionIds).toEqual(['selection:3']);
  expect(result.selectedSessions[0].evidenceIds).toEqual(facts.map((f) => f.evidenceId).sort());
  expect(input).toEqual(before);
});
it.each(['total', 'additions', 'slots', 'inventory', 'completion', 'boundary:1'])(
  'rejects a missing required proof: %s',
  (id) => {
    expect(() =>
      projectCombinedDraftSessionEvidence({
        ...input,
        facts: facts.filter((f) => f.evidenceId !== id),
      })
    ).toThrow();
  }
);
it.each(['total', 'additions', 'slots'])('rejects duplicate population source: %s', (id) => {
  expect(() =>
    projectCombinedDraftSessionEvidence({
      ...input,
      facts: [...facts, facts.find((f) => f.evidenceId === id)!],
    })
  ).toThrow();
});
it('rejects a reported count mixed into the derived count mechanism', () => {
  expect(() =>
    projectCombinedDraftSessionEvidence({
      ...input,
      facts: [...facts, { ...source('other'), kind: 'completed_draft_total', selectionCount: 2 }],
    })
  ).toThrow(/mixed/);
});
it('rejects a mismatched complete inventory even when the requested subset exists', () => {
  expect(() =>
    projectCombinedDraftSessionEvidence({ ...input, selections: selections.slice(1) })
  ).toThrow();
});

it('binds the reviewed PDF and population articles to their retained document identities', () => {
  for (const [url, id] of [
    ['https://www.afl.com.au/news/114795/countdown-to-d-day', 'official_afl:news:114795'],
    ['https://www.afl.com.au/news/469544/round-by-round-selections', 'official_afl:news:469544'],
    [facts[0].documentId, facts[0].documentId],
  ])
    expect(combinedDraftDocumentId('official_afl', url, 'non_production')).toBe(id);
  expect(() =>
    combinedDraftDocumentId('official_afl', facts[0].documentId + '?x=1', 'non_production')
  ).toThrow();
  expect(() =>
    combinedDraftDocumentId('draftguru', facts[0].documentId, 'non_production')
  ).toThrow();
});
