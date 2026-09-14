import { describe, expect, it } from 'vitest';
import { resolveCompletedDraftMembership } from '@/server/aflTradeIntelligence/source/completedDraftMembership';

const source = (id: string) => ({
  evidenceId: `e-${id}`,
  captureId: `c-${id}`,
  artifactId: `a-${id}`,
  documentId: `d-${id}`,
  draftYear: 2012,
  draftType: 'national',
});
function input(): Parameters<typeof resolveCompletedDraftMembership>[0] {
  return {
    draftYear: 2012,
    draftType: 'national',
    inventoryNumbers: [1, 70, 88],
    roster: {
      ...source('roster'),
      kind: 'completed_draft_membership_roster',
      members: [
        { recordedName: 'First', selectionNumber: 1 },
        { recordedName: 'Elevated', selectionNumber: 57 },
        { recordedName: 'Supplement', selectionNumber: 70 },
        { recordedName: 'Last', selectionNumber: 88 },
      ],
    },
    bindings: [],
    exclusions: [
      {
        ...source('classification'),
        kind: 'completed_draft_member_exclusion',
        recordedName: 'Elevated',
        reason: 'rookie_elevation',
      },
    ],
  };
}

describe('source-explicit rookie-elevation exclusions', () => {
  it('retains the classification evidence and original numbers without mutating inputs', () => {
    const value = input(),
      before = structuredClone(value);
    expect(resolveCompletedDraftMembership(value)).toEqual({
      schemaVersion: 'afl-trade-completed-draft-membership/v1',
      selectionNumbers: [1, 70, 88],
      evidenceIds: ['e-classification', 'e-roster'],
    });
    expect(value).toEqual(before);
  });
  const invalid: [string, (v: ReturnType<typeof input>) => void][] = [
    [
      'missing classification',
      (v) => {
        v.exclusions = [];
      },
    ],
    [
      'duplicate classification',
      (v) => {
        v.exclusions = [v.exclusions![0]!, { ...v.exclusions![0]!, ...source('second') }];
      },
    ],
    [
      'unknown name',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, recordedName: 'Unknown' }];
      },
    ],
    [
      'invented alias',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, recordedName: 'elevated' }];
      },
    ],
    [
      'wrong year',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, draftYear: 2011 }];
      },
    ],
    [
      'wrong type',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, draftType: 'rookie' }];
      },
    ],
    [
      'wrong reason',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, reason: 'passed' as 'rookie_elevation' }];
      },
    ],
    [
      'same document',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, documentId: v.roster.documentId }];
      },
    ],
    [
      'same capture',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, captureId: v.roster.captureId }];
      },
    ],
    [
      'same artifact',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, artifactId: v.roster.artifactId }];
      },
    ],
    [
      'missing evidence',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, evidenceId: '' }];
      },
    ],
    [
      'duplicate evidence',
      (v) => {
        v.exclusions = [{ ...v.exclusions![0]!, evidenceId: v.roster.evidenceId }];
      },
    ],
    [
      'exclude an inventory member',
      (v) => {
        v.inventoryNumbers = [1, 57, 88];
      },
    ],
    [
      'exclude an unnumbered member',
      (v) => {
        v.roster.members = v.roster.members.map((r) =>
          r.recordedName === 'Elevated' ? { ...r, selectionNumber: null } : r
        );
      },
    ],
    [
      'exclude a duplicated number',
      (v) => {
        v.roster.members = v.roster.members.map((r) =>
          r.recordedName === 'Elevated' ? { ...r, selectionNumber: 70 } : r
        );
      },
    ],
    [
      'exclude an invalid number',
      (v) => {
        v.roster.members = v.roster.members.map((r) =>
          r.recordedName === 'Elevated' ? { ...r, selectionNumber: 0 } : r
        );
      },
    ],
    [
      'renumber survivors',
      (v) => {
        v.inventoryNumbers = [1, 2, 3];
      },
    ],
  ];
  it.each(invalid)('rejects %s', (_, mutate) => {
    const value = input();
    mutate(value);
    expect(() => resolveCompletedDraftMembership(value)).toThrow();
  });
  it('cannot hide a missing number binding behind an exclusion', () => {
    const value = input();
    value.roster.members = value.roster.members.map((r) =>
      r.recordedName === 'Supplement' ? { ...r, selectionNumber: null } : r
    );
    expect(() => resolveCompletedDraftMembership(value)).toThrow();
    value.bindings = [
      {
        ...source('number'),
        kind: 'completed_draft_member_number',
        recordedName: 'Supplement',
        selectionNumber: 70,
      },
    ];
    expect(resolveCompletedDraftMembership(value).evidenceIds).toEqual([
      'e-classification',
      'e-number',
      'e-roster',
    ]);
  });
});
