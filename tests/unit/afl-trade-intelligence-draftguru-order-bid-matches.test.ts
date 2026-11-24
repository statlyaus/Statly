import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_BID_LADDER_SCHEMA_VERSION,
  aflTradeBidLadderSchema,
  reconcileDraftguruOrderBidMatches,
  type AflTradeBidLadder,
} from '@/server/aflTradeIntelligence/source/draftguruOrderBidMatchReconciliation';
import { reconcileDraftguruOrderPicks } from '@/server/aflTradeIntelligence/source/draftguruOrderReconciliation';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
type OrderClaim = Extract<Claim, { kind: 'draft_order_pick' }>;
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-11-23T00:00:00.000Z';

/** Synthetic order rows: the shapes Draftguru's 2026 post-draft order states, no provider bytes. */
const CLUBS = {
  'Port Adelaide': ['port-adelaide', 'Port'],
  Essendon: ['essendon', 'Ess'],
  Carlton: ['carlton', 'Carl'],
  GWS: ['greater-western-sydney', 'GWS'],
  Melbourne: ['melbourne', 'Melb'],
  Richmond: ['richmond', 'Rich'],
  'Western Bulldogs': ['western-bulldogs', 'WB'],
  'St Kilda': ['st-kilda', 'StK'],
} as const;
type Club = keyof typeof CLUBS;
const club = (name: Club) => ({ nativeId: CLUBS[name][0], recordedName: name });
const person = (name: string) => ({
  nativeId: name.toLowerCase().replace(/ /g, '-'),
  recordedName: name,
});
const clubId = (name: Club) => `club-${CLUBS[name][0]}`;
const playerId = (name: string) => `player-${person(name).nativeId}`;
const lookup = (
  kind: 'club' | 'player',
  identity: { nativeId: string | null; recordedName: string }
): string | null => (kind === 'club' ? `club-${identity.nativeId}` : `player-${identity.nativeId}`);

const row = (fields: Omit<OrderClaim, 'kind' | 'draftYear' | 'draftType' | 'bidNotMatchedBy'>) =>
  ({
    kind: 'draft_order_pick',
    draftYear: 2026,
    draftType: 'national',
    bidNotMatchedBy: null,
    ...fields,
  }) as OrderClaim;
const entitlement = (name: Club, roundNumber: number, rank: number) =>
  ({ kind: 'entitlement', club: club(name), roundNumber, rank }) as const;
const hop = (name: Club, nativeEventId: string) => ({ toClub: club(name), nativeEventId });

/** The nominee row: "<club> | <bidder> bid for <nominee> matched (<basis>) using picks …". */
const nominee = (
  pickNumber: number,
  holder: Club,
  bidder: Club,
  name: string,
  usingPicks: number[]
) =>
  row({
    roundNumber: pickNumber <= 18 ? 1 : 2,
    pickNumber,
    club: club(holder),
    origin: {
      kind: 'bid_matched',
      bidClub: club(bidder),
      basis: 'next_generation_academy',
      nominee: person(name),
      usingPicks,
    },
    hops: [],
    outcome: { kind: 'selected', player: person(name) },
  });
/** A spent row: "<origin> | <hops> | Used to match bid for <nominee> as pick N". */
const spent = (
  holder: Club,
  origin: OrderClaim['origin'],
  hops: OrderClaim['hops'],
  name: string,
  asPick: number
) =>
  row({
    roundNumber: asPick <= 18 ? 1 : asPick <= 36 ? 2 : 3,
    pickNumber: null,
    club: club(holder),
    origin,
    hops,
    outcome: { kind: 'bid_spent', nominee: person(name), asPick },
  });

const ROWS: OrderClaim[] = [
  nominee(1, 'Port Adelaide', 'Essendon', 'Dougie Cochrane', [6, 22]),
  spent('Port Adelaide', entitlement('Port Adelaide', 1, 6), [], 'Dougie Cochrane', 6),
  spent(
    'Port Adelaide',
    entitlement('Richmond', 2, 4),
    [hop('Port Adelaide', '2026-port-richmond')],
    'Dougie Cochrane',
    22
  ),
  nominee(3, 'Carlton', 'St Kilda', 'Cody Walker', [15, 18]),
  spent('Carlton', entitlement('Carlton', 1, 15), [], 'Cody Walker', 15),
  spent('Carlton', entitlement('Carlton', 1, 18), [], 'Cody Walker', 18),
  nominee(6, 'GWS', 'Essendon', 'Ethan Matthews', [8, 13]),
  spent('GWS', entitlement('GWS', 1, 8), [], 'Ethan Matthews', 8),
  // "Melb R1 pick (9th) | To Port in Maginness + O'Keeffe trade | To GWS in live pick swap"
  spent(
    'GWS',
    entitlement('Melbourne', 1, 9),
    [hop('Port Adelaide', '2026-maginness-okeeffe'), hop('GWS', '2026-live-pick-swap')],
    'Ethan Matthews',
    13
  ),
  // "13 | GWS | Created for GWS from leftover points after matching bid for Ethan Matthews | Picked Jake Eime"
  row({
    roundNumber: 1,
    pickNumber: 13,
    club: club('GWS'),
    origin: { kind: 'leftover_points', club: club('GWS'), nominee: person('Ethan Matthews') },
    hops: [],
    outcome: { kind: 'selected', player: person('Jake Eime') },
  }),
  nominee(33, 'Western Bulldogs', 'Richmond', 'Khaled El Souki', [43, 53]),
  // Pick 43 is a free-agency compensation pick: no original club.
  spent(
    'Western Bulldogs',
    { kind: 'compensation', label: 'Band 3 Free Agency Comp for A Player' },
    [],
    'Khaled El Souki',
    43
  ),
  spent('Western Bulldogs', entitlement('Western Bulldogs', 3, 17), [], 'Khaled El Souki', 53),
];

function evidence(claims: readonly OrderClaim[]) {
  const capture = {
    captureId: `source-capture:${digest('7')}`,
    artifactId: `artifact:${digest('7')}`,
    contentSha256: digest('7'),
    mediaType: 'text/html',
    sourceUrl: 'https://example.test/draftguru/post-draft',
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: 'draftguru/test',
    fieldManifestSha256: digest('9'),
  };
  return claims.map((claim, index) => ({
    evidenceId: `external-evidence:${index.toString(16).padStart(64, '0')}`,
    content: createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'draftguru',
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `2026:national:order:${index + 1}` },
      claim,
      publicationEligible: false,
    }).content,
  }));
}

const LADDER: AflTradeBidLadder = {
  schemaVersion: AFL_TRADE_BID_LADDER_SCHEMA_VERSION,
  season: 2026,
  basis: 'final_ranking_including_finals',
  source: 'Owner, 2026-11-24 (four of the eighteen clubs)',
  positions: { 'port-adelaide': 15, carlton: 8, 'greater-western-sydney': 12 },
};

function reconcile(claims: readonly OrderClaim[] = ROWS, ladder?: AflTradeBidLadder) {
  const order = reconcileDraftguruOrderPicks({
    evidence: evidence(claims) as never,
    transfers: [],
    lookup,
    eventClubs: new Map(),
  });
  const matches = reconcileDraftguruOrderBidMatches({
    order,
    lookup,
    ...(ladder === undefined ? {} : { ladder }),
  });
  return { order, matches };
}

const byNominee = (matches: ReturnType<typeof reconcile>['matches'], name: string) =>
  matches.find(({ playerId: id }) => id === playerId(name))!;

describe('Draftguru order matched bids (owner, 2026-11-24)', () => {
  const { order, matches } = reconcile(ROWS, LADDER);
  const rowOf = (holder: Club, asPick: number) =>
    order.records.find((record) => record.clubId === clubId(holder) && record.asPick === asPick)!;

  it('records one bid per nominee row, with clubs, basis and slot as the row states them', () => {
    expect(matches).toHaveLength(4);
    expect(byNominee(matches, 'Dougie Cochrane')).toMatchObject({
      draftYear: 2026,
      draftType: 'national',
      roundNumber: 1,
      selectionNumber: 1,
      clubId: clubId('Port Adelaide'),
      bidClubId: clubId('Essendon'),
      basis: 'next_generation_academy',
      ladderPosition: 15,
    });
    expect(
      matches.map(({ selectionNumber, spentPicks }) => [
        selectionNumber,
        spentPicks.map(({ asPick }) => asPick),
      ])
    ).toEqual(
      expect.arrayContaining([
        [1, [6, 22]],
        [3, [15, 18]],
        [6, [8, 13]],
        [33, [43, 53]],
      ])
    );
  });

  it('ties each spent pick to its own order row, with the route it states', () => {
    const matthews = byNominee(matches, 'Ethan Matthews');
    expect(matthews.spentPicks).toEqual([
      {
        asPick: 8,
        orderPickId: rowOf('GWS', 8).orderPickId,
        routeClubIds: [clubId('GWS')],
        originKind: 'entitlement',
      },
      {
        asPick: 13,
        orderPickId: rowOf('GWS', 13).orderPickId,
        routeClubIds: [clubId('Melbourne'), clubId('Port Adelaide'), clubId('GWS')],
        originKind: 'entitlement',
      },
    ]);
    // Jake Eime's pick 13 is the leftover the match created.
    expect(matthews.leftoverPicks).toEqual([
      {
        orderPickId: order.records.find(
          ({ pickNumber, clubId: id }) => pickNumber === 13 && id === clubId('GWS')
        )!.orderPickId,
        pickNumber: 13,
        playerId: playerId('Jake Eime'),
      },
    ]);
    // The Bulldogs' pick 43 states no original club: a compensation pick.
    expect(byNominee(matches, 'Khaled El Souki').spentPicks[0]).toMatchObject({
      asPick: 43,
      routeClubIds: [null],
      originKind: 'compensation',
    });
  });

  it('cites the nominee, spent and leftover rows, and stores no points', () => {
    const matthews = byNominee(matches, 'Ethan Matthews');
    expect(matthews.evidenceIds).toHaveLength(4);
    expect(matthews.evidenceIds).toEqual([...matthews.evidenceIds].sort());
    expect(JSON.stringify(matches)).not.toMatch(/points/i);
  });

  it('records the ladder position only for a club and season the owner’s ladder names', () => {
    expect(byNominee(matches, 'Khaled El Souki').ladderPosition).toBeNull();
    expect(reconcile(ROWS).matches.every(({ ladderPosition }) => ladderPosition === null)).toBe(
      true
    );
    const other = reconcile(ROWS, { ...LADDER, season: 2027 }).matches;
    expect(other.every(({ ladderPosition }) => ladderPosition === null)).toBe(true);
  });

  it('ties no spent pick when the club’s spent rows are not exactly the listed numbers', () => {
    // Port's pick 22 row is missing: the bid lists 6 and 22, so neither is tied.
    const without22 = ROWS.filter(
      (claim) => !(claim.outcome.kind === 'bid_spent' && claim.outcome.asPick === 22)
    );
    const cochrane = byNominee(reconcile(without22).matches, 'Dougie Cochrane');
    expect(cochrane.spentPicks).toEqual([
      { asPick: 6, orderPickId: null, routeClubIds: [], originKind: null },
      { asPick: 22, orderPickId: null, routeClubIds: [], originKind: null },
    ]);
    // Another club's spend on the same nominee is not this club's.
    const elsewhere = [
      ...ROWS,
      spent('Richmond', entitlement('Richmond', 1, 2), [], 'Dougie Cochrane', 6),
    ];
    expect(
      byNominee(reconcile(elsewhere).matches, 'Dougie Cochrane').spentPicks.every(
        ({ orderPickId }) => orderPickId !== null
      )
    ).toBe(true);
  });

  it('records nothing for an order with no bid rows, or of a draft the order does not settle', () => {
    expect(reconcile(ROWS.filter(({ origin }) => origin?.kind !== 'bid_matched')).matches).toEqual(
      []
    );
    expect(reconcile(ROWS.map((claim) => ({ ...claim, draftYear: 2025 }))).matches).toEqual([]);
  });
});

describe('the owner’s bid ladder file (afl-trade-bid-ladder/v1)', () => {
  it('accepts positions by Draftguru club id, and refuses a shared position or another basis', () => {
    expect(aflTradeBidLadderSchema.parse(LADDER)).toEqual(LADDER);
    expect(() =>
      aflTradeBidLadderSchema.parse({ ...LADDER, positions: { carlton: 3, 'st-kilda': 3 } })
    ).toThrow();
    expect(() => aflTradeBidLadderSchema.parse({ ...LADDER, basis: 'home_and_away' })).toThrow();
    expect(() => aflTradeBidLadderSchema.parse({ ...LADDER, positions: { Carlton: 3 } })).toThrow();
    expect(() => aflTradeBidLadderSchema.parse({ ...LADDER, positions: {} })).toThrow();
  });
});
