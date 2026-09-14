import { describe, expect, it } from 'vitest';
import { resolveCompletedDraftMembership } from '@/server/aflTradeIntelligence/source/completedDraftMembership';
import {
  resolveCombinedDraftSessionEvidence,
  type CombinedDraftSessionFact,
} from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';

const source = (id: string) => ({
  evidenceId: `e-${id}`,
  captureId: `c-${id}`,
  artifactId: `a-${id}`,
  documentId: `d-${id}`,
  draftYear: 2014,
  draftType: 'national',
});
function input(): Parameters<typeof resolveCompletedDraftMembership>[0] {
  return {
    draftYear: 2014,
    draftType: 'national',
    inventoryNumbers: [1, 4, 9],
    roster: {
      ...source('roster'),
      kind: 'completed_draft_membership_roster',
      members: [
        { recordedName: 'First Player', selectionNumber: 1 },
        { recordedName: 'Academy Player', selectionNumber: null },
        { recordedName: 'Last Player', selectionNumber: 9 },
      ],
    },
    bindings: [
      {
        ...source('binding'),
        kind: 'completed_draft_member_number',
        recordedName: 'Academy Player',
        selectionNumber: 4,
      },
    ],
  };
}

describe('completed membership across documents', () => {
  it('joins source-explicit numbers without changing input or losing provenance', () => {
    const value = input(),
      before = structuredClone(value);
    expect(resolveCompletedDraftMembership(value)).toEqual({
      schemaVersion: 'afl-trade-completed-draft-membership/v1',
      selectionNumbers: [1, 4, 9],
      evidenceIds: ['e-binding', 'e-roster'],
    });
    expect(value).toEqual(before);
  });
  const corruptions: [string, (value: ReturnType<typeof input>) => void][] = [
    [
      'missing binding',
      (v) => {
        v.bindings = [];
      },
    ],
    [
      'duplicate binding',
      (v) => {
        v.bindings = [v.bindings[0]!, { ...v.bindings[0]!, ...source('other') }];
      },
    ],
    [
      'wrong player',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, recordedName: 'Other Player' }];
      },
    ],
    [
      'invented alias',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, recordedName: 'academy player' }];
      },
    ],
    [
      'wrong year',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, draftYear: 2013 }];
      },
    ],
    [
      'wrong draft type',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, draftType: 'rookie' }];
      },
    ],
    [
      'wrong number',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, selectionNumber: 5 }];
      },
    ],
    [
      'duplicate number',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, selectionNumber: 1 }];
      },
    ],
    [
      'fractional number',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, selectionNumber: 4.5 }];
      },
    ],
    [
      'same document',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, documentId: v.roster.documentId }];
      },
    ],
    [
      'same capture',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, captureId: v.roster.captureId }];
      },
    ],
    [
      'same artifact',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, artifactId: v.roster.artifactId }];
      },
    ],
    [
      'missing evidence',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, evidenceId: '' }];
      },
    ],
    [
      'duplicate roster name',
      (v) => {
        v.roster.members = [...v.roster.members.slice(0, 2), v.roster.members[0]!];
      },
    ],
    [
      'incomplete roster',
      (v) => {
        v.roster.members = v.roster.members.slice(0, 2);
      },
    ],
    [
      'binding for numbered member',
      (v) => {
        v.bindings = [{ ...v.bindings[0]!, recordedName: 'First Player', selectionNumber: 1 }];
      },
    ],
    [
      'renumbered inventory',
      (v) => {
        v.inventoryNumbers = [1, 2, 3];
      },
    ],
    [
      'empty proof',
      (v) => {
        v.inventoryNumbers = [];
        v.roster.members = [];
        v.bindings = [];
      },
    ],
  ];
  it.each(corruptions)('rejects %s', (_, corrupt) => {
    const value = input();
    corrupt(value);
    expect(() => resolveCompletedDraftMembership(value)).toThrow();
  });

  function session() {
    const value = input();
    const facts: CombinedDraftSessionFact[] = [
      value.roster,
      ...value.bindings,
      {
        ...source('date'),
        kind: 'completed_session_date',
        sessionOrdinal: 1,
        eventDate: '2014-11-27',
      },
      { ...source('complete'), kind: 'completed_session', sessionOrdinal: 1 },
      {
        ...source('first'),
        kind: 'session_boundary',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        playerId: 'p1',
        clubId: 'club',
      },
      {
        ...source('last'),
        kind: 'session_boundary',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 9,
        playerId: 'p9',
        clubId: 'club',
      },
      { ...source('total'), kind: 'completed_draft_total', selectionCount: 3 },
    ];
    return {
      draftYear: 2014,
      draftType: 'national',
      officialName: '2014 National Draft',
      selections: [1, 4, 9].map((n) => ({
        selectionId: `s${n}`,
        selectionNumber: n,
        playerId: `p${n}`,
        clubId: 'club',
      })),
      facts,
    };
  }
  it('preserves every joined evidence ID in combined session coverage', () => {
    const value = session(),
      result = resolveCombinedDraftSessionEvidence(value);
    expect(result[0]!.selectionIds).toEqual(['s1', 's4', 's9']);
    expect(result[0]!.evidenceIds).toEqual(value.facts.map((f) => f.evidenceId).sort());
  });
  it.each([
    'completed_draft_membership_roster',
    'completed_draft_member_number',
    'completed_session',
    'completed_draft_total',
  ])('rejects removal of required %s', (kind) => {
    const value = session();
    value.facts = value.facts.filter((f) => f.kind !== kind);
    expect(() => resolveCombinedDraftSessionEvidence(value)).toThrow();
  });
  it('still rejects an incomplete legacy complete-inventory claim', () => {
    const value = session();
    value.facts.push({
      ...source('legacy'),
      kind: 'completed_draft_inventory',
      selectionNumbers: [1, 9],
    });
    expect(() => resolveCombinedDraftSessionEvidence(value)).toThrow();
  });
});
