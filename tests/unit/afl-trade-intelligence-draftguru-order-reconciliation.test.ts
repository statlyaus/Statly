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
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
type OrderClaim = Extract<Claim, { kind: 'draft_order_pick' }>;
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-11-23T00:00:00.000Z';

function batch(suffix: string, claims: readonly Claim[]) {
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
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
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
];

const resolution = (
  entityKind: 'club' | 'player',
  sourceIdentity: { nativeId: string | null; recordedName: string },
  canonicalId: string
) =>
  createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: 'draftguru',
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

function reconcile(year: number, options: { order?: boolean; trades?: Claim[][] } = {}) {
  const source = pages(year);
  const batches = [
    ...(options.trades ?? source.trades).map((claims, index) => batch('bcdef'[index]!, claims)),
    batch('1', source.selections),
    ...(options.order === false ? [] : [batch('7', source.order)]),
  ];
  return parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: year,
      sourceBatches: batches,
      identityResolutions,
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

  it('ties nothing when a pair’s hops and transfers do not pair, and the outcomes stay the trade page’s', () => {
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
    const baseline = reconcile(2026, { trades, order: false });
    expect(outcomeOf(untied, '2026-zach-merrett', 15)).toEqual(
      outcomeOf(baseline, '2026-zach-merrett', 15)
    );
    expect(untied.draftOrderPicks!.find((row) => row.pickNumber === 17)!.hopTransferIds).toEqual([
      null,
    ]);
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

  it('leaves a 2025-shaped candidate byte-identical: no order rows, no new key; order rows of another draft only recorded', () => {
    const without = reconcile(2025, { order: false });
    expect(without).not.toHaveProperty('draftOrderPicks');
    const withRows = reconcile(2025);
    const { draftOrderPicks, sourceBatchIds: _ids, ...rest } = withRows;
    const { sourceBatchIds: _baseIds, ...baseline } = without;
    expect(
      draftOrderPicks!.every(({ hopTransferIds }) => hopTransferIds.every((id) => id === null))
    ).toBe(true);
    expect(rest).toEqual(baseline);
  });
});
