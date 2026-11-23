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
  aflTradeOrderEntitlementContradicts,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
type OrderClaim = Extract<Claim, { kind: 'draft_order_pick' }>;
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-11-23T00:00:00.000Z';

function batch(
  suffix: string,
  claims: readonly Claim[],
  provider: 'draftguru' | 'official_afl' = 'draftguru'
) {
  const capture = {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${digest(suffix)}`,
    contentSha256: digest(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/draftguru/${suffix}`,
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: 'draftguru/test',
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
        sourceRow: { ordinal: index + 1, sourceKey: `draftguru:${suffix}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

// Trade pages name clubs by header text; the year and order pages by Draftguru club id and cell text.
const CLUBS = {
  Hawthorn: 'hawthorn',
  Essendon: 'essendon',
  Brisbane: 'brisbane',
  'Port Adelaide': 'port-adelaide',
  Richmond: 'richmond',
  Carlton: 'carlton',
  GWS: 'greater-western-sydney',
} as const;
type Club = keyof typeof CLUBS;
const page = (club: Club) => ({ nativeId: null, recordedName: club });
const cell = (club: Club) => ({ nativeId: CLUBS[club], recordedName: club });
const person = (name: string) => ({
  nativeId: `${name.toLowerCase().replace(/ /g, '_')}/1`,
  recordedName: name,
});
const clubId = (club: Club) => `club-${CLUBS[club]}`;
const playerId = (name: string) => `player-${name.toLowerCase().replace(/ /g, '-')}`;
const PLAYERS = [
  'Archie Elliott',
  'Archie Van Dyk',
  'Dougie Cochrane',
  'Zach Merrett',
  'Kai Coleman',
  'Other Player',
  'Clancy Snell',
  'Cooper Hodge',
];

const resolution = (
  entityKind: 'club' | 'player',
  sourceIdentity: { nativeId: string | null; recordedName: string },
  canonicalId: string,
  provider: 'draftguru' | 'official_afl' = 'draftguru'
) =>
  createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider,
    entityKind,
    sourceIdentity,
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-11-22T00:00:00.000Z',
    status: 'current_approved',
  });
const identityResolutions = [
  ...(Object.keys(CLUBS) as Club[]).flatMap((club) => [
    resolution('club', page(club), clubId(club)),
    resolution('club', cell(club), clubId(club)),
  ]),
  ...PLAYERS.flatMap((name) => [
    resolution('player', person(name), playerId(name)),
    resolution('player', { nativeId: null, recordedName: name }, playerId(name)),
  ]),
];

const pickKey = (year: number, number: number) => `pick:${year}:national:${number}`;

/**
 * One Draftguru trade page: each pick moves `from` → `to` as `Pick <n>` with the receiving side's
 * stated outcome, and a player moves back.
 */
function trade(
  eventId: string,
  year: number,
  from: Club,
  to: Club,
  picks: readonly { number: number; stated: 'not_used' | 'traded_on' | { player: string } }[],
  playerName: string
): Claim[] {
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: year,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
    },
    ...[from, to].map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: eventId,
      nativePartyId: CLUBS[club],
      club: page(club),
    })),
    ...picks.flatMap(({ number, stated }): Claim[] => [
      {
        kind: 'directed_transfer',
        nativeEventId: eventId,
        nativeTransferId: pickKey(year, number),
        fromClub: page(from),
        toClub: page(to),
        asset: {
          kind: 'current_pick',
          draftYear: year,
          draftType: 'national',
          recordedPickNumber: number,
        },
      },
      {
        kind: 'pick_disposition',
        nativeEventId: eventId,
        nativeTransferId: pickKey(year, number),
        receivingClub: page(to),
        ...(typeof stated === 'string'
          ? { disposition: stated }
          : {
              disposition: 'selected' as const,
              player: { nativeId: null, recordedName: stated.player },
            }),
      },
    ]),
    {
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: `player:${playerName}`,
      fromClub: page(to),
      toClub: page(from),
      asset: { kind: 'player', player: { nativeId: null, recordedName: playerName } },
    },
  ];
}

const selection = (year: number, number: number, name: string, club: Club): Claim => ({
  kind: 'draft_selection',
  draftYear: year,
  draftType: 'national',
  selectionNumber: number,
  roundNumber: null,
  player: person(name),
  selectedByClub: cell(club),
  accessCategory: name === 'Dougie Cochrane' ? 'academy' : 'open',
});

const order = (
  year: number,
  fields: Omit<OrderClaim, 'kind' | 'draftYear' | 'draftType' | 'bidNotMatchedBy'>
): Claim => ({
  kind: 'draft_order_pick',
  draftYear: year,
  draftType: 'national',
  bidNotMatchedBy: null,
  ...fields,
});
const entitlement = (club: Club, roundNumber: number, rank: number) =>
  ({ kind: 'entitlement', club: cell(club), roundNumber, rank }) as const;
const hop = (club: Club, nativeEventId: string) => ({ toClub: cell(club), nativeEventId });

/**
 * The 2026 shapes the order settles: Hawthorn's first-round pick 15 (stated "not used") was used at
 * 17 on Elliott; GWS's second-round pick 28 went Hawthorn → Essendon → Brisbane and was used on Van
 * Dyk, though Brisbane's page says "not used"; Richmond's pick 40 was spent matching Port's bid; Port's
 * pick 70 has no row; Carlton's own fifth-round pick was removed.
 */
function pages(year: number) {
  return {
    trades: [
      trade(
        `${year}-zach-merrett`,
        year,
        'Hawthorn',
        'Essendon',
        [
          { number: 15, stated: 'not_used' },
          { number: 28, stated: 'traded_on' },
        ],
        'Zach Merrett'
      ),
      trade(
        `${year}-kai-coleman`,
        year,
        'Essendon',
        'Brisbane',
        [{ number: 28, stated: 'not_used' }],
        'Kai Coleman'
      ),
      trade(
        `${year}-picks-port-richmond`,
        year,
        'Richmond',
        'Port Adelaide',
        [{ number: 40, stated: 'not_used' }],
        'Other Player'
      ),
      trade(
        `${year}-picks-port-late`,
        year,
        'Richmond',
        'Port Adelaide',
        [{ number: 70, stated: 'not_used' }],
        'Other Player'
      ),
    ],
    selections: [
      selection(year, 1, 'Dougie Cochrane', 'Port Adelaide'),
      selection(year, 17, 'Archie Elliott', 'Essendon'),
      selection(year, 30, 'Archie Van Dyk', 'Brisbane'),
    ],
    order: [
      order(year, {
        roundNumber: 1,
        pickNumber: 17,
        club: cell('Essendon'),
        origin: entitlement('Hawthorn', 1, 4),
        hops: [hop('Essendon', `${year}-zach-merrett`)],
        outcome: { kind: 'selected', player: person('Archie Elliott') },
      }),
      order(year, {
        roundNumber: 2,
        pickNumber: 30,
        club: cell('Brisbane'),
        origin: entitlement('GWS', 2, 12),
        hops: [
          hop('Hawthorn', `${year - 1}-picks-gws-hawthorn`),
          hop('Essendon', `${year}-zach-merrett`),
          hop('Brisbane', `${year}-kai-coleman`),
        ],
        outcome: { kind: 'selected', player: person('Archie Van Dyk') },
      }),
      order(year, {
        roundNumber: 2,
        pickNumber: null,
        club: cell('Port Adelaide'),
        origin: entitlement('Richmond', 2, 17),
        hops: [hop('Port Adelaide', `${year}-picks-port-richmond`)],
        outcome: { kind: 'bid_spent', nominee: person('Dougie Cochrane'), asPick: 22 },
      }),
      order(year, {
        roundNumber: 5,
        pickNumber: null,
        club: cell('Carlton'),
        origin: entitlement('Carlton', 5, 8),
        hops: [],
        outcome: { kind: 'removed', note: 'not enough list spots' },
      }),
    ],
  };
}

function reconcile(
  year: number,
  options: {
    order?: boolean;
    trades?: Claim[][];
    orderRows?: Claim[];
    selections?: Claim[];
    custody?: Claim[];
  } = {}
) {
  const source = pages(year);
  const batches = [
    ...(options.trades ?? source.trades).map((claims, index) =>
      batch('bcdef023456'[index]!, claims)
    ),
    batch('1', [...source.selections, ...(options.selections ?? [])]),
    ...(options.custody === undefined ? [] : [batch('8', options.custody, 'official_afl')]),
    ...(options.order === false
      ? []
      : [batch('7', [...source.order, ...(options.orderRows ?? [])])]),
  ];
  return parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: year,
      sourceBatches: batches,
      // Official AFL custody rows name clubs as the trade pages do; only a custody run reviews them.
      identityResolutions:
        options.custody === undefined
          ? identityResolutions
          : [
              ...identityResolutions,
              ...(Object.keys(CLUBS) as Club[]).map((club) =>
                resolution('club', page(club), clubId(club), 'official_afl')
              ),
            ],
      reconciledAt: '2026-11-23T01:00:00.000Z',
    })
  ).content;
}
type Content = ReturnType<typeof reconcile>;

const transferOf = (content: Content, eventId: string, number: number) =>
  content.transfers.find((transfer) => {
    const transaction = content.transactions.find(
      (row) => row.transactionId === transfer.transactionId
    );
    return (
      transaction?.providerEventId === eventId &&
      transfer.asset.kind === 'pick_entitlement' &&
      transfer.asset.nominalPick === number
    );
  })!;
const pickIdOf = (content: Content, eventId: string, number: number) => {
  const { asset } = transferOf(content, eventId, number);
  return asset.kind === 'pick_entitlement' ? asset.pickId : null;
};
const outcomeOf = (content: Content, eventId: string, number: number) =>
  (content.pickOutcomes ?? []).find(
    ({ transferId }) => transferId === transferOf(content, eventId, number).transferId
  )!;

describe('Draftguru post-draft order reconciliation (owner approval 4, 2026 intake)', () => {
  const content = reconcile(2026);
  const orderPickOf = (pickNumber: number | null, round: number) =>
    content.draftOrderPicks!.find(
      (row) => row.pickNumber === pickNumber && row.roundNumber === round
    )!;

  it('records every order row and ties each hop to its transfer, two picks on one pair by number', () => {
    expect(content.draftOrderPicks).toHaveLength(4);
    expect(orderPickOf(17, 1).hopTransferIds).toEqual([
      transferOf(content, '2026-zach-merrett', 15).transferId,
    ]);
    expect(orderPickOf(30, 2).hopTransferIds).toEqual([
      null,
      transferOf(content, '2026-zach-merrett', 28).transferId,
      transferOf(content, '2026-kai-coleman', 28).transferId,
    ]);
    expect(orderPickOf(null, 5)).toMatchObject({ outcome: 'removed', hopTransferIds: [] });
  });

  it('settles a renumbered pick the trade page called not used as the selection its row names', () => {
    const elliott = content.draftSelections.find(({ selectionNumber }) => selectionNumber === 17)!;
    expect(outcomeOf(content, '2026-zach-merrett', 15)).toMatchObject({
      disposition: 'selected',
      outcomeStatus: 'stated',
      statedDisposition: 'not_used',
      selectionId: elliott.selectionId,
      playerId: playerId('Archie Elliott'),
      orderPickId: orderPickOf(17, 1).orderPickId,
    });
    expect(elliott.pickId).toBe(pickIdOf(content, '2026-zach-merrett', 15));
  });

  it('gives every hop of one row one pick id, and its last hop the selection', () => {
    expect(pickIdOf(content, '2026-zach-merrett', 28)).toBe(
      pickIdOf(content, '2026-kai-coleman', 28)
    );
    expect(outcomeOf(content, '2026-zach-merrett', 28)).toMatchObject({ disposition: 'traded_on' });
    expect(outcomeOf(content, '2026-kai-coleman', 28)).toMatchObject({
      disposition: 'selected',
      statedDisposition: 'not_used',
      playerId: playerId('Archie Van Dyk'),
    });
  });

  it('marks a spent pick, and a pick no row lists as not listed', () => {
    expect(outcomeOf(content, '2026-picks-port-richmond', 40)).toMatchObject({
      disposition: 'not_used',
      outcomeStatus: 'stated',
      nominationBasis: 'order_bid_spent',
      orderPickId: expect.any(String),
    });
    expect(outcomeOf(content, '2026-picks-port-late', 70)).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_not_listed',
    });
    expect(outcomeOf(content, '2026-picks-port-late', 70).orderPickId).toBeUndefined();
  });

  it('leaves the outcome unresolved when the row’s player has no selection by the receiving club', () => {
    const source = pages(2026);
    const withoutElliott = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2026,
      sourceBatches: [
        ...source.trades.map((claims, index) => batch('bcdef'[index]!, claims)),
        batch(
          '1',
          source.selections.filter(
            (claim) => claim.kind === 'draft_selection' && claim.selectionNumber !== 17
          )
        ),
        batch('7', source.order),
      ],
      identityResolutions,
      reconciledAt: '2026-11-23T01:00:00.000Z',
    }).content;
    expect(outcomeOf(withoutElliott as Content, '2026-zach-merrett', 15)).toMatchObject({
      disposition: 'selected',
      outcomeStatus: 'unresolved',
      selectionId: null,
    });
    expect(withoutElliott.issues).toContainEqual(
      expect.objectContaining({ code: 'pick_outcome_unresolved' })
    );
  });

  it('ties nothing when a pair’s hops and transfers neither pair nor agree, and leaves its picks unresolved', () => {
    // A third 2026 pick from Hawthorn to Essendon with no order row: three transfers, two hops.
    const source = pages(2026);
    const trades = [
      trade(
        '2026-zach-merrett',
        2026,
        'Hawthorn',
        'Essendon',
        [
          { number: 15, stated: 'not_used' },
          { number: 28, stated: 'traded_on' },
          { number: 50, stated: 'not_used' },
        ],
        'Zach Merrett'
      ),
      ...source.trades.slice(1),
    ];
    const untied = reconcile(2026, { trades });
    expect(untied.draftOrderPicks!.find((row) => row.pickNumber === 17)!.hopTransferIds).toEqual([
      null,
    ]);
    // No page states Elliott or Van Dyk for these picks, so no transfer agrees with either row; each
    // "not used" pick of the trade could be either row, which the order cannot settle.
    for (const number of [15, 50]) {
      expect(outcomeOf(untied, '2026-zach-merrett', number)).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_ambiguous',
      });
      expect(outcomeOf(untied, '2026-zach-merrett', number).orderPickId).toBeUndefined();
    }
  });

  it('refuses an outcome that cites an order row not tying its transfer', () => {
    const elsewhere = orderPickOf(null, 5).orderPickId;
    const pickOutcomes = content.pickOutcomes!.map((row) =>
      row.orderPickId === orderPickOf(17, 1).orderPickId ? { ...row, orderPickId: elsewhere } : row
    );
    expect(() =>
      createAflTradeExternalReconciliationCandidate({ ...content, pickOutcomes })
    ).toThrow(/order row that ties its transfer/);
  });

  it('settles a pick as not listed when a row’s untied hop into its club is in another trade', () => {
    // Brisbane → GWS → Port, used at 19 on Snell: the row's Brisbane → GWS hop names a trade the
    // candidate does not hold, so it cannot be the Brisbane → GWS pick of this trade.
    const trades = [
      ...pages(2026).trades,
      trade(
        '2026-picks-bris-gws',
        2026,
        'Brisbane',
        'GWS',
        [{ number: 20, stated: 'not_used' }],
        'Other Player'
      ),
    ];
    const orderRows = [
      order(2026, {
        roundNumber: 1,
        pickNumber: 19,
        club: cell('Port Adelaide'),
        origin: entitlement('Brisbane', 1, 1),
        hops: [
          hop('GWS', '2026-picks-bris-gws-elsewhere'),
          hop('Port Adelaide', '2026-picks-gws-port'),
        ],
        outcome: { kind: 'selected', player: person('Clancy Snell') },
      }),
    ];
    const settled = reconcile(2026, { trades, orderRows });
    expect(outcomeOf(settled, '2026-picks-bris-gws', 20)).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_not_listed',
    });
  });

  it('does not settle a pick as not listed when its club holds a late row with no origin', () => {
    // A late "Picked" row states no origin, so it may be the pick Essendon traded in at 75.
    const trades = [
      ...pages(2026).trades,
      trade(
        '2026-picks-ess-late',
        2026,
        'Richmond',
        'Essendon',
        [{ number: 75, stated: 'not_used' }],
        'Other Player'
      ),
    ];
    const orderRows = [
      order(2026, {
        roundNumber: 4,
        pickNumber: 58,
        club: cell('Essendon'),
        origin: null,
        hops: [],
        outcome: { kind: 'selected', player: person('Cooper Hodge') },
      }),
    ];
    const settled = reconcile(2026, { trades, orderRows });
    expect(outcomeOf(settled, '2026-picks-ess-late', 75).nominationBasis).not.toBe(
      'order_not_listed'
    );
    // Without the late row, the same pick is one no row could be.
    expect(reconcile(2026, { trades }).pickOutcomes).toContainEqual(
      expect.objectContaining({
        transferId: transferOf(settled, '2026-picks-ess-late', 75).transferId,
        nominationBasis: 'order_not_listed',
      })
    );
  });

  it('leaves a lone hop untied when the transfer states another original club', () => {
    // The trade page states the pick as Hawthorn's; the row says it was GWS's.
    const trades = [
      trade(
        '2026-zach-merrett',
        2026,
        'Hawthorn',
        'Essendon',
        [{ number: 15, stated: 'not_used' }],
        'Zach Merrett'
      ),
      ...pages(2026).trades.slice(1),
      [
        {
          kind: 'transaction',
          nativeEventId: '2026-picks-gws-future',
          seasonYear: 2026,
          occurredOn: null,
          transactionType: 'trade',
          title: null,
        },
        ...(['Carlton', 'Richmond'] as const).map((club): Claim => ({
          kind: 'transaction_party',
          nativeEventId: '2026-picks-gws-future',
          nativePartyId: CLUBS[club],
          club: page(club),
        })),
        {
          kind: 'directed_transfer',
          nativeEventId: '2026-picks-gws-future',
          nativeTransferId: 'future-pick:2026:national:3:hawthorn',
          fromClub: page('Carlton'),
          toClub: page('Richmond'),
          asset: {
            kind: 'future_pick',
            draftYear: 2026,
            draftType: 'national',
            roundNumber: 3,
            originalClub: page('Hawthorn'),
          },
        },
        {
          kind: 'directed_transfer',
          nativeEventId: '2026-picks-gws-future',
          nativeTransferId: 'player:Other Player',
          fromClub: page('Richmond'),
          toClub: page('Carlton'),
          asset: { kind: 'player', player: { nativeId: null, recordedName: 'Other Player' } },
        },
      ] satisfies Claim[],
    ];
    const orderRows = [
      order(2026, {
        roundNumber: 3,
        pickNumber: 45,
        club: cell('Richmond'),
        origin: entitlement('GWS', 3, 12),
        hops: [hop('Carlton', '2025-earlier'), hop('Richmond', '2026-picks-gws-future')],
        outcome: { kind: 'selected', player: person('Other Player') },
      }),
    ];
    const settled = reconcile(2026, { trades, orderRows });
    const row = settled.draftOrderPicks!.find(({ pickNumber }) => pickNumber === 45)!;
    expect(row.hopTransferIds).toEqual([null, null]);
  });

  it('keeps a chain that joined by its stated player joined when the row ties only part of it', () => {
    const eventual = (eventId: string, number: number): Claim => ({
      kind: 'pick_eventual_selection',
      nativeEventId: eventId,
      nativeTransferId: pickKey(2026, number),
      outcome: 'selected',
      player: { nativeId: person('Archie Van Dyk').nativeId, recordedName: 'Archie Van Dyk' },
    });
    // Every hop of GWS's pick 28 states Van Dyk; the row's first hop names a trade the candidate
    // does not hold, so only its later hops tie.
    const source = pages(2026);
    const trades = [
      trade(
        '2026-picks-gws-hawthorn',
        2026,
        'GWS',
        'Hawthorn',
        [{ number: 28, stated: 'traded_on' }],
        'Other Player'
      ),
      [...source.trades[0]!, eventual('2026-zach-merrett', 28)],
      [...source.trades[1]!, eventual('2026-kai-coleman', 28)],
      ...source.trades.slice(2),
    ];
    trades[0]!.push(eventual('2026-picks-gws-hawthorn', 28));
    const baseline = reconcile(2026, { trades, order: false });
    const settled = reconcile(2026, { trades });
    const ids = (content: Content) =>
      new Set([
        pickIdOf(content, '2026-picks-gws-hawthorn', 28),
        pickIdOf(content, '2026-zach-merrett', 28),
        pickIdOf(content, '2026-kai-coleman', 28),
      ]);
    expect(ids(baseline).size).toBe(1);
    expect(ids(settled).size).toBe(1);
  });

  it('counts a custody pick as contradicting a row only where both state a round or club and differ', () => {
    const origin = { originRound: 1, originalClubId: clubId('Hawthorn') };
    expect(
      aflTradeOrderEntitlementContradicts(origin, {
        roundNumber: 2,
        originalClubId: clubId('Hawthorn'),
      })
    ).toBe(true);
    expect(
      aflTradeOrderEntitlementContradicts(origin, { roundNumber: 1, originalClubId: clubId('GWS') })
    ).toBe(true);
    // A custody pick with no round contradicts nothing by its round.
    expect(
      aflTradeOrderEntitlementContradicts(origin, {
        roundNumber: null,
        originalClubId: clubId('Hawthorn'),
      })
    ).toBe(false);
    expect(
      aflTradeOrderEntitlementContradicts(
        { originRound: null, originalClubId: null },
        { roundNumber: 2, originalClubId: clubId('GWS') }
      )
    ).toBe(false);
  });

  it('settles a spent row whose hop reaches a custody pick that states no round', () => {
    // The pre-draft order places Richmond's own pick at 40 with no round: the same pick the spent
    // row's origin states, so the row's hop keeps its tie, cites the row, and records no conflict.
    const custody: Claim = {
      kind: 'pick_custody',
      observedAt: '2026-10-14T00:00:00.000Z',
      draftYear: 2026,
      draftType: 'national',
      roundNumber: null,
      recordedPickNumber: 40,
      originalClub: page('Richmond'),
      currentClub: page('Port Adelaide'),
    };
    const settled = reconcile(2026, { custody: [custody] });
    const transfer = transferOf(settled, '2026-picks-port-richmond', 40);
    const row = settled.draftOrderPicks!.find(({ outcome }) => outcome === 'bid_spent')!;
    expect(row.hopTransferIds).toEqual([transfer.transferId]);
    // The hop joined the custody pick, and the row keeps it.
    expect(settled.pickCustody.map(({ pickId }) => pickId)).toContain(
      pickIdOf(settled, '2026-picks-port-richmond', 40)
    );
    expect(transfer.evidenceIds).toEqual(expect.arrayContaining(row.evidenceIds));
    expect(settled.issues.filter(({ code }) => code === 'pick_identity_conflict')).toEqual([]);
    expect(outcomeOf(settled, '2026-picks-port-richmond', 40)).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_bid_spent',
    });
  });

  it('gives a 2025-shaped candidate without order rows the id the code before this change gave it', () => {
    // Pinned from origin/main before the order reconciliation (545852ef): the same fixture, prepared
    // by the code that had no order rule, has this id. The grading VM's baseline proof is the full check.
    const without = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [
        ...pages(2025).trades.map((claims, index) => batch('bcdef023456'[index]!, claims)),
        batch('1', pages(2025).selections),
      ],
      identityResolutions,
      reconciledAt: '2026-11-23T01:00:00.000Z',
    });
    expect(without.candidateId).toBe(
      'external-reconciliation:f708c8dcd4198f0c67a101478532cb460b2e06bb44dbd27bb9943667e43327fd'
    );
    expect(without.content).not.toHaveProperty('draftOrderPicks');
  });

  it('only records order rows outside the 2026 national draft, changing nothing else', () => {
    const { draftOrderPicks, sourceBatchIds: _ids, ...rest } = reconcile(2025);
    const { sourceBatchIds: _baseIds, ...baseline } = reconcile(2025, { order: false });
    expect(
      draftOrderPicks!.every(({ hopTransferIds }) => hopTransferIds.every((id) => id === null))
    ).toBe(true);
    expect(rest).toEqual(baseline);
  });
});
