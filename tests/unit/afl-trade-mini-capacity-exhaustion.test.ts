import { expect, it } from 'vitest';
import { resolveCompletedDraftCapacityExhaustion } from '@/server/aflTradeIntelligence/source/completedDraftMembership';
import {
  projectPrecisionDraftSessionEvidence,
  type CombinedDraftSessionFact,
} from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';

const scope = { draftYear: 2012, draftType: 'mini_draft' };
const rules = {
  ...scope,
  captureId: 'rules-capture',
  artifactId: 'rules-artifact',
  documentId: 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained',
};
const used = {
  ...scope,
  captureId: 'used-capture',
  artifactId: 'used-artifact',
  documentId: 'official_afl:news:453694',
};
const capacity = {
  ...rules,
  evidenceId: 'capacity',
  kind: 'draft_selection_capacity' as const,
  maximumSelections: 2,
};
const roster = {
  ...used,
  evidenceId: 'roster',
  kind: 'completed_draft_membership_roster' as const,
  members: [
    { recordedName: 'Jack Martin', selectionNumber: 1 },
    { recordedName: 'Jesse Hogan', selectionNumber: 2 },
  ],
};
const completion = {
  ...used,
  evidenceId: 'completion',
  kind: 'completed_session' as const,
  sessionOrdinal: 1,
};
const input = { ...scope, inventoryNumbers: [1, 2], capacity, roster, completion };

it('proves exhaustion while preserving capacity and completed membership as different evidence', () => {
  expect(resolveCompletedDraftCapacityExhaustion(input)).toEqual({
    schemaVersion: 'afl-trade-completed-draft-capacity-exhaustion/v1',
    maximumSelections: 2,
    selectionNumbers: [1, 2],
    evidenceIds: ['capacity', 'completion', 'roster'],
  });
  expect(capacity.kind).toBe('draft_selection_capacity');
});

it.each([
  { inventoryNumbers: [1] },
  { inventoryNumbers: [1, 1] },
  { inventoryNumbers: [1, 3] },
  { capacity: { ...capacity, maximumSelections: 3 } },
  { capacity: { ...capacity, draftYear: 2011 } },
  { draftYear: 2011 },
  { draftType: 'national' },
  { roster: { ...roster, members: roster.members.slice(0, 1) } },
  { roster: { ...roster, members: [roster.members[0], roster.members[0]] } },
  { capacity: { ...capacity, captureId: used.captureId } },
  { capacity: { ...capacity, artifactId: used.artifactId } },
  { capacity: { ...capacity, documentId: used.documentId } },
  { capacity: { ...capacity, evidenceId: roster.evidenceId } },
  { completion: { ...completion, documentId: rules.documentId } },
  { completion: { ...completion, captureId: 'unbound' } },
  { completion: { ...completion, artifactId: 'unbound' } },
  { completion: { ...completion, sessionOrdinal: 2 } },
])('rejects incomplete, duplicate or unbound exhaustion: %j', (patch) => {
  expect(() => resolveCompletedDraftCapacityExhaustion({ ...input, ...patch })).toThrow();
});

it('projects a subset from the full exhausted inventory without creating an exact event date', () => {
  const selections = roster.members.map((member) => ({
    selectionId: `selection-${member.selectionNumber}`,
    selectionNumber: member.selectionNumber,
    playerId: member.recordedName,
    clubId: `club-${member.selectionNumber}`,
  }));
  const facts: CombinedDraftSessionFact[] = [
    capacity,
    roster,
    completion,
    {
      ...rules,
      evidenceId: 'window',
      kind: 'completed_session_window',
      sessionOrdinal: 1,
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2012-10-08',
        latestDate: '2012-10-26',
      },
    },
    ...selections.map((selection, index) => ({
      ...used,
      evidenceId: `boundary-${index}`,
      kind: 'session_boundary' as const,
      sessionOrdinal: 1,
      boundary: index === 0 ? ('first' as const) : ('last' as const),
      selectionNumber: selection.selectionNumber,
      playerId: selection.playerId,
      clubId: selection.clubId,
    })),
  ];
  const project = (nextFacts = facts) =>
    projectPrecisionDraftSessionEvidence({
      ...scope,
      officialName: '2012 Mini-draft',
      selections,
      facts: nextFacts,
      selectedSelectionIds: ['selection-2'],
    });
  const result = project();
  expect(result.inventorySelectionIds).toEqual(['selection-1', 'selection-2']);
  expect(result.selectedSessions[0]).toMatchObject({
    eventDate: null,
    selectionIds: ['selection-2'],
    datePrecision: { earliestDate: '2012-10-08', latestDate: '2012-10-26' },
  });
  expect(result.selectedSessions[0].evidenceIds).toContain('capacity');
  expect(() => project(facts.filter((fact) => fact.kind !== 'completed_session'))).toThrow();
  expect(() =>
    project([
      ...facts,
      { ...rules, evidenceId: 'reported-total', kind: 'completed_draft_total', selectionCount: 2 },
    ])
  ).toThrow('do not mix');
});
