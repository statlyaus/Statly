import { describe, expect, it } from 'vitest';

import {
  resolveCombinedDraftSessionEvidence,
  resolvePrecisionDraftSessionEvidence,
  projectPrecisionDraftSessionEvidence,
  projectCombinedDraftSessionEvidence,
} from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';
import type { CombinedDraftSessionFact } from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';

const id = (kind: string, character: string) => `${kind}:${character.repeat(64)}`;

const selections = Array.from({ length: 78 }, (_, index) => ({
  selectionId: `external-draft-selection:${String(index + 1).padStart(64, '0')}`,
  selectionNumber: index + 1,
  playerId: `player-${index + 1}`,
  clubId: `club-${index + 1}`,
}));

const facts = [
  {
    kind: 'completed_session_date' as const,
    evidenceId: id('external-evidence', 'a'),
    captureId: id('source-capture', 'a'),
    artifactId: id('artifact', 'a'),
    documentId: 'official_afl:news:date-one',
    sessionOrdinal: 1,
    eventDate: '2018-11-22',
  },
  {
    kind: 'completed_session' as const,
    evidenceId: id('external-evidence', 'g'),
    captureId: id('source-capture', 'g'),
    artifactId: id('artifact', 'g'),
    documentId: 'official_afl:news:complete-one',
    sessionOrdinal: 1,
  },
  {
    kind: 'session_boundary' as const,
    evidenceId: id('external-evidence', 'b'),
    captureId: id('source-capture', 'b'),
    artifactId: id('artifact', 'b'),
    documentId: 'official_afl:news:first-selection',
    sessionOrdinal: 1,
    boundary: 'first' as const,
    selectionNumber: 1,
    playerId: 'player-1',
    clubId: 'club-1',
  },
  {
    kind: 'session_boundary' as const,
    evidenceId: id('external-evidence', 'c'),
    captureId: id('source-capture', 'c'),
    artifactId: id('artifact', 'c'),
    documentId: 'official_afl:news:day-two-first',
    sessionOrdinal: 2,
    boundary: 'first' as const,
    selectionNumber: 23,
    playerId: 'player-23',
    clubId: 'club-23',
  },
  {
    kind: 'completed_session_date' as const,
    evidenceId: id('external-evidence', 'd'),
    captureId: id('source-capture', 'd'),
    artifactId: id('artifact', 'd'),
    documentId: 'official_afl:news:day-two-date',
    sessionOrdinal: 2,
    eventDate: '2018-11-23',
  },
  {
    kind: 'completed_session' as const,
    evidenceId: id('external-evidence', 'h'),
    captureId: id('source-capture', 'h'),
    artifactId: id('artifact', 'h'),
    documentId: 'official_afl:news:day-two-complete',
    sessionOrdinal: 2,
  },
  {
    kind: 'session_boundary' as const,
    evidenceId: id('external-evidence', 'e'),
    captureId: id('source-capture', 'e'),
    artifactId: id('artifact', 'e'),
    documentId: 'official_afl:news:terminal-selection',
    sessionOrdinal: 2,
    boundary: 'last' as const,
    selectionNumber: 78,
    playerId: 'player-78',
    clubId: 'club-78',
  },
  {
    kind: 'completed_draft_total' as const,
    evidenceId: id('external-evidence', 'f'),
    captureId: id('source-capture', 'f'),
    artifactId: id('artifact', 'f'),
    documentId: 'official_afl:news:completed-total',
    selectionCount: 78,
  },
];

const selections2016 = Array.from({ length: 77 }, (_, index) => ({
  selectionId: `external-draft-selection:2016-${String(index + 1).padStart(2, '0')}`,
  selectionNumber: index + 1,
  playerId:
    index === 0 ? 'andrew-mcgrath' : index === 76 ? 'jake-waterman' : `player-2016-${index + 1}`,
  clubId: index === 0 ? 'essendon' : index === 76 ? 'west-coast' : `club-2016-${index + 1}`,
}));

const facts2016 = [
  {
    kind: 'completed_session_date',
    evidenceId: id('external-evidence', '1'),
    captureId: id('source-capture', '1'),
    artifactId: id('artifact', '1'),
    documentId: 'official_afl:news:157359',
    sessionOrdinal: 1,
    eventDate: '2016-11-25',
  },
  {
    kind: 'completed_session',
    evidenceId: id('external-evidence', '2'),
    captureId: id('source-capture', '1'),
    artifactId: id('artifact', '1'),
    documentId: 'official_afl:news:157359',
    sessionOrdinal: 1,
  },
  {
    kind: 'session_boundary',
    evidenceId: id('external-evidence', '3'),
    captureId: id('source-capture', '1'),
    artifactId: id('artifact', '1'),
    documentId: 'official_afl:news:157359',
    sessionOrdinal: 1,
    boundary: 'first',
    selectionNumber: 1,
    playerId: 'andrew-mcgrath',
    clubId: 'essendon',
  },
  {
    kind: 'session_boundary',
    evidenceId: id('external-evidence', '4'),
    captureId: id('source-capture', '1'),
    artifactId: id('artifact', '1'),
    documentId: 'official_afl:news:157359',
    sessionOrdinal: 1,
    boundary: 'last',
    selectionNumber: 77,
    playerId: 'jake-waterman',
    clubId: 'west-coast',
  },
  {
    kind: 'completed_session_date',
    evidenceId: id('external-evidence', '5'),
    captureId: id('source-capture', '5'),
    artifactId: id('artifact', '5'),
    documentId: 'official_afl:news:49872',
    sessionOrdinal: 1,
    eventDate: '2016-11-25',
  },
  {
    kind: 'completed_draft_total',
    evidenceId: id('external-evidence', '6'),
    captureId: id('source-capture', '6'),
    artifactId: id('artifact', '6'),
    documentId: 'official_afl:news:149290',
    selectionCount: 77,
  },
] satisfies CombinedDraftSessionFact[];

describe('combined draft-session evidence', () => {
  const resolve2016 = (selected = selections2016, proof: CombinedDraftSessionFact[] = facts2016) =>
    resolveCombinedDraftSessionEvidence({
      draftYear: 2016,
      draftType: 'national',
      officialName: '2016 AFL Draft',
      selections: selected,
      facts: proof,
    });

  it('derives the reviewed 2016 one-session coverage from all six facts', () => {
    expect(resolve2016()).toEqual([
      {
        draftYear: 2016,
        draftType: 'national',
        officialName: '2016 AFL Draft',
        sessionOrdinal: 1,
        eventDate: '2016-11-25',
        selectionIds: selections2016.map(({ selectionId }) => selectionId).sort(),
        evidenceIds: facts2016.map(({ evidenceId }) => evidenceId).sort(),
      },
    ]);
  });

  it.each([
    ['missing selection', selections2016.filter(({ selectionNumber }) => selectionNumber !== 38)],
    [
      'duplicate selection number',
      [...selections2016, { ...selections2016[76]!, selectionId: 'duplicate' }],
    ],
    [
      'noncontiguous selection',
      selections2016.map((selection) =>
        selection.selectionNumber === 38 ? { ...selection, selectionNumber: 78 } : selection
      ),
    ],
  ])('rejects a 2016 inventory with a %s', (_, selected) => {
    expect(() => resolve2016(selected)).toThrow(/inventory/);
  });

  it.each([76, 78])('rejects terminal selection number %s against total 77', (selectionNumber) => {
    expect(() =>
      resolve2016(
        selections2016,
        facts2016.map((fact) =>
          fact.kind === 'session_boundary' && fact.boundary === 'last'
            ? { ...fact, selectionNumber }
            : fact
        )
      )
    ).toThrow();
  });

  it('rejects an unmodelled extra session', () => {
    expect(() =>
      resolve2016(selections2016, [
        ...facts2016,
        {
          kind: 'completed_session_date',
          evidenceId: id('external-evidence', '7'),
          captureId: id('source-capture', '7'),
          artifactId: id('artifact', '7'),
          documentId: 'official_afl:news:extra-session',
          sessionOrdinal: 2,
          eventDate: '2016-11-26',
        },
        {
          kind: 'completed_session',
          evidenceId: id('external-evidence', '8'),
          captureId: id('source-capture', '8'),
          artifactId: id('artifact', '8'),
          documentId: 'official_afl:news:extra-session',
          sessionOrdinal: 2,
        },
      ])
    ).toThrow();
  });

  it.each([
    ['first player', 'first', 'wrong-player', 'essendon'],
    ['first club', 'first', 'andrew-mcgrath', 'wrong-club'],
    ['last player', 'last', 'wrong-player', 'west-coast'],
    ['last club', 'last', 'jake-waterman', 'wrong-club'],
  ] as const)('rejects a wrong 2016 %s identity', (_, boundary, playerId, clubId) => {
    expect(() =>
      resolve2016(
        selections2016,
        facts2016.map((fact) =>
          fact.kind === 'session_boundary' && fact.boundary === boundary
            ? { ...fact, playerId, clubId }
            : fact
        )
      )
    ).toThrow('boundary identity');
  });

  it.each(['first', 'last'] as const)(
    'rejects unresolved %s boundary identities even when both sources agree',
    (boundary) => {
      const selectionNumber = boundary === 'first' ? 1 : 77;
      for (const field of ['playerId', 'clubId'] as const) {
        for (const missing of ['', '   ']) {
          expect(() =>
            resolve2016(
              selections2016.map((selection) =>
                selection.selectionNumber === selectionNumber
                  ? { ...selection, [field]: missing }
                  : selection
              ),
              facts2016.map((fact) =>
                fact.kind === 'session_boundary' && fact.boundary === boundary
                  ? { ...fact, [field]: missing }
                  : fact
              )
            )
          ).toThrow('boundary identity');
        }
      }
    }
  );

  it.each(['captureId', 'artifactId'] as const)(
    'rejects 2016 total evidence sharing the terminal %s',
    (field) => {
      const terminal = facts2016.find(
        (fact) => fact.kind === 'session_boundary' && fact.boundary === 'last'
      )!;
      expect(() =>
        resolve2016(
          selections2016,
          facts2016.map((fact) =>
            fact.kind === 'completed_draft_total' ? { ...fact, [field]: terminal[field] } : fact
          )
        )
      ).toThrow('independent authenticated document');
    }
  );

  it('derives exact 2018 session membership from the complete inventory and all proof facts', () => {
    const sessions = resolveCombinedDraftSessionEvidence({
      draftYear: 2018,
      draftType: 'national',
      officialName: '2018 NAB AFL Draft',
      selections,
      facts,
    });

    expect(sessions).toEqual([
      {
        draftYear: 2018,
        draftType: 'national',
        officialName: '2018 NAB AFL Draft',
        sessionOrdinal: 1,
        eventDate: '2018-11-22',
        selectionIds: selections
          .slice(0, 22)
          .map(({ selectionId }) => selectionId)
          .sort(),
        evidenceIds: facts.map(({ evidenceId }) => evidenceId).sort(),
      },
      {
        draftYear: 2018,
        draftType: 'national',
        officialName: '2018 NAB AFL Draft',
        sessionOrdinal: 2,
        eventDate: '2018-11-23',
        selectionIds: selections
          .slice(22)
          .map(({ selectionId }) => selectionId)
          .sort(),
        evidenceIds: facts.map(({ evidenceId }) => evidenceId).sort(),
      },
    ]);
  });

  it('rejects contradictory boundary evidence outside the minimum selected proof', () => {
    expect(() =>
      resolveCombinedDraftSessionEvidence({
        draftYear: 2018,
        draftType: 'national',
        officialName: '2018 NAB AFL Draft',
        selections,
        facts: [
          ...facts,
          {
            kind: 'session_boundary',
            evidenceId: id('external-evidence', '9'),
            captureId: id('source-capture', '9'),
            artifactId: id('artifact', '9'),
            documentId: 'official_afl:news:contradictory-boundary',
            sessionOrdinal: 1,
            boundary: 'last',
            selectionNumber: 21,
            playerId: 'player-21',
            clubId: 'club-21',
          },
        ],
      })
    ).toThrow('contradictory');
  });

  it('does not treat a calendar date as evidence that its session completed', () => {
    expect(() =>
      resolveCombinedDraftSessionEvidence({
        draftYear: 2018,
        draftType: 'national',
        officialName: '2018 NAB AFL Draft',
        selections,
        facts: facts.filter(
          (fact) => !(fact.kind === 'completed_session' && fact.sessionOrdinal === 1)
        ),
      })
    ).toThrow('completed-session');
  });

  it('does not treat another capture of the terminal article as independent total evidence', () => {
    expect(() =>
      resolveCombinedDraftSessionEvidence({
        draftYear: 2018,
        draftType: 'national',
        officialName: '2018 NAB AFL Draft',
        selections,
        facts: facts.map((fact) =>
          fact.kind === 'completed_draft_total'
            ? {
                ...fact,
                captureId: id('source-capture', '9'),
                artifactId: id('artifact', '9'),
                documentId: 'official_afl:news:terminal-selection',
              }
            : fact
        ),
      })
    ).toThrow('independent authenticated document');
  });
});

describe('complete-inventory session projection', () => {
  const input = {
    draftYear: 2018,
    draftType: 'national',
    officialName: '2018 NAB AFL Draft',
    selections,
    facts,
  };
  it('keeps the complete proof and original session ordinal when only the later session is selected', () => {
    const before = structuredClone(input);
    const selectedSelectionIds = [selections[50]!.selectionId, selections[30]!.selectionId];
    const proof = projectCombinedDraftSessionEvidence({ ...input, selectedSelectionIds });
    expect(proof.inventorySelectionIds).toHaveLength(78);
    expect(proof.inventorySessions.map((s) => s.selectionIds.length)).toEqual([22, 56]);
    expect(proof.selectedSessions).toEqual([
      { ...proof.inventorySessions[1], selectionIds: [...selectedSelectionIds].sort() },
    ]);
    expect(proof.selectedSessions[0]!.sessionOrdinal).toBe(2);
    expect(input).toEqual(before);
    expect(proof.selectedSelectionIds).toEqual([...selectedSelectionIds].sort());
  });
  it('proves full inventory even when selected members do not include a boundary', () => {
    const selectedSelectionIds = [selections[30]!.selectionId];
    for (const changed of [
      { selections: selections.filter((s) => s.selectionNumber !== 1) },
      { selections: selections.filter((s) => s.selectionNumber !== 50) },
      { facts: facts.filter((f) => f.kind !== 'completed_draft_total') },
      {
        facts: facts.map((f) =>
          f.kind === 'session_boundary' && f.boundary === 'last' ? { ...f, playerId: 'wrong' } : f
        ),
      },
    ])
      expect(() =>
        projectCombinedDraftSessionEvidence({ ...input, ...changed, selectedSelectionIds })
      ).toThrow();
  });
  it.each(
    [[], ['outside'], [selections[0]!.selectionId, selections[0]!.selectionId]].map((ids) => [ids])
  )('rejects invalid projected membership %j', (selectedSelectionIds) => {
    expect(() => projectCombinedDraftSessionEvidence({ ...input, selectedSelectionIds })).toThrow(
      'unique subset'
    );
  });
  it('returns full coverage unchanged when every member is selected', () => {
    const proof = projectCombinedDraftSessionEvidence({
      ...input,
      selectedSelectionIds: selections.map((s) => s.selectionId),
    });
    expect(proof.selectedSessions).toEqual(proof.inventorySessions);
  });
});

describe('explicit completed inventory', () => {
  function gappedInput() {
    const number = (value: number) => (value < 23 ? value : value + 10);
    return {
      draftYear: 2018,
      draftType: 'national',
      officialName: '2018 national draft',
      selections: selections.map((selection) => ({
        ...selection,
        selectionNumber: number(selection.selectionNumber),
      })),
      facts: [
        ...facts.map((fact) =>
          fact.kind === 'session_boundary'
            ? { ...fact, selectionNumber: number(fact.selectionNumber) }
            : { ...fact }
        ),
        {
          kind: 'completed_draft_inventory',
          evidenceId: id('external-evidence', 'i'),
          captureId: id('source-capture', 'i'),
          artifactId: id('artifact', 'i'),
          documentId: 'official_afl:news:complete-membership',
          selectionNumbers: selections.map((selection) => number(selection.selectionNumber)),
        },
      ] as CombinedDraftSessionFact[],
    };
  }

  it('partitions original nonconsecutive numbers across dated sessions before projection', () => {
    const input = gappedInput();
    const result = projectCombinedDraftSessionEvidence({
      ...input,
      selectedSelectionIds: [input.selections.at(-1)!.selectionId],
    });
    expect(result.inventorySessions.map((session) => session.selectionIds.length)).toEqual([
      22, 56,
    ]);
    expect(result.selectedSessions).toHaveLength(1);
    expect(result.selectedSessions[0]?.sessionOrdinal).toBe(2);
    expect(result.selectedSessions[0]?.evidenceIds).toContain(id('external-evidence', 'i'));
  });

  it.each(['missing', 'added', 'duplicate', 'renumbered'] as const)(
    'rejects %s membership even when retained inventory is unchanged',
    (change) => {
      const input = gappedInput();
      const inventory = input.facts.find((fact) => fact.kind === 'completed_draft_inventory')!;
      const numbers = [...inventory.selectionNumbers];
      if (change === 'missing') numbers.pop();
      if (change === 'added') numbers.push(89);
      if (change === 'duplicate') numbers[1] = numbers[0]!;
      if (change === 'renumbered') numbers[22] = 23;
      inventory.selectionNumbers = numbers;
      expect(() => resolveCombinedDraftSessionEvidence(input)).toThrow('Completed membership');
    }
  );

  it('does not permit gaps without explicit membership', () => {
    const input = gappedInput();
    input.facts = input.facts.filter((fact) => fact.kind !== 'completed_draft_inventory');
    expect(() => resolveCombinedDraftSessionEvidence(input)).toThrow(
      'explicit completed membership'
    );
  });

  it('rejects a contradictory second membership report', () => {
    const input = gappedInput();
    const inventory = input.facts.find((fact) => fact.kind === 'completed_draft_inventory')!;
    input.facts.push({ ...inventory, selectionNumbers: inventory.selectionNumbers.slice(1) });
    expect(() => resolveCombinedDraftSessionEvidence(input)).toThrow('Completed membership');
  });

  it('still requires independent total evidence and accurate boundary identities', () => {
    const input = gappedInput();
    const last = input.facts.find(
      (fact) => fact.kind === 'session_boundary' && fact.boundary === 'last'
    )!;
    const total = input.facts.find((fact) => fact.kind === 'completed_draft_total')!;
    total.documentId = last.documentId;
    expect(() => resolveCombinedDraftSessionEvidence(input)).toThrow(
      'independent authenticated document'
    );
    const wrong = gappedInput();
    const boundary = wrong.facts.find((fact) => fact.kind === 'session_boundary')!;
    if (boundary.kind === 'session_boundary') boundary.playerId = 'wrong';
    expect(() => resolveCombinedDraftSessionEvidence(wrong)).toThrow('boundary identity');
  });
});


describe('combined session date windows', () => {
  const input = {draftYear: 2018, draftType: 'national', officialName: '2018 draft', selections, facts};
  const windowFacts = (): CombinedDraftSessionFact[] => facts.map(fact => fact.kind === 'completed_session_date' && fact.sessionOrdinal === 2
    ? {kind: 'completed_session_window', evidenceId: fact.evidenceId, captureId: fact.captureId,
        artifactId: fact.artifactId, documentId: fact.documentId, sessionOrdinal: 2,
        datePrecision: {precision: 'window', eventDate: null, earliestDate: '2018-11-23', latestDate: '2018-11-25'}}
    : {...fact});

  it('preserves the exact-day resolver output without introducing precision fields', () => {
    expect(resolvePrecisionDraftSessionEvidence(input)).toEqual(resolveCombinedDraftSessionEvidence(input));
    expect(resolvePrecisionDraftSessionEvidence(input).every(session => !('datePrecision' in session))).toBe(true);
  });
  it('keeps the complete inventory and provenance with null exact day for a proved window', () => {
    const result = resolvePrecisionDraftSessionEvidence({...input, facts: windowFacts()});
    expect(result[1]).toMatchObject({eventDate: null, datePrecision: {earliestDate: '2018-11-23', latestDate: '2018-11-25'}});
    expect(result.flatMap(session => session.selectionIds)).toHaveLength(78);
    expect(result[1]!.evidenceIds).toEqual(resolveCombinedDraftSessionEvidence(input)[1]!.evidenceIds);
    expect(() => resolveCombinedDraftSessionEvidence({...input, facts: windowFacts()})).toThrow('precision-aware');
  });
  it('projects a versioned subset without dropping the complete inventory or date bounds', () => {
    const selectedSelectionIds = [selections[77]!.selectionId];
    const proof = projectPrecisionDraftSessionEvidence({...input, facts: windowFacts(), selectedSelectionIds});
    expect(proof.schemaVersion).toBe('afl-trade-combined-draft-session-projection/v2');
    expect(proof.inventorySelectionIds).toHaveLength(78);
    expect(proof.inventorySessions).toHaveLength(2);
    expect(proof.selectedSessions).toHaveLength(1);
    expect(proof.selectedSessions[0]).toMatchObject({sessionOrdinal: 2, eventDate: null, selectionIds: selectedSelectionIds});
    expect(proof.selectedSessions[0]!.datePrecision).toEqual(proof.inventorySessions[1]!.datePrecision);
    for (const ids of [[], ['not-in-inventory'], [...selectedSelectionIds, ...selectedSelectionIds]]) {
      expect(() => projectPrecisionDraftSessionEvidence({...input, facts: windowFacts(), selectedSelectionIds: ids})).toThrow('subset');
    }
  });
  it('rejects a window overlapping the prior session and conflicting precision evidence', () => {
    const altered = windowFacts();
    const window = altered.find(f => f.kind === 'completed_session_window')!;
    if (window.kind !== 'completed_session_window') throw new Error('fixture');
    window.datePrecision.earliestDate = '2018-11-22';
    expect(() => resolvePrecisionDraftSessionEvidence({...input, facts: altered})).toThrow('overlap');
    expect(() => resolvePrecisionDraftSessionEvidence({...input, facts: [...windowFacts(), facts[4]!]})).toThrow('agreed');
  });
  it('still requires independent totals, completed-session evidence and correct boundary identity', () => {
    expect(() => resolvePrecisionDraftSessionEvidence({...input, facts: windowFacts().filter(f => f.kind !== 'completed_session')})).toThrow('completed-session');
    const shared = windowFacts();
    const total = shared.find(f => f.kind === 'completed_draft_total')!;
    const terminal = shared.find(f => f.kind === 'session_boundary' && f.boundary === 'last')!;
    total.documentId = terminal.documentId;
    expect(() => resolvePrecisionDraftSessionEvidence({...input, facts: shared})).toThrow('independent');
    expect(() => resolvePrecisionDraftSessionEvidence({...input, selections: selections.map((s, i) => i === 77 ? {...s, playerId: 'wrong'} : s), facts: windowFacts()})).toThrow('identity');
  });
});
