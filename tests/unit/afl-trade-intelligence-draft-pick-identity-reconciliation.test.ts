import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
import {
  aflTradeNumberOnlyPickId,
  aflTradePickIdentityViolations,
} from '@/server/aflTradeIntelligence/source/pickIdentityRules';

/**
 * Draft-pick identity in reconciliation (docs/architecture/afl-draft-pick-identity-rules.md,
 * statlyaus/Statly#853): each case is one a batch-ten trace traced to a reconciler step, built from
 * synthetic evidence. Every candidate built here must satisfy every rule the database enforces at
 * finalization; where the evidence cannot decide, the candidate records a conflict instead.
 */
type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
type Asset = Extract<Claim, { kind: 'directed_transfer' }>['asset'];
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

const codes: Record<string, string> = {
  Carlton: 'CAR',
  'West Coast': 'WCE',
  'Port Adelaide': 'PAD',
  'Gold Coast': 'GCS',
  Richmond: 'RCH',
  Essendon: 'ESS',
  Melbourne: 'MEL',
  Brisbane: 'BRL',
  'Western Bulldogs': 'WBD',
  Sydney: 'SYD',
};
const clubs = Object.keys(codes);
const clubId = (club: string) => `club-${club.toLowerCase().replace(/ /g, '-')}`;
const footyinfoClub = (club: string) => ({ nativeId: codes[club]!, recordedName: club });
const recorded = (club: string) => ({ nativeId: null, recordedName: club });
const pickNumber = (recordedPickNumber: number): Asset => ({
  kind: 'current_pick',
  draftYear: 2024,
  draftType: 'national',
  recordedPickNumber,
});
const futurePick = (originalClub: string, roundNumber = 1): Asset => ({
  kind: 'future_pick',
  draftYear: 2024,
  draftType: 'national',
  roundNumber,
  originalClub: recorded(originalClub),
});

/** One leg of a Draftguru trade page: the asset, and the player Draftguru says it was used on. */
interface Leg {
  from: string;
  to: string;
  asset: Asset;
  id: string;
  eventual?: string | 'not_used';
  disposition?: { selected: string } | 'traded_on' | 'not_used';
}

function page(eventId: string, legs: Leg[], seasonYear = 2024): Claim[] {
  const parties = [...new Set(legs.flatMap(({ from, to }) => [from, to]))];
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear,
      occurredOn: null,
      transactionType: 'trade',
      title: null,
    },
    ...parties.map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: eventId,
      nativePartyId: club.toLowerCase(),
      club: recorded(club),
    })),
    ...legs.flatMap(({ from, to, asset, id, eventual, disposition }): Claim[] => [
      {
        kind: 'directed_transfer',
        nativeEventId: eventId,
        nativeTransferId: id,
        fromClub: recorded(from),
        toClub: recorded(to),
        asset,
      },
      ...(eventual === undefined
        ? []
        : [
            eventual === 'not_used'
              ? ({
                  kind: 'pick_eventual_selection',
                  nativeEventId: eventId,
                  nativeTransferId: id,
                  outcome: 'not_used',
                } as const)
              : ({
                  kind: 'pick_eventual_selection',
                  nativeEventId: eventId,
                  nativeTransferId: id,
                  outcome: 'selected',
                  player: { nativeId: eventual, recordedName: eventual },
                } as const),
          ]),
      ...(disposition === undefined
        ? []
        : [
            typeof disposition === 'object'
              ? ({
                  kind: 'pick_disposition',
                  nativeEventId: eventId,
                  nativeTransferId: id,
                  receivingClub: recorded(to),
                  disposition: 'selected',
                  player: { nativeId: disposition.selected, recordedName: disposition.selected },
                } as const)
              : ({
                  kind: 'pick_disposition',
                  nativeEventId: eventId,
                  nativeTransferId: id,
                  receivingClub: recorded(to),
                  disposition,
                } as const),
          ]),
    ]),
  ];
}

const custody = (slot: number, holder: string, original: string, roundNumber = 1): Claim => ({
  kind: 'pick_custody',
  observedAt: '2024-11-12T00:00:00.000Z',
  draftYear: 2024,
  draftType: 'national',
  roundNumber,
  recordedPickNumber: slot,
  originalClub: recorded(original),
  currentClub: recorded(holder),
});

const selection = (selectionNumber: number, player: string, club: string): Claim => ({
  kind: 'draft_selection',
  draftYear: 2024,
  draftType: 'national',
  selectionNumber,
  roundNumber: null,
  player: { nativeId: player, recordedName: player },
  selectedByClub: recorded(club),
});

const boardPick = (number: number, player: string, route: string[]): Claim => ({
  kind: 'draft_board_pick',
  draftYear: 2024,
  draftType: 'national',
  roundNumber: 1,
  recordedPickNumber: number,
  status: 'selected',
  club: footyinfoClub(route.at(-1)!),
  player: { nativeId: `fi-${player}`, recordedName: player },
  route: route.map(footyinfoClub),
  routeLabel: null,
  bid: null,
  points: null,
  note: null,
});

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

const players = ['berry', 'chesser', 'sinn', 'taylor', 'pickett', 'hall', 'murphy'];
const identities = [
  ...clubs.flatMap((club) =>
    (['draftguru', 'official_afl'] as const).map((provider) =>
      identity(provider, 'club', recorded(club), clubId(club))
    )
  ),
  ...clubs.map((club) => identity('footyinfo', 'club', footyinfoClub(club), clubId(club))),
  ...players.flatMap((player) => [
    identity('draftguru', 'player', { nativeId: player, recordedName: player }, `player-${player}`),
    identity(
      'footyinfo',
      'player',
      { nativeId: `fi-${player}`, recordedName: player },
      `player-${player}`
    ),
  ]),
];

function reconcile(
  pages: Claim[][],
  options: { order?: Claim[]; selections?: Claim[]; board?: Claim[] } = {}
) {
  const content = parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2024,
      sourceBatches: [
        ...pages.map((claims, index) => batch('draftguru', 'abcde'[index]!, claims)),
        ...(options.selections?.length ? [batch('draftguru', '6', options.selections)] : []),
        ...(options.order?.length ? [batch('official_afl', 'f', options.order)] : []),
        ...(options.board?.length ? [batch('footyinfo', '7', options.board)] : []),
      ],
      identityResolutions: identities,
      reconciledAt: '2026-10-12T01:00:00.000Z',
    })
  ).content;
  // Whatever the evidence, the reconciler never builds a candidate finalization refuses.
  expect(aflTradePickIdentityViolations(content)).toEqual([]);
  return content;
}
type Candidate = ReturnType<typeof reconcile>;

const transfer = (candidate: Candidate, from: string, to: string, slot: number | null) =>
  candidate.transfers.find(
    (row) =>
      row.fromClubId === clubId(from) &&
      row.toClubId === clubId(to) &&
      row.asset.kind === 'pick_entitlement' &&
      row.asset.nominalPick === slot
  )!;
const pickOf = (row: ReturnType<typeof transfer>) =>
  row.asset.kind === 'pick_entitlement' ? row.asset.pickId : null;
const originalOf = (row: ReturnType<typeof transfer>) =>
  row.asset.kind === 'pick_entitlement' ? row.asset.originalClubId : null;
const conflicts = (candidate: Candidate) =>
  candidate.issues
    .filter(({ code }) => code === 'pick_identity_conflict')
    .map(({ subjectKey }) => subjectKey);

describe('number-only pick ids (rule 6)', () => {
  it('scopes a number no custody resolves to its own transfer, apart from other trades and selections', () => {
    const candidate = reconcile(
      [
        page('2024-picks-carlton-west_coast-1', [
          { from: 'Carlton', to: 'West Coast', asset: pickNumber(30), id: 'p30' },
        ]),
        page('2024-picks-essendon-richmond-2', [
          { from: 'Richmond', to: 'Essendon', asset: pickNumber(30), id: 'p30' },
        ]),
      ],
      { selections: [selection(30, 'berry', 'Essendon')] }
    );
    const first = transfer(candidate, 'Carlton', 'West Coast', 30);
    const second = transfer(candidate, 'Richmond', 'Essendon', 30);
    const selected = candidate.draftSelections.find(
      ({ selectionNumber }) => selectionNumber === 30
    )!;
    expect(new Set([pickOf(first), pickOf(second), selected.pickId]).size).toBe(3);
    // Neither transfer carries the number-only form the database classifies and checks.
    for (const row of [first, second]) {
      expect(pickOf(row)).not.toBe(aflTradeNumberOnlyPickId(row.asset as never));
      expect(row.status).toBe('unresolved');
    }
  });
});

describe('slot joins and the eventual-selection join (rules 1, 2, 3 and 7)', () => {
  const chain = (eventual?: string) => [
    page('2024-picks-essendon-melbourne-7', [
      { from: 'Melbourne', to: 'Essendon', asset: pickNumber(54), id: 'p54', eventual },
    ]),
    page('2024-picks-brisbane-essendon-24', [
      { from: 'Essendon', to: 'Brisbane', asset: pickNumber(54), id: 'p54', eventual },
    ]),
  ];
  const order = [custody(54, 'Essendon', 'Western Bulldogs', 3)];

  it('leaves a hop with no evidence of the slot on its own id instead of spreading the chain’s', () => {
    // As 2024 slot 54: the order shows Essendon holding the Bulldogs' pick; nothing delivers it to
    // Melbourne, so only Essendon -> Brisbane is tied to it.
    const candidate = reconcile(chain(), { order });
    const slot = candidate.pickCustody[0]!.pickId;
    expect(pickOf(transfer(candidate, 'Essendon', 'Brisbane', 54))).toBe(slot);
    expect(pickOf(transfer(candidate, 'Melbourne', 'Essendon', 54))).not.toBe(slot);
    expect(transfer(candidate, 'Melbourne', 'Essendon', 54).status).toBe('unresolved');
  });

  it('joins the hops when Draftguru states each was used on the same player, with the pick’s original club', () => {
    const candidate = reconcile(chain('berry'), { order });
    const slot = candidate.pickCustody[0]!;
    for (const row of [
      transfer(candidate, 'Melbourne', 'Essendon', 54),
      transfer(candidate, 'Essendon', 'Brisbane', 54),
    ]) {
      expect(pickOf(row)).toBe(slot.pickId);
      expect(originalOf(row)).toBe(clubId('Western Bulldogs'));
      expect(row.status).toBe('single_source');
    }
  });

  it('gives a current pick the original club of the pick the walk settles on, not its slot join’s', () => {
    // As 2024 Brisbane -> Gold Coast "Pick 47": its shifted-slot join named Brisbane's own pick,
    // while the walk (and the order) settle on the Bulldogs' pick it was eventually used with.
    const candidate = reconcile(
      [
        ...chain('berry'),
        page('2024-picks-brisbane-gold_coast-30', [
          {
            from: 'Brisbane',
            to: 'Gold Coast',
            asset: pickNumber(47),
            id: 'p47',
            eventual: 'berry',
          },
        ]),
      ],
      { order: [...order, custody(41, 'Gold Coast', 'Brisbane', 3)] }
    );
    const bulldogs = candidate.pickCustody.find(
      ({ recordedPickNumber }) => recordedPickNumber === 54
    )!;
    const shifted = transfer(candidate, 'Brisbane', 'Gold Coast', 47);
    expect(pickOf(shifted)).toBe(bulldogs.pickId);
    expect(originalOf(shifted)).toBe(clubId('Western Bulldogs'));
    expect(conflicts(candidate)).toEqual([]);
  });

  it('records a conflict, re-keying nothing, when a future pick states another entitlement', () => {
    const pages = [
      page(
        '2023-carlton-melbourne',
        [
          {
            from: 'Carlton',
            to: 'Melbourne',
            asset: futurePick('Carlton'),
            id: 'future-pick:2024:national:1:carlton',
            eventual: 'berry',
          },
        ],
        2023
      ),
      ...chain('berry'),
    ];
    const candidate = reconcile(pages, { order });
    const slot = candidate.pickCustody[0]!.pickId;
    const carlton = pickOf(transfer(candidate, 'Carlton', 'Melbourne', null))!;
    expect(conflicts(candidate)).toEqual(
      [`pick-custody:${slot}`, `pick-custody:${carlton}`].sort()
    );
    expect(pickOf(transfer(candidate, 'Melbourne', 'Essendon', 54))).not.toBe(slot);
    expect(pickOf(transfer(candidate, 'Melbourne', 'Essendon', 54))).not.toBe(carlton);
  });

  it('records a conflict when the walk would move one pick twice in one exchange under two numbers', () => {
    // A pick passed through three clubs in one trade under two numbers: the walk admits it, the
    // exchange cannot carry it.
    const candidate = reconcile(
      [
        page('2024-carlton-west_coast-richmond', [
          {
            from: 'Carlton',
            to: 'West Coast',
            asset: pickNumber(10),
            id: 'p10',
            eventual: 'berry',
          },
          {
            from: 'West Coast',
            to: 'Richmond',
            asset: pickNumber(12),
            id: 'p12',
            eventual: 'berry',
          },
        ]),
      ],
      { order: [custody(10, 'West Coast', 'Carlton')] }
    );
    const slot = candidate.pickCustody[0]!.pickId;
    expect(pickOf(transfer(candidate, 'Carlton', 'West Coast', 10))).toBe(slot);
    expect(pickOf(transfer(candidate, 'West Coast', 'Richmond', 12))).not.toBe(slot);
    expect(conflicts(candidate)).toEqual([`pick-custody:${slot}`]);
  });

  it('keeps one pick passed through three clubs in one exchange under one number', () => {
    const candidate = reconcile(
      [
        page('2024-carlton-west_coast-richmond', [
          { from: 'Carlton', to: 'West Coast', asset: pickNumber(10), id: 'a', eventual: 'berry' },
          { from: 'West Coast', to: 'Richmond', asset: pickNumber(10), id: 'b', eventual: 'berry' },
        ]),
      ],
      { order: [custody(10, 'West Coast', 'Carlton')] }
    );
    const slot = candidate.pickCustody[0]!.pickId;
    expect(pickOf(transfer(candidate, 'West Coast', 'Richmond', 10))).toBe(slot);
    expect(conflicts(candidate)).toEqual([]);
  });

  it('keeps a pick swapped back on draft night on one id across both exchanges', () => {
    const candidate = reconcile(
      [
        page('2024-picks-carlton-west_coast-1', [
          { from: 'Carlton', to: 'West Coast', asset: pickNumber(10), id: 'p', eventual: 'berry' },
        ]),
        page('2024-picks-carlton-west_coast-2', [
          { from: 'West Coast', to: 'Carlton', asset: pickNumber(10), id: 'p', eventual: 'berry' },
        ]),
      ],
      { order: [custody(10, 'Carlton', 'Carlton')] }
    );
    expect(pickOf(transfer(candidate, 'Carlton', 'West Coast', 10))).toBe(
      pickOf(transfer(candidate, 'West Coast', 'Carlton', 10))
    );
  });
});

describe('number joins a transfer’s own statement contradicts (rule 3)', () => {
  // Essendon holds its own slot 30 in the order; two draft-night transfers out of Essendon both
  // carry "Pick 30" and are both slot-joined to it, stating different players.
  const contested = (extra: Claim[][] = []) => [
    page('2024-picks-essendon-west_coast-9', [
      { from: 'Essendon', to: 'West Coast', asset: pickNumber(30), id: 'p30', eventual: 'berry' },
    ]),
    page('2024-picks-essendon-melbourne-10', [
      { from: 'Essendon', to: 'Melbourne', asset: pickNumber(30), id: 'p30', eventual: 'hall' },
    ]),
    ...extra,
  ];
  const slot30 = custody(30, 'Essendon', 'Essendon');

  it('refuses every number join and records a conflict when nothing decides', () => {
    const candidate = reconcile(contested(), { order: [slot30] });
    const slot = candidate.pickCustody[0]!.pickId;
    expect(pickOf(transfer(candidate, 'Essendon', 'West Coast', 30))).not.toBe(slot);
    expect(pickOf(transfer(candidate, 'Essendon', 'Melbourne', 30))).not.toBe(slot);
    expect(conflicts(candidate)).toEqual([`pick-custody:${slot}`]);
  });

  it('moves a player’s number join off a slot when an exact tie places the player’s pick elsewhere', () => {
    // Carlton -> Richmond "Pick 20" is Carlton's own slot 20 exactly, and Draftguru says it was
    // used on Berry too: Berry's pick is slot 20, so the "Pick 30" join is a number coincidence.
    const candidate = reconcile(
      contested([
        page('2024-picks-carlton-richmond-3', [
          { from: 'Carlton', to: 'Richmond', asset: pickNumber(20), id: 'p20', eventual: 'berry' },
        ]),
      ]),
      { order: [slot30, custody(20, 'Richmond', 'Carlton')] }
    );
    const thirty = candidate.pickCustody.find(
      ({ recordedPickNumber }) => recordedPickNumber === 30
    )!;
    expect(pickOf(transfer(candidate, 'Essendon', 'Melbourne', 30))).toBe(thirty.pickId);
    expect(pickOf(transfer(candidate, 'Essendon', 'West Coast', 30))).not.toBe(thirty.pickId);
    expect(conflicts(candidate)).toEqual([]);
  });

  it('moves a player’s number join off a slot whose original club the board’s route contradicts', () => {
    const candidate = reconcile(contested(), {
      order: [slot30],
      selections: [selection(28, 'berry', 'West Coast')],
      board: [boardPick(28, 'berry', ['Carlton', 'Essendon', 'West Coast'])],
    });
    const thirty = candidate.pickCustody[0]!;
    expect(pickOf(transfer(candidate, 'Essendon', 'Melbourne', 30))).toBe(thirty.pickId);
    expect(pickOf(transfer(candidate, 'Essendon', 'West Coast', 30))).not.toBe(thirty.pickId);
    expect(conflicts(candidate)).toEqual([]);
  });

  it('lets a stated entitlement keep its pick against a number join stating another player', () => {
    // As 2021 Hawthorn's round-4 pick (Hugh Jackson): Port Adelaide -> West Coast "Pick 62" on
    // draft night was joined to the pre-draft slot 62 it shares a number with.
    const candidate = reconcile(
      [
        page(
          '2023-hawthorn-port_adelaide',
          [
            {
              from: 'Carlton',
              to: 'Port Adelaide',
              asset: futurePick('Carlton', 4),
              id: 'future-pick:2024:national:4:carlton',
              eventual: 'murphy',
            },
          ],
          2023
        ),
        page('2024-picks-port_adelaide-west_coast-5', [
          {
            from: 'Port Adelaide',
            to: 'West Coast',
            asset: pickNumber(62),
            id: 'p62',
            eventual: 'hall',
          },
        ]),
      ],
      { order: [custody(62, 'Port Adelaide', 'Carlton', 4)] }
    );
    const slot = candidate.pickCustody[0]!.pickId;
    expect(pickOf(transfer(candidate, 'Carlton', 'Port Adelaide', null))).toBe(slot);
    expect(pickOf(transfer(candidate, 'Port Adelaide', 'West Coast', 62))).not.toBe(slot);
    expect(conflicts(candidate)).toEqual([]);
  });
});

describe('selections keyed by the statements on their pick (rule 4)', () => {
  // As 2021 #12 and #14: Sydney's pick 12 (pre-draft) was used on Chesser at 14; West Coast's own
  // pick went to Port Adelaide on draft night as "Pick 12" and was used on Sinn at 12.
  const pages = [
    page('2023-ladhams', [
      {
        from: 'Sydney',
        to: 'Port Adelaide',
        asset: pickNumber(12),
        id: 'p12',
        eventual: 'chesser',
      },
    ]),
    page('2024-picks-port_adelaide-west_coast-1', [
      {
        from: 'Port Adelaide',
        to: 'West Coast',
        asset: pickNumber(14),
        id: 'p14',
        eventual: 'chesser',
      },
      {
        from: 'West Coast',
        to: 'Port Adelaide',
        asset: pickNumber(12),
        id: 'p12',
        eventual: 'sinn',
      },
    ]),
  ];
  const options = {
    order: [custody(12, 'Port Adelaide', 'Sydney')],
    selections: [selection(12, 'sinn', 'Port Adelaide'), selection(14, 'chesser', 'West Coast')],
  };

  it('joins each selection to the pick its own player’s transfers state, not the slot sharing its number', () => {
    const candidate = reconcile(pages, options);
    const sydney = candidate.pickCustody[0]!.pickId;
    const at = (number: number) =>
      candidate.draftSelections.find(({ selectionNumber }) => selectionNumber === number)!;
    expect(at(14).pickId).toBe(sydney);
    expect(at(12).pickId).not.toBe(sydney);
    expect(pickOf(transfer(candidate, 'West Coast', 'Port Adelaide', 12))).toBe(at(12).pickId);
    expect(candidate.pickLineage.map(({ selectionId }) => selectionId)).toEqual([
      at(14).selectionId,
      at(14).selectionId,
    ]);
  });
});

describe('Footyinfo routes against a selected pick’s transfers (rule 5)', () => {
  it('records a conflict, and writes no lineage, when a transfer on the selected pick is off the route', () => {
    const pages = [
      page('2024-picks-carlton-gold_coast-1', [
        { from: 'Gold Coast', to: 'Carlton', asset: pickNumber(22), id: 'p', eventual: 'berry' },
      ]),
      page('2024-picks-carlton-port_adelaide-2', [
        { from: 'Carlton', to: 'Port Adelaide', asset: pickNumber(22), id: 'p', eventual: 'berry' },
      ]),
      page('2024-picks-brisbane-port_adelaide-3', [
        {
          from: 'Port Adelaide',
          to: 'Brisbane',
          asset: pickNumber(22),
          id: 'p',
          eventual: 'berry',
        },
      ]),
    ];
    const selections = [selection(22, 'berry', 'Brisbane')];
    const onRoute = reconcile(pages, {
      selections,
      board: [boardPick(22, 'berry', ['Gold Coast', 'Carlton', 'Port Adelaide', 'Brisbane'])],
    });
    expect(conflicts(onRoute)).toEqual([]);

    const candidate = reconcile(pages, {
      selections,
      board: [boardPick(22, 'berry', ['Richmond', 'Carlton', 'Port Adelaide', 'Brisbane'])],
    });
    const selected = candidate.draftSelections[0]!;
    expect(conflicts(candidate)).toEqual([`pick-custody:${selected.pickId}`]);
    expect(candidate.pickLineage).toEqual([]);
  });
});

describe('disputed entitlements', () => {
  // Two order rows observed at one time give Carlton two round-2 picks: one entitlement id, disputed.
  const order = [custody(20, 'Carlton', 'Carlton', 2), custody(25, 'Carlton', 'Carlton', 2)];
  const entitlement = createAflTradeContentAddress('draft-pick', {
    draftYear: 2024,
    draftType: 'national',
    roundNumber: 2,
    originalClubId: clubId('Carlton'),
  });

  it('gives each future-pick transfer of a disputed entitlement its own id, even in one exchange', () => {
    const candidate = reconcile(
      [
        page(
          '2023-carlton-west_coast',
          [
            {
              from: 'Carlton',
              to: 'West Coast',
              asset: futurePick('Carlton', 2),
              id: 'future-pick:2024:national:2:carlton:a',
            },
            {
              from: 'Carlton',
              to: 'West Coast',
              asset: futurePick('Carlton', 2),
              id: 'future-pick:2024:national:2:carlton:b',
            },
          ],
          2023
        ),
      ],
      { order }
    );
    expect(candidate.pickCustody.map(({ status }) => status)).toEqual(['disputed', 'disputed']);
    const ids = candidate.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' ? [asset.pickId] : []
    );
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(entitlement);
  });
});
