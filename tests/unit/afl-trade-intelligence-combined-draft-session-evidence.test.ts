import { describe, expect, it } from 'vitest';

import { resolveCombinedDraftSessionEvidence } from '@/server/aflTradeIntelligence/source/combinedDraftSessionEvidence';
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
    expect(() => resolve2016(selected)).toThrow('complete unique contiguous inventory');
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
