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

/**
 * Synthetic cases shaped on what the 2026 post-draft order did on the genuine data (owner approval
 * 4 of the 2026 intake): every club, player, trade and number here is a stand-in.
 */
type Claim = AflTradeExternalEvidenceContent['claim'];
type OrderClaim = Extract<Claim, { kind: 'draft_order_pick' }>;
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-11-23T00:00:00.000Z';

const CLUBS = {
  Adelaide: 'adelaide',
  Brisbane: 'brisbane',
  Carlton: 'carlton',
  Essendon: 'essendon',
  'Gold Coast': 'gold-coast',
  GWS: 'greater-western-sydney',
  Hawthorn: 'hawthorn',
  Melbourne: 'melbourne',
  'North Melbourne': 'north-melbourne',
  'Port Adelaide': 'port-adelaide',
  Sydney: 'sydney',
  'West Coast': 'west-coast',
  'Western Bulldogs': 'western-bulldogs',
} as const;
type Club = keyof typeof CLUBS;
const PLAYERS = [
  'Wil Malady',
  'Kodah Edwards',
  'Archie Spencer',
  'Ben Forster',
  'Clancy Snell',
  'Toby Krasna',
  'Jackson Watkins',
  'Cody Walker',
  'Late Pick',
  'Trade Player',
] as const;
type Player = (typeof PLAYERS)[number];

const page = (club: Club) => ({ nativeId: null, recordedName: club });
const cell = (club: Club) => ({ nativeId: CLUBS[club], recordedName: club });
const person = (name: Player) => ({
  nativeId: `${name.toLowerCase().replace(/ /g, '_')}/1`,
  recordedName: name,
});
const clubId = (club: Club) => `club-${CLUBS[club]}`;
const playerId = (name: Player) => `player-${name.toLowerCase().replace(/ /g, '-')}`;

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
    resolution('club', page(club), clubId(club), 'official_afl'),
  ]),
  ...PLAYERS.flatMap((name) => [
    resolution('player', person(name), playerId(name)),
    resolution('player', { nativeId: null, recordedName: name }, playerId(name)),
  ]),
];

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
    sourceUrl: `https://example.test/source/${suffix}`,
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: 'synthetic/v1',
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
        sourceRow: { ordinal: index + 1, sourceKey: `${suffix}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

/** One traded pick: a 2026 `Pick <n>`, or a future pick `2026R<round> (<club>)` traded in 2025. */
type TradedPick = ({ number: number } | { future: { round: number; original: Club } }) & {
  /** The receiving side's stated outcome. */
  stated: 'not_used' | 'traded_on' | Player;
  /** The giving side's eventual selection, when the page names one. */
  eventual?: Player;
};
const pickKey = (pick: TradedPick) =>
  'number' in pick
    ? `pick:2026:national:${pick.number}`
    : `future-pick:2026:national:${pick.future.round}:${CLUBS[pick.future.original]}`;

/** One traded pick's claims: its transfer, the receiving side's outcome, and any eventual player. */
function pickClaims(eventId: string, from: Club, to: Club, pick: TradedPick): Claim[] {
  return [
    {
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: pickKey(pick),
      fromClub: page(from),
      toClub: page(to),
      asset:
        'number' in pick
          ? {
              kind: 'current_pick',
              draftYear: 2026,
              draftType: 'national',
              recordedPickNumber: pick.number,
            }
          : {
              kind: 'future_pick',
              draftYear: 2026,
              draftType: 'national',
              roundNumber: pick.future.round,
              originalClub: page(pick.future.original),
            },
    },
    {
      kind: 'pick_disposition',
      nativeEventId: eventId,
      nativeTransferId: pickKey(pick),
      receivingClub: page(to),
      ...(pick.stated === 'not_used' || pick.stated === 'traded_on'
        ? { disposition: pick.stated }
        : {
            disposition: 'selected' as const,
            player: { nativeId: null, recordedName: pick.stated },
          }),
    },
    ...(pick.eventual === undefined
      ? []
      : [
          {
            kind: 'pick_eventual_selection' as const,
            nativeEventId: eventId,
            nativeTransferId: pickKey(pick),
            outcome: 'selected' as const,
            player: person(pick.eventual),
          },
        ]),
  ];
}

/**
 * One Draftguru trade page moving `picks` from `from` to `to`, `back` the other way, and a player
 * back when no pick goes back.
 */
function trade(
  eventId: string,
  from: Club,
  to: Club,
  picks: readonly TradedPick[],
  back: readonly TradedPick[] = []
): Claim[] {
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: Number(eventId.slice(0, 4)),
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
    ...picks.flatMap((pick) => pickClaims(eventId, from, to, pick)),
    ...back.flatMap((pick) => pickClaims(eventId, to, from, pick)),
    ...(back.length > 0
      ? []
      : [
          {
            kind: 'directed_transfer' as const,
            nativeEventId: eventId,
            nativeTransferId: `player:${eventId}`,
            fromClub: page(to),
            toClub: page(from),
            asset: {
              kind: 'player' as const,
              player: { nativeId: null, recordedName: 'Trade Player' },
            },
          },
        ]),
  ];
}

const selection = (number: number, name: Player, club: Club): Claim => ({
  kind: 'draft_selection',
  draftYear: 2026,
  draftType: 'national',
  selectionNumber: number,
  roundNumber: null,
  player: person(name),
  selectedByClub: cell(club),
  accessCategory: name === 'Cody Walker' ? 'father_son' : 'open',
});

const custody = (
  number: number,
  round: number,
  original: Club,
  holder: Club,
  observedAt = '2026-10-14T00:00:00.000Z'
): Claim => ({
  kind: 'pick_custody',
  observedAt,
  draftYear: 2026,
  draftType: 'national',
  roundNumber: round,
  recordedPickNumber: number,
  originalClub: page(original),
  currentClub: page(holder),
});

const entitlement = (club: Club, roundNumber: number, rank: number) =>
  ({ kind: 'entitlement', club: cell(club), roundNumber, rank }) as const;
const hop = (club: Club, nativeEventId: string) => ({ toClub: cell(club), nativeEventId });
const row = (
  fields: Omit<OrderClaim, 'kind' | 'draftYear' | 'draftType' | 'bidNotMatchedBy' | 'club'> & {
    club: Club;
  }
): Claim => ({
  kind: 'draft_order_pick',
  draftYear: 2026,
  draftType: 'national',
  bidNotMatchedBy: null,
  ...fields,
  club: cell(fields.club),
});
const picked = (name: Player) => ({ kind: 'selected' as const, player: person(name) });

function reconcile(input: {
  trades: Claim[][];
  selections: Claim[];
  order: Claim[];
  custody?: Claim[];
}) {
  return parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2026,
      sourceBatches: [
        ...input.trades.map((claims, index) => batch('bcdef0123456'[index]!, claims)),
        batch('7', input.selections),
        batch('8', input.order),
        ...(input.custody === undefined ? [] : [batch('a', input.custody, 'official_afl')]),
      ],
      identityResolutions,
      reconciledAt: '2026-11-23T01:00:00.000Z',
    })
  ).content;
}
type Content = ReturnType<typeof reconcile>;

const pickOf = (content: Content, eventId: string, pick: TradedPick) => {
  const transaction = content.transactions.find(
    ({ providerEventId }) => providerEventId === eventId
  )!;
  const transfer = content.transfers.find(
    (candidate) =>
      candidate.transactionId === transaction.transactionId &&
      candidate.asset.kind === 'pick_entitlement' &&
      ('number' in pick
        ? candidate.asset.nominalPick === pick.number
        : candidate.asset.nominalRound === pick.future.round &&
          candidate.asset.nominalPick === null)
  )!;
  const outcome = (content.pickOutcomes ?? []).find(
    ({ transferId }) => transferId === transfer.transferId
  );
  return {
    transfer,
    pickId: transfer.asset.kind === 'pick_entitlement' ? transfer.asset.pickId : null,
    outcome,
  };
};

/** The usable custody pick of a club's entitlement in a round. */
const custodyPickId = (content: Content, original: Club, round: number) =>
  content.pickCustody.find(
    ({ originalClubId, roundNumber }) =>
      originalClubId === clubId(original) && roundNumber === round
  )!.pickId;

describe('Draftguru post-draft order on the shapes the genuine 2026 data showed', () => {
  it('keeps a selected pick one id when its last hop joined custody of another entitlement (Malady)', () => {
    const coleman = { number: 21, stated: 'traded_on', eventual: 'Wil Malady' } as const;
    const swap = { number: 20, stated: 'Wil Malady', eventual: 'Wil Malady' } as const;
    const content = reconcile({
      trades: [
        trade('2026-keidean-coleman', 'Essendon', 'Brisbane', [coleman]),
        trade('2026-picks-brisbane-port_adelaide-31', 'Brisbane', 'Port Adelaide', [swap]),
      ],
      selections: [selection(20, 'Wil Malady', 'Port Adelaide')],
      order: [
        row({
          roundNumber: 2,
          pickNumber: 20,
          club: 'Port Adelaide',
          origin: entitlement('Essendon', 2, 18),
          hops: [
            hop('Brisbane', '2026-keidean-coleman'),
            hop('Port Adelaide', '2026-picks-brisbane-port_adelaide-31'),
          ],
          outcome: picked('Wil Malady'),
        }),
      ],
      // The order observed before draft-night renumbering has Brisbane's first-rounder at 20.
      custody: [custody(20, 1, 'Brisbane', 'Port Adelaide')],
    });
    const first = pickOf(content, '2026-keidean-coleman', coleman);
    const last = pickOf(content, '2026-picks-brisbane-port_adelaide-31', swap);
    expect(content.draftOrderPicks![0]!.hopTransferIds).toEqual([
      first.transfer.transferId,
      last.transfer.transferId,
    ]);
    expect(first.pickId).toBe(last.pickId);
    // The custody pick slot 20 joined is Brisbane's first-rounder, not the row's Essendon R2.
    expect(first.pickId).not.toBe(custodyPickId(content, 'Brisbane', 1));
    expect(last.outcome).toMatchObject({
      disposition: 'selected',
      outcomeStatus: 'stated',
      playerId: playerId('Wil Malady'),
    });
  });

  it('leaves Brisbane’s first-rounder to Snell’s chain when Malady’s pick joined its custody slot by number', () => {
    const coleman = { number: 21, stated: 'traded_on', eventual: 'Wil Malady' } as const;
    const malady = { number: 20, stated: 'Wil Malady', eventual: 'Wil Malady' } as const;
    const toGws = { number: 20, stated: 'traded_on', eventual: 'Clancy Snell' } as const;
    const toPort = { number: 19, stated: 'Clancy Snell', eventual: 'Clancy Snell' } as const;
    const content = reconcile({
      trades: [
        trade('2026-keidean-coleman', 'Essendon', 'Brisbane', [coleman]),
        trade('2026-picks-brisbane-port_adelaide-31', 'Brisbane', 'Port Adelaide', [malady]),
        trade('2026-picks-brisbane-greater_western_sydney-16', 'Brisbane', 'GWS', [toGws]),
        trade('2026-picks-greater_western_sydney-port_adelaide-26', 'GWS', 'Port Adelaide', [
          toPort,
        ]),
      ],
      selections: [
        selection(19, 'Clancy Snell', 'Port Adelaide'),
        selection(20, 'Wil Malady', 'Port Adelaide'),
      ],
      order: [
        row({
          roundNumber: 1,
          pickNumber: 19,
          club: 'Port Adelaide',
          origin: entitlement('Brisbane', 1, 1),
          hops: [
            hop('GWS', '2026-picks-brisbane-greater_western_sydney-16'),
            hop('Port Adelaide', '2026-picks-greater_western_sydney-port_adelaide-26'),
          ],
          outcome: picked('Clancy Snell'),
        }),
        row({
          roundNumber: 2,
          pickNumber: 20,
          club: 'Port Adelaide',
          origin: entitlement('Essendon', 2, 18),
          hops: [
            hop('Brisbane', '2026-keidean-coleman'),
            hop('Port Adelaide', '2026-picks-brisbane-port_adelaide-31'),
          ],
          outcome: picked('Wil Malady'),
        }),
      ],
      // Slot 20 is Brisbane's first-rounder: held by GWS before the draft and by Port after night
      // one, when Port's draft-night swap for Essendon's second-rounder also read "Pick 20".
      custody: [
        custody(20, 1, 'Brisbane', 'GWS'),
        custody(20, 1, 'Brisbane', 'Port Adelaide', '2026-11-19T12:00:00.000Z'),
      ],
    });
    const brisbaneFirst = custodyPickId(content, 'Brisbane', 1);
    const maladyIds = new Set([
      pickOf(content, '2026-keidean-coleman', coleman).pickId,
      pickOf(content, '2026-picks-brisbane-port_adelaide-31', malady).pickId,
    ]);
    expect(maladyIds.size).toBe(1);
    expect(maladyIds.has(brisbaneFirst)).toBe(false);
    const snell = pickOf(content, '2026-picks-greater_western_sydney-port_adelaide-26', toPort);
    expect(pickOf(content, '2026-picks-brisbane-greater_western_sydney-16', toGws).pickId).toBe(
      snell.pickId
    );
    expect(snell.pickId).toBe(brisbaneFirst);
    expect(snell.outcome).toMatchObject({
      disposition: 'selected',
      outcomeStatus: 'stated',
      playerId: playerId('Clancy Snell'),
    });
    expect(pickOf(content, '2026-picks-brisbane-port_adelaide-31', malady).outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Wil Malady'),
    });
  });

  it('pairs two current picks on one pair by number in order (Port to Melbourne, Maginness)', () => {
    const event = "2026-finn-maginness-hudson-o'keeffe";
    const harris = { number: 4, stated: 'not_used' } as const;
    const forster = { number: 46, stated: 'not_used' } as const;
    const content = reconcile({
      trades: [trade(event, 'Port Adelaide', 'Melbourne', [harris, forster])],
      selections: [
        selection(7, 'Kodah Edwards', 'Melbourne'),
        selection(49, 'Ben Forster', 'Melbourne'),
      ],
      order: [
        row({
          roundNumber: 1,
          pickNumber: 7,
          club: 'Melbourne',
          origin: entitlement('Port Adelaide', 1, 15),
          hops: [hop('Melbourne', event)],
          outcome: picked('Kodah Edwards'),
        }),
        row({
          roundNumber: 3,
          pickNumber: 49,
          club: 'Melbourne',
          origin: entitlement('Port Adelaide', 3, 15),
          hops: [hop('Melbourne', event)],
          outcome: picked('Ben Forster'),
        }),
      ],
    });
    const byNumber = (number: number) =>
      content.draftOrderPicks!.find(({ pickNumber }) => pickNumber === number)!.hopTransferIds;
    expect(byNumber(7)).toEqual([pickOf(content, event, harris).transfer.transferId]);
    expect(byNumber(49)).toEqual([pickOf(content, event, forster).transfer.transferId]);
    expect(pickOf(content, event, harris).outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Kodah Edwards'),
    });
    expect(pickOf(content, event, forster).outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Ben Forster'),
    });
  });

  it('ties two picks on one pair by final number and keeps each chain one id (Edwards)', () => {
    const fromGoldCoast = {
      future: { round: 2, original: 'Gold Coast' },
      stated: 'traded_on',
      eventual: 'Kodah Edwards',
    } as const;
    const edwards = { number: 24, stated: 'Kodah Edwards', eventual: 'Kodah Edwards' } as const;
    const spencer = { number: 32, stated: 'Archie Spencer', eventual: 'Archie Spencer' } as const;
    const content = reconcile({
      trades: [
        trade('2025-picks-gold_coast-port_adelaide-34', 'Gold Coast', 'Port Adelaide', [
          fromGoldCoast,
        ]),
        trade('2026-picks-brisbane-port_adelaide-31', 'Port Adelaide', 'Brisbane', [
          edwards,
          spencer,
        ]),
      ],
      selections: [
        selection(27, 'Kodah Edwards', 'Brisbane'),
        selection(36, 'Archie Spencer', 'Brisbane'),
      ],
      order: [
        row({
          roundNumber: 2,
          pickNumber: 27,
          club: 'Brisbane',
          origin: entitlement('Gold Coast', 2, 13),
          hops: [
            hop('Port Adelaide', '2025-picks-gold_coast-port_adelaide-34'),
            hop('Brisbane', '2026-picks-brisbane-port_adelaide-31'),
          ],
          outcome: picked('Kodah Edwards'),
        }),
        row({
          roundNumber: 2,
          pickNumber: 36,
          club: 'Brisbane',
          origin: entitlement('Adelaide', 2, 6),
          hops: [
            hop('Port Adelaide', '2026-luke-pedlar'),
            hop('Brisbane', '2026-picks-brisbane-port_adelaide-31'),
          ],
          outcome: picked('Archie Spencer'),
        }),
      ],
      // Pick 32 joins the earlier order's slot 32, which was Port's own second-rounder then.
      custody: [custody(32, 2, 'Port Adelaide', 'Brisbane')],
    });
    const first = pickOf(content, '2025-picks-gold_coast-port_adelaide-34', fromGoldCoast);
    const last = pickOf(content, '2026-picks-brisbane-port_adelaide-31', edwards);
    expect(first.pickId).toBe(last.pickId);
    expect(last.outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Kodah Edwards'),
    });
    expect(pickOf(content, '2026-picks-brisbane-port_adelaide-31', spencer).outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Archie Spencer'),
    });
  });

  it('keeps a selected pick one id when its last hop ties nothing (Forster)', () => {
    const fromGoldCoast = {
      future: { round: 3, original: 'Gold Coast' },
      stated: 'traded_on',
      eventual: 'Ben Forster',
    } as const;
    const maginness = { number: 46, stated: 'Ben Forster', eventual: 'Ben Forster' } as const;
    const content = reconcile({
      trades: [
        trade('2025-picks-gold_coast-port_adelaide-34', 'Gold Coast', 'Port Adelaide', [
          fromGoldCoast,
        ]),
        trade("2026-finn-maginness-hudson-o'keeffe", 'Port Adelaide', 'Melbourne', [maginness]),
      ],
      selections: [selection(49, 'Ben Forster', 'Melbourne')],
      order: [
        row({
          roundNumber: 3,
          pickNumber: 49,
          club: 'Melbourne',
          origin: entitlement('Gold Coast', 3, 13),
          // The row's last hop names a trade the candidate does not hold, so it ties nothing.
          hops: [
            hop('Port Adelaide', '2025-picks-gold_coast-port_adelaide-34'),
            hop('Melbourne', '2026-maginness-elsewhere'),
          ],
          outcome: picked('Ben Forster'),
        }),
      ],
      custody: [custody(48, 3, 'Gold Coast', 'Port Adelaide')],
    });
    const first = pickOf(content, '2025-picks-gold_coast-port_adelaide-34', fromGoldCoast);
    const last = pickOf(content, "2026-finn-maginness-hudson-o'keeffe", maginness);
    expect(content.draftOrderPicks![0]!.hopTransferIds).toEqual([first.transfer.transferId, null]);
    expect(first.pickId).toBe(last.pickId);
    expect(last.outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Ben Forster'),
    });
  });

  it('ties one hop to the one of two transfers its custody entitlement agrees with (Brisbane to GWS, trade 16)', () => {
    const snellsPick = { number: 20, stated: 'not_used' } as const;
    const other = { number: 59, stated: 'not_used' } as const;
    const toPort = { number: 19, stated: 'Clancy Snell', eventual: 'Clancy Snell' } as const;
    const content = reconcile({
      trades: [
        trade('2026-picks-brisbane-greater_western_sydney-16', 'Brisbane', 'GWS', [
          snellsPick,
          other,
        ]),
        trade('2026-picks-greater_western_sydney-port_adelaide-26', 'GWS', 'Port Adelaide', [
          toPort,
        ]),
      ],
      selections: [selection(19, 'Clancy Snell', 'Port Adelaide')],
      order: [
        row({
          roundNumber: 1,
          pickNumber: 19,
          club: 'Port Adelaide',
          origin: entitlement('Brisbane', 1, 1),
          hops: [
            hop('GWS', '2026-picks-brisbane-greater_western_sydney-16'),
            hop('Port Adelaide', '2026-picks-greater_western_sydney-port_adelaide-26'),
          ],
          outcome: picked('Clancy Snell'),
        }),
      ],
      // Pick 59's custody names another entitlement, so pick 20's agreeing custody may tie the hop.
      custody: [custody(20, 1, 'Brisbane', 'GWS'), custody(59, 3, 'Brisbane', 'GWS')],
    });
    const tied = pickOf(content, '2026-picks-brisbane-greater_western_sydney-16', snellsPick);
    const last = pickOf(content, '2026-picks-greater_western_sydney-port_adelaide-26', toPort);
    expect(content.draftOrderPicks![0]!.hopTransferIds).toEqual([
      tied.transfer.transferId,
      last.transfer.transferId,
    ]);
    expect(tied.pickId).toBe(last.pickId);
    expect(tied.outcome).toMatchObject({ disposition: 'traded_on', statedDisposition: 'not_used' });
    expect(last.outcome).toMatchObject({
      disposition: 'selected',
      playerId: playerId('Clancy Snell'),
    });
    expect(
      pickOf(content, '2026-picks-brisbane-greater_western_sydney-16', other).outcome
    ).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_not_listed',
    });
  });

  describe('a live swap with three transfers against a spent hop and a compensation hop (Adelaide to Carlton, trade 27)', () => {
    const event = '2026-picks-adelaide-carlton-27';
    const spent = { number: 15, stated: 'not_used' } as const;
    const watkins = { number: 34, stated: 'Jackson Watkins', eventual: 'Jackson Watkins' } as const;
    const unused = { number: 53, stated: 'not_used' } as const;
    const krasna = { number: 13, stated: 'Toby Krasna', eventual: 'Toby Krasna' } as const;
    const swap = (extraCustody: Claim[]) =>
      reconcile({
        trades: [trade(event, 'Adelaide', 'Carlton', [spent, watkins, unused], [krasna])],
        selections: [
          selection(3, 'Cody Walker', 'Carlton'),
          selection(14, 'Toby Krasna', 'Adelaide'),
          selection(37, 'Jackson Watkins', 'Carlton'),
        ],
        order: [
          row({
            roundNumber: 1,
            pickNumber: 14,
            club: 'Adelaide',
            origin: entitlement('Carlton', 1, 8),
            hops: [hop('Adelaide', event)],
            outcome: picked('Toby Krasna'),
          }),
          row({
            roundNumber: 1,
            pickNumber: null,
            club: 'Carlton',
            origin: entitlement('Adelaide', 1, 6),
            hops: [hop('Carlton', event)],
            outcome: { kind: 'bid_spent', nominee: person('Cody Walker'), asPick: 15 },
          }),
          row({
            roundNumber: 2,
            pickNumber: 37,
            club: 'Carlton',
            origin: { kind: 'compensation', label: 'Band 3 Free Agency Comp for Trade Player' },
            hops: [hop('Carlton', event)],
            outcome: picked('Jackson Watkins'),
          }),
        ],
        custody: [custody(15, 1, 'Adelaide', 'Carlton'), ...extraCustody],
      });

    it('ties the compensation hop by its player and the spent hop by its entitlement when the third pick names another', () => {
      const content = swap([custody(53, 3, 'Adelaide', 'Carlton')]);
      expect(pickOf(content, event, spent).outcome).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_bid_spent',
      });
      expect(pickOf(content, event, watkins).outcome).toMatchObject({
        disposition: 'selected',
        playerId: playerId('Jackson Watkins'),
      });
      expect(pickOf(content, event, unused).outcome).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_not_listed',
      });
      expect(pickOf(content, event, krasna).outcome).toMatchObject({
        disposition: 'selected',
        playerId: playerId('Toby Krasna'),
      });
    });

    it('ties the spent hop of one traded leg by the number it was spent as when the third pick names no entitlement but states another number (owner, 2026-11-26)', () => {
      // The genuine Carlton pick 15: "Adel R1 pick (6th) | To Carl in live pick swap | Used to
      // match bid for Cody Walker as pick 15", and the trade states pick 15.
      const content = swap([]);
      expect(pickOf(content, event, watkins).outcome).toMatchObject({
        disposition: 'selected',
        playerId: playerId('Jackson Watkins'),
      });
      const tied = pickOf(content, event, spent);
      expect(tied.outcome).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_bid_spent',
      });
      const orderRow = (content.draftOrderPicks ?? []).find(
        ({ orderPickId }) => orderPickId === tied.outcome!.orderPickId
      );
      expect(orderRow).toMatchObject({ outcome: 'bid_spent', asPick: 15 });
      expect(orderRow!.hopTransferIds).toEqual([tied.transfer.transferId]);
      expect(pickOf(content, event, unused).outcome).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_not_listed',
      });
    });

    it('leaves the spent hop untied, and both picks it could be unresolved, when a second leg names the same entitlement', () => {
      // A second candidate leg: the third pick's custody is Adelaide's first-rounder too, so the
      // number the row was spent as does not settle which leg it was.
      const content = swap([custody(53, 1, 'Adelaide', 'Carlton')]);
      for (const pick of [spent, unused]) {
        expect(pickOf(content, event, pick).outcome).toMatchObject({
          disposition: 'not_used',
          nominationBasis: 'order_ambiguous',
        });
      }
    });
  });

  it('reads a late pick as not listed though its club has untied hops in other trades, and a pick of a trade with an untied hop as unresolved', () => {
    const late = { number: 81, stated: 'not_used' } as const;
    const first = { number: 42, stated: 'not_used' } as const;
    const second = { number: 53, stated: 'not_used' } as const;
    const content = reconcile({
      trades: [
        trade("2026-finn-maginness-hudson-o'keeffe", 'Port Adelaide', 'Western Bulldogs', [late]),
        trade('2026-picks-brisbane-western_bulldogs-17', 'Brisbane', 'Western Bulldogs', [
          first,
          second,
        ]),
      ],
      selections: [selection(1, 'Late Pick', 'Sydney')],
      order: [
        // Melbourne's third-rounder reached the Bulldogs in trade 17, which moved two picks the
        // order cannot tell apart: the hop ties nothing.
        row({
          roundNumber: 3,
          pickNumber: null,
          club: 'Western Bulldogs',
          origin: entitlement('Melbourne', 3, 9),
          hops: [
            hop('Brisbane', '2025-picks-brisbane-collingwood-14'),
            hop('Western Bulldogs', '2026-picks-brisbane-western_bulldogs-17'),
          ],
          outcome: { kind: 'bid_spent', nominee: person('Cody Walker'), asPick: 53 },
        }),
      ],
    });
    expect(pickOf(content, "2026-finn-maginness-hudson-o'keeffe", late).outcome).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_not_listed',
    });
    for (const pick of [first, second]) {
      expect(
        pickOf(content, '2026-picks-brisbane-western_bulldogs-17', pick).outcome
      ).toMatchObject({ disposition: 'not_used', nominationBasis: 'order_ambiguous' });
    }
  });

  it('leaves a pick unresolved only where a late row without origin could be it (Sydney 61, North Melbourne 54, West Coast 65)', () => {
    const sydneyRound4 = {
      future: { round: 4, original: 'Hawthorn' },
      stated: 'not_used',
    } as const;
    const sydneyRound3 = { future: { round: 3, original: 'Carlton' }, stated: 'not_used' } as const;
    const northRound4 = { future: { round: 4, original: 'Adelaide' }, stated: 'not_used' } as const;
    const westRound3 = { future: { round: 3, original: 'Hawthorn' }, stated: 'not_used' } as const;
    const late = (pickNumber: number, roundNumber: number, club: Club) =>
      row({ roundNumber, pickNumber, club, origin: null, hops: [], outcome: picked('Late Pick') });
    const content = reconcile({
      trades: [
        trade('2025-jai-serong', 'Hawthorn', 'Sydney', [sydneyRound4]),
        trade('2025-oliver-florent', 'Carlton', 'Sydney', [sydneyRound3]),
        trade('2025-finnbar-maley', 'Adelaide', 'North Melbourne', [northRound4]),
        trade('2025-picks-hawthorn-west_coast-40', 'Hawthorn', 'West Coast', [westRound3]),
      ],
      selections: [selection(61, 'Late Pick', 'Sydney')],
      order: [late(61, 4, 'Sydney'), late(54, 3, 'North Melbourne'), late(65, 9, 'West Coast')],
    });
    expect(pickOf(content, '2025-jai-serong', sydneyRound4).outcome).toMatchObject({
      disposition: 'not_used',
      nominationBasis: 'order_ambiguous',
    });
    for (const [event, pick] of [
      ['2025-oliver-florent', sydneyRound3],
      ['2025-finnbar-maley', northRound4],
      ['2025-picks-hawthorn-west_coast-40', westRound3],
    ] as const) {
      expect(pickOf(content, event, pick).outcome).toMatchObject({
        disposition: 'not_used',
        nominationBasis: 'order_not_listed',
      });
    }
  });
});
