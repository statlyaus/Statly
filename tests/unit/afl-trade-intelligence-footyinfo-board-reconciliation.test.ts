import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { isAflTradePickSideReconciliationIssue } from '@/server/aflTradeIntelligence/source/pickLineageDeferral';
import { gradeAflTradesOnRealizedValue } from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';

/**
 * Footyinfo draft-board picks read by reconciliation (statlyaus/Statly#853, #789): a board route
 * orders a Draftguru eventual-selection group the walk alone refuses, and a passed or removed board
 * pick settles a not-used pick with no access evidence.
 */
type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type BoardPick = Extract<Claim, { kind: 'draft_board_pick' }>;
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-10-12T00:00:00.000Z';

function batch(provider: Provider, suffix: string, claims: Claim[]) {
  const capture = {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${digest(suffix)}`,
    contentSha256: digest(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/${provider}/${suffix}`,
    capturedAt,
    effectiveAt: '2024-11-12T00:00:00.000Z',
    parserVersion: `${provider}/v3`,
    fieldManifestSha256: digest('9'),
  };
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider,
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${suffix}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

/** One Draftguru trade page: each leg is [from, to, pick number, eventual player id or null]. */
function page(
  eventId: string,
  legs: [string, string, number, string | null][],
  options: { tradedOn?: number[] } = {}
): Claim[] {
  const clubs = [...new Set(legs.flatMap(([from, to]) => [from, to]))];
  const transferId = (slot: number) => `pick:2024:national:${slot}`;
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: 2024,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
    },
    ...clubs.map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: eventId,
      nativePartyId: club.toLowerCase(),
      club: { nativeId: null, recordedName: club },
    })),
    ...legs.map(([from, to, slot]): Claim => ({
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: transferId(slot),
      fromClub: { nativeId: null, recordedName: from },
      toClub: { nativeId: null, recordedName: to },
      asset: {
        kind: 'current_pick',
        draftYear: 2024,
        draftType: 'national',
        recordedPickNumber: slot,
      },
    })),
    ...legs.flatMap(([, to, slot]): Claim[] =>
      (options.tradedOn ?? []).includes(slot)
        ? [
            {
              kind: 'pick_disposition',
              nativeEventId: eventId,
              nativeTransferId: transferId(slot),
              receivingClub: { nativeId: null, recordedName: to },
              disposition: 'traded_on',
            },
          ]
        : []
    ),
    ...legs.flatMap(([, , slot, player]): Claim[] =>
      player === null
        ? []
        : [
            {
              kind: 'pick_eventual_selection',
              nativeEventId: eventId,
              nativeTransferId: transferId(slot),
              outcome: 'selected',
              player: { nativeId: player, recordedName: player },
            },
          ]
    ),
  ];
}

const custody = (slot: number, holder: string, original: string): Claim => ({
  kind: 'pick_custody',
  observedAt: '2024-11-12T00:00:00.000Z',
  draftYear: 2024,
  draftType: 'national',
  roundNumber: 1,
  recordedPickNumber: slot,
  originalClub: { nativeId: null, recordedName: original },
  currentClub: { nativeId: null, recordedName: holder },
});

const codes: Record<string, string> = {
  Carlton: 'CAR',
  'West Coast': 'WCE',
  'Port Adelaide': 'PAD',
  'Gold Coast': 'GCS',
  Richmond: 'RCH',
  Essendon: 'ESS',
};
const clubs = Object.keys(codes);
const clubId = (club: string) => `club-${club.toLowerCase().replace(/ /g, '-')}`;
const footyinfoClub = (club: string) => ({ nativeId: codes[club]!, recordedName: club });

function identity(
  provider: Provider,
  entityKind: 'club' | 'player',
  sourceIdentity: { nativeId: string | null; recordedName: string },
  canonicalId: string
) {
  return createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider,
    entityKind,
    sourceIdentity,
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-10-11T00:00:00.000Z',
    status: 'current_approved',
  });
}

const joeBerry = { draftguru: 'joe_berry/1', footyinfo: 'joe-berry' };
const baseIdentities = [
  ...clubs.flatMap((club) =>
    (['draftguru', 'official_afl'] as const).map((provider) =>
      identity(provider, 'club', { nativeId: null, recordedName: club }, clubId(club))
    )
  ),
  identity(
    'draftguru',
    'player',
    { nativeId: joeBerry.draftguru, recordedName: 'Joe Berry' },
    'player-joe-berry'
  ),
];
const footyinfoIdentities = [
  ...clubs.map((club) => identity('footyinfo', 'club', footyinfoClub(club), clubId(club))),
  identity(
    'footyinfo',
    'player',
    { nativeId: joeBerry.footyinfo, recordedName: 'Joe Berry' },
    'player-joe-berry'
  ),
];

/** Draftguru's year page: Joe Berry was selected at 15 by the route's last club. */
const draftguruSelection = (holder: string): Claim => ({
  kind: 'draft_selection',
  draftYear: 2024,
  draftType: 'national',
  selectionNumber: 15,
  roundNumber: null,
  player: { nativeId: joeBerry.draftguru, recordedName: 'Joe Berry' },
  selectedByClub: { nativeId: null, recordedName: holder },
});

function boardPick(route: string[], overrides: Partial<BoardPick> = {}): BoardPick {
  return {
    kind: 'draft_board_pick',
    draftYear: 2024,
    draftType: 'national',
    roundNumber: 1,
    recordedPickNumber: 15,
    status: 'selected',
    club: footyinfoClub(route.at(-1)!),
    player: { nativeId: joeBerry.footyinfo, recordedName: 'Joe Berry' },
    route: route.map(footyinfoClub),
    routeLabel: null,
    bid: null,
    points: null,
    note: null,
    ...overrides,
  };
}

function reconcile(
  pages: Claim[][],
  options: {
    order?: Claim[];
    board?: Claim[];
    footyinfo?: ReturnType<typeof identity>[];
    anchorSeasonYear?: number;
  } = {}
) {
  return parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: options.anchorSeasonYear ?? 2024,
      sourceBatches: [
        ...pages.map((claims, index) => batch('draftguru', 'abcde'[index]!, claims)),
        ...(options.order?.length ? [batch('official_afl', 'f', options.order)] : []),
        ...(options.board?.length ? [batch('footyinfo', '7', options.board)] : []),
      ],
      identityResolutions: [...baseIdentities, ...(options.footyinfo ?? footyinfoIdentities)],
      reconciledAt: '2026-10-12T01:00:00.000Z',
    })
  ).content;
}
type Candidate = ReturnType<typeof reconcile>;

const transferOf = (candidate: Candidate, from: string, to: string, slot: number) =>
  candidate.transfers.find(
    (transfer) =>
      transfer.fromClubId === clubId(from) &&
      transfer.toClubId === clubId(to) &&
      transfer.asset.kind === 'pick_entitlement' &&
      transfer.asset.nominalPick === slot
  )!;
const pickIdOf = (transfer: ReturnType<typeof transferOf>) =>
  transfer.asset.kind === 'pick_entitlement' ? transfer.asset.pickId : null;
const boardEvidenceIds = (candidate: Candidate) =>
  (candidate.draftBoardPicks ?? []).flatMap(({ evidenceIds }) => evidenceIds);

function gradeLeg(candidate: Candidate, transferId: string) {
  return gradeAflTradesOnRealizedValue({
    candidateId: `external-reconciliation:${digest('c')}`,
    candidate,
    pavCalculations: [2024, 2025].map((season) => ({
      season,
      calculationId: `hpn-pav-season:${season}`,
      official: true,
    })),
    pav: [],
    seasonSpells: [],
    spellSeasons: [2024, 2025],
    reviewedArrivals: [],
    pickProjectionBenchmarkId: `hpn-pick-benchmark:${digest('b')}`,
    spellCutoffAt: '2026-10-12T00:00:00.000Z',
    gradedAt: '2026-10-12T02:00:00.000Z',
  })
    .content.trades.flatMap(({ legs }) => legs)
    .find((leg) => leg.transferId === transferId)!;
}

// As 2019 #58 Ben Johnson's pick moved (STK → WCE → BRL → ESS → WCE): the first hop predates the
// candidate, so the captured transfers close a loop with no first holder and the walk refuses it.
const loop = (tradedOn: number[] = []) => [
  [
    ...page('2024-picks-port_adelaide-west_coast-21', [
      ['West Coast', 'Port Adelaide', 15, joeBerry.draftguru],
    ]),
    draftguruSelection('West Coast'),
  ],
  page(
    '2024-picks-port_adelaide-richmond-22',
    [['Port Adelaide', 'Richmond', 20, joeBerry.draftguru]],
    {
      tradedOn,
    }
  ),
  page('2024-picks-richmond-west_coast-23', [['Richmond', 'West Coast', 30, joeBerry.draftguru]]),
];
const loopRoute = boardPick(['Carlton', 'West Coast', 'Port Adelaide', 'Richmond', 'West Coast']);
const loopIds = (candidate: Candidate) =>
  new Set(
    [
      transferOf(candidate, 'West Coast', 'Port Adelaide', 15),
      transferOf(candidate, 'Port Adelaide', 'Richmond', 20),
      transferOf(candidate, 'Richmond', 'West Coast', 30),
    ].map(pickIdOf)
  );

describe('Footyinfo board routes order an eventual-selection group (issue 853)', () => {
  it('keys a refused loop as one pick when the board route names every hop in order', () => {
    expect(loopIds(reconcile(loop())).size).toBe(3);
    const candidate = reconcile(loop(), { board: [loopRoute] });
    expect(loopIds(candidate).size).toBe(1);
    // The board row that ordered the walk is cited on each hop it keyed.
    const [boardRow] = boardEvidenceIds(candidate);
    expect(transferOf(candidate, 'Port Adelaide', 'Richmond', 20).evidenceIds).toContain(boardRow);
  });

  it('lets the grader follow an unlinked traded-on leg into its route-stated onward trade', () => {
    const leg = (candidate: Candidate) =>
      gradeLeg(candidate, transferOf(candidate, 'Port Adelaide', 'Richmond', 20).transferId);
    expect(leg(reconcile(loop([20]))).reasons).toEqual(['traded_on_return_unlinked']);
    // Linked to Richmond → West Coast. West Coast's received pick has no stated outcome here, so
    // that trade is blocked; under rule v3 Richmond's own side (it received nothing) is known, so
    // the leg is valued on it and partial.
    expect(leg(reconcile(loop([20]), { board: [loopRoute] })).reasons).toEqual([
      'traded_on_return_partial',
    ]);
  });

  it('keys only the hops the route names when a matched bid merged another pick into the group', () => {
    // As 2023 #37 Tew Jiath (WBD → FRE → HAW → COL): Essendon's pick 33 also names Joe Berry.
    const pages = [
      [
        ...page('2024-liam-baker-matt-owies', [['Carlton', 'West Coast', 12, joeBerry.draftguru]]),
        draftguruSelection('Port Adelaide'),
      ],
      page('2024-picks-port_adelaide-west_coast-21', [
        ['West Coast', 'Port Adelaide', 15, joeBerry.draftguru],
      ]),
      page('2024-picks-essendon-port_adelaide-8', [
        ['Essendon', 'Port Adelaide', 33, joeBerry.draftguru],
      ]),
    ];
    const order = [custody(12, 'West Coast', 'Carlton')];
    const refused = reconcile(pages, { order });
    const custodyPick = refused.pickCustody[0]!.pickId;
    expect(pickIdOf(transferOf(refused, 'West Coast', 'Port Adelaide', 15))).not.toBe(custodyPick);

    const candidate = reconcile(pages, {
      order,
      board: [boardPick(['Carlton', 'West Coast', 'Port Adelaide'])],
    });
    expect(pickIdOf(transferOf(candidate, 'Carlton', 'West Coast', 12))).toBe(custodyPick);
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).toBe(custodyPick);
    expect(transferOf(candidate, 'West Coast', 'Port Adelaide', 15).status).toBe('single_source');
    expect(pickIdOf(transferOf(candidate, 'Essendon', 'Port Adelaide', 33))).toBe(
      pickIdOf(transferOf(refused, 'Essendon', 'Port Adelaide', 33))
    );
  });

  it('reads no route that does not name the clubs in order, or names another player', () => {
    const unchanged = loopIds(reconcile(loop()));
    for (const board of [
      // Port Adelaide → Richmond is not a hop of this route.
      boardPick(['Carlton', 'West Coast', 'Port Adelaide', 'Gold Coast', 'West Coast']),
      // A route that passes the same pair twice names neither occurrence.
      boardPick([
        'West Coast',
        'Port Adelaide',
        'Richmond',
        'West Coast',
        'Port Adelaide',
        'Richmond',
        'West Coast',
      ]),
      // The board's player at 15 is someone else.
      boardPick(['Carlton', 'West Coast', 'Port Adelaide', 'Richmond', 'West Coast'], {
        player: { nativeId: 'someone-else', recordedName: 'Someone Else' },
      }),
      // The board's 15 is held by another club than Draftguru's selection names.
      boardPick(['Carlton', 'West Coast', 'Port Adelaide', 'Richmond']),
    ]) {
      expect(loopIds(reconcile(loop(), { board: [board] }))).toEqual(unchanged);
    }
  });

  it('reads no route without the footyinfo identity resolutions', () => {
    const candidate = reconcile(loop(), { board: [loopRoute], footyinfo: [] });
    expect(loopIds(candidate).size).toBe(3);
    const issue = candidate.issues.find(({ subjectKey }) => subjectKey === 'board-pick:club:WCE')!;
    expect(issue).toMatchObject({ code: 'identity_unresolved', severity: 'blocking' });
    // One issue per club, citing every row that names it; pick-side, so a deferral can defer it.
    expect(issue.evidenceIds).toEqual(boardEvidenceIds(candidate));
    expect(isAflTradePickSideReconciliationIssue(issue)).toBe(true);
    expect(candidate.draftBoardPicks).toEqual([
      expect.objectContaining({ clubId: null, routeClubIds: null }),
    ]);
  });

  it('chooses the custody pick whose original club starts the route when a walk reaches two', () => {
    const future: Claim[] = [
      {
        kind: 'transaction',
        nativeEventId: '2023-carlton-west_coast',
        seasonYear: 2023,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
      },
      ...['Carlton', 'West Coast'].map((club): Claim => ({
        kind: 'transaction_party',
        nativeEventId: '2023-carlton-west_coast',
        nativePartyId: club.toLowerCase(),
        club: { nativeId: null, recordedName: club },
      })),
      {
        kind: 'directed_transfer',
        nativeEventId: '2023-carlton-west_coast',
        nativeTransferId: 'future-pick:2024:national:1:carlton',
        fromClub: { nativeId: null, recordedName: 'Carlton' },
        toClub: { nativeId: null, recordedName: 'West Coast' },
        asset: {
          kind: 'future_pick',
          draftYear: 2024,
          draftType: 'national',
          roundNumber: 1,
          originalClub: { nativeId: null, recordedName: 'Carlton' },
        },
      },
      {
        kind: 'pick_eventual_selection',
        nativeEventId: '2023-carlton-west_coast',
        nativeTransferId: 'future-pick:2024:national:1:carlton',
        outcome: 'selected',
        player: { nativeId: joeBerry.draftguru, recordedName: 'Joe Berry' },
      },
      draftguruSelection('Port Adelaide'),
    ];
    const pages = [
      future,
      page('2024-picks-port_adelaide-west_coast-21', [
        ['West Coast', 'Port Adelaide', 15, joeBerry.draftguru],
      ]),
    ];
    const order = [
      custody(12, 'Port Adelaide', 'Carlton'),
      custody(15, 'Port Adelaide', 'West Coast'),
    ];
    const subject = 'eventual-selection:2024|national|joe_berry/1';
    expect(reconcile(pages, { order }).issues.map(({ subjectKey }) => subjectKey)).toContain(
      subject
    );

    const candidate = reconcile(pages, {
      order,
      board: [boardPick(['Carlton', 'West Coast', 'Port Adelaide'])],
    });
    const twelve = candidate.pickCustody.find(
      ({ recordedPickNumber }) => recordedPickNumber === 12
    )!;
    const onward = transferOf(candidate, 'West Coast', 'Port Adelaide', 15);
    expect(onward.status).toBe('single_source');
    expect(pickIdOf(onward)).toBe(twelve.pickId);
    expect(candidate.issues.map(({ subjectKey }) => subjectKey)).not.toContain(subject);

    // A route whose first club is neither custody pick's original club chooses nothing.
    const other = reconcile(pages, {
      order,
      board: [boardPick(['Gold Coast', 'West Coast', 'Port Adelaide'])],
    });
    expect(other.issues.map(({ subjectKey }) => subjectKey)).toContain(subject);
  });
});

describe('Footyinfo passed and removed picks as not-used evidence (issue 853)', () => {
  // Carlton's 2024 second-rounder went to West Coast, which did not use it.
  const futureTrade = (round = 2): Claim[] => [
    {
      kind: 'transaction',
      nativeEventId: '2023-carlton-west_coast-r2',
      seasonYear: 2023,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
    },
    ...['Carlton', 'West Coast'].map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: '2023-carlton-west_coast-r2',
      nativePartyId: club.toLowerCase(),
      club: { nativeId: null, recordedName: club },
    })),
    {
      kind: 'directed_transfer',
      nativeEventId: '2023-carlton-west_coast-r2',
      nativeTransferId: 'future-pick:2024:national:2:carlton',
      fromClub: { nativeId: null, recordedName: 'Carlton' },
      toClub: { nativeId: null, recordedName: 'West Coast' },
      asset: {
        kind: 'future_pick',
        draftYear: 2024,
        draftType: 'national',
        roundNumber: round,
        originalClub: { nativeId: null, recordedName: 'Carlton' },
      },
    },
    {
      kind: 'pick_disposition',
      nativeEventId: '2023-carlton-west_coast-r2',
      nativeTransferId: 'future-pick:2024:national:2:carlton',
      receivingClub: { nativeId: null, recordedName: 'West Coast' },
      disposition: 'not_used',
    },
  ];
  const passed = (overrides: Partial<BoardPick> = {}) =>
    boardPick(['Carlton', 'West Coast'], {
      roundNumber: 2,
      recordedPickNumber: null,
      status: 'passed',
      player: undefined,
      note: 'Not used',
      ...overrides,
    });
  // `player: undefined` must not be a key on a non-selected board pick.
  const claim = (pick: BoardPick): Claim => {
    const { player, ...rest } = pick;
    return player === undefined ? rest : pick;
  };
  const outcomeOf = (board: BoardPick[], round = 2) =>
    reconcile([futureTrade(round)], { board: board.map(claim) }).pickOutcomes![0]!;
  // Without a board, a selection in the 2024 draft shows it was held, so the pick is not pending.
  const heldDraft = [draftguruSelection('West Coast')];

  it('settles a not-used pick with no access evidence from its one passed board pick', () => {
    expect(reconcile([futureTrade(), heldDraft]).pickOutcomes![0]!.nominationBasis).toBe(
      'no_access_evidence'
    );
    const candidate = reconcile([futureTrade()], { board: [claim(passed())] });
    const [board] = candidate.draftBoardPicks!;
    const outcome = candidate.pickOutcomes![0]!;
    expect(outcome).toMatchObject({
      disposition: 'not_used',
      outcomeStatus: 'stated',
      nominationBasis: 'board_pick_passed_or_removed',
      boardPickId: board!.boardPickId,
    });
    expect(outcome.receivingClubNominatedSelections).toBeUndefined();
    expect(outcome.evidenceIds).toEqual(expect.arrayContaining(board!.evidenceIds));
    expect(board).toMatchObject({
      status: 'passed',
      clubId: clubId('West Coast'),
      routeClubIds: [clubId('Carlton'), clubId('West Coast')],
    });
  });

  it('accepts a removed board pick the same way', () => {
    expect(
      outcomeOf([passed({ status: 'removed', note: 'Removed - not enough list spots' })])
        .nominationBasis
    ).toBe('board_pick_passed_or_removed');
  });

  it('leaves the pick without access evidence when the board does not settle it', () => {
    for (const board of [
      // Another round.
      [passed({ roundNumber: 3 })],
      // Another holder.
      [
        passed({
          club: footyinfoClub('Richmond'),
          route: ['Carlton', 'Richmond'].map(footyinfoClub),
        }),
      ],
      // A route that does not hand it from Carlton to West Coast.
      [passed({ route: ['Gold Coast', 'West Coast'].map(footyinfoClub) })],
      // No printed route.
      [passed({ route: [] })],
      // Two matching board picks.
      [passed(), passed({ note: 'Second' })],
    ]) {
      expect(outcomeOf(board).nominationBasis).toBe('no_access_evidence');
    }
  });

  it('values the board-settled not-used pick at 0 in the grade', () => {
    const transferIdOf = (candidate: Candidate) => candidate.transfers[0]!.transferId;
    const blocked = reconcile([futureTrade(), heldDraft]);
    expect(gradeLeg(blocked, transferIdOf(blocked)).reasons).toEqual([
      'not_used_no_access_evidence',
    ]);
    const settled = reconcile([futureTrade()], { board: [claim(passed())] });
    expect(gradeLeg(settled, transferIdOf(settled))).toMatchObject({
      state: 'valued',
      basis: 'pick_not_used_no_nominee',
      realizedValue: 0,
      // Rule v2: the board corroborates Draftguru's "not used".
      corroboratedBy: 'footyinfo',
      reasons: [],
    });
  });

  it('conserves every board row, read or not, on its board-pick record', () => {
    const rows = [claim(passed()), loopRoute, claim(passed({ roundNumber: 4 }))];
    const candidate = reconcile([futureTrade()], { board: rows });
    expect(new Set(boardEvidenceIds(candidate))).toEqual(
      new Set(batch('footyinfo', '7', rows).content.evidence.map(({ evidenceId }) => evidenceId))
    );
  });

  it('carries a v3 board pick’s original club and pre-draft number, and adds no key before v3', () => {
    const v3 = claim(passed({ originalClub: footyinfoClub('Carlton'), originalNumber: 30 }));
    const v2 = claim(passed({ roundNumber: 4 }));
    const records = reconcile([futureTrade()], { board: [v3, v2] }).draftBoardPicks!;
    const byRound = (round: number) => records.find(({ roundNumber }) => roundNumber === round)!;
    expect(byRound(2)).toMatchObject({ originalClubId: clubId('Carlton'), originalNumber: 30 });
    expect(byRound(4)).not.toHaveProperty('originalClubId');
    expect(byRound(4)).not.toHaveProperty('originalNumber');
  });

  it('refuses a board claim stating an original club without its number, or a route from elsewhere', () => {
    expect(() =>
      batch('footyinfo', '7', [claim(passed({ originalClub: footyinfoClub('Carlton') }))])
    ).toThrow(/original club and pre-draft number together or neither/);
    expect(() =>
      batch('footyinfo', '7', [
        claim(passed({ originalClub: footyinfoClub('Essendon'), originalNumber: 30 })),
      ])
    ).toThrow(/A board route starts with the pick’s original club/);
  });

  it('adds no draftBoardPicks key without a board, so candidate ids are unchanged', () => {
    expect(reconcile([futureTrade()])).not.toHaveProperty('draftBoardPicks');
  });
});
