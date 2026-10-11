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
import { gradeAflTradesOnRealizedValue } from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';

type Provider = AflTradeExternalEvidenceContent['provider'];
type Claim = AflTradeExternalEvidenceContent['claim'];
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
  options: { eventual?: boolean; tradedOn?: number[] } = {}
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
    ...(options.eventual === false
      ? []
      : legs.flatMap(([, , slot, player]): Claim[] =>
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
        )),
  ];
}

const custody = (slot: number, holder: string, original: string): Claim => ({
  kind: 'pick_custody',
  // The 2024 pre-draft order as it stood on 12 November.
  observedAt: '2024-11-12T00:00:00.000Z',
  draftYear: 2024,
  draftType: 'national',
  roundNumber: 1,
  recordedPickNumber: slot,
  originalClub: { nativeId: null, recordedName: original },
  currentClub: { nativeId: null, recordedName: holder },
});

const clubs = ['Carlton', 'West Coast', 'Port Adelaide', 'Gold Coast', 'Richmond', 'Essendon'];
const clubId = (club: string) => `club-${club.toLowerCase().replace(/ /g, '-')}`;
const identityResolutions = clubs.flatMap((club) =>
  (['draftguru', 'official_afl'] as const).map((provider) =>
    createAflTradeExternalIdentityResolution({
      schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
      provider,
      entityKind: 'club',
      sourceIdentity: { nativeId: null, recordedName: club },
      canonicalId: clubId(club),
      reviewDecisionId: `review-decision:${digest('a')}`,
      reviewDecisionSha256: digest('a'),
      decidedAt: '2026-10-11T00:00:00.000Z',
      status: 'current_approved',
    })
  )
);

function reconcile(pages: Claim[][], order: Claim[]) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    sourceBatches: [
      ...pages.map((claims, index) => batch('draftguru', 'abcde'[index]!, claims)),
      ...(order.length === 0 ? [] : [batch('official_afl', 'f', order)]),
    ],
    identityResolutions,
    reconciledAt: '2026-10-12T01:00:00.000Z',
  }).content;
}

const transferOf = (
  candidate: ReturnType<typeof reconcile>,
  from: string,
  to: string,
  slot: number
) =>
  candidate.transfers.find(
    (transfer) =>
      transfer.fromClubId === clubId(from) &&
      transfer.toClubId === clubId(to) &&
      transfer.asset.kind === 'pick_entitlement' &&
      transfer.asset.nominalPick === slot
  )!;
const pickIdOf = (transfer: ReturnType<typeof transferOf>) =>
  transfer.asset.kind === 'pick_entitlement' ? transfer.asset.pickId : null;

// 2024 slot 12 on the grading VM (statlyaus/Statly#886): Carlton's pick 12 went to West Coast in
// the trade period; on draft night, renumbered 15 by bids, West Coast sent it to Port Adelaide for
// picks 16 and 45. Draftguru names Joe Berry as selected with it on both pages.
const tradePeriod = (eventual = true, tradedOn: number[] = [12]) =>
  page('2024-liam-baker-matt-owies', [['Carlton', 'West Coast', 12, 'joe_berry/1']], {
    eventual,
    tradedOn,
  });
const draftNight = (eventual = true) =>
  page(
    '2024-picks-port_adelaide-west_coast-21',
    [
      ['West Coast', 'Port Adelaide', 15, 'joe_berry/1'],
      ['Port Adelaide', 'West Coast', 16, 'bo_allan/1'],
      ['Port Adelaide', 'West Coast', 45, 'tom_gross/1'],
    ],
    { eventual }
  );
const order = [custody(12, 'West Coast', 'Carlton')];

describe('joining a renumbered pick through its eventual selection (statlyaus/Statly#886)', () => {
  it('leaves the renumbered draft-night transfer on its number key without eventual selections', () => {
    const candidate = reconcile([tradePeriod(false), draftNight(false)], order);
    const custodyPick = candidate.pickCustody[0]!.pickId;
    expect(pickIdOf(transferOf(candidate, 'Carlton', 'West Coast', 12))).toBe(custodyPick);
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).not.toBe(
      custodyPick
    );
  });

  it('gives a linear chain the one custody pick its first transfer reached', () => {
    const candidate = reconcile([tradePeriod(), draftNight()], order);
    const custodyPick = candidate.pickCustody[0]!.pickId;
    const onward = transferOf(candidate, 'West Coast', 'Port Adelaide', 15);
    expect(onward.status).toBe('single_source');
    expect(onward.asset).toMatchObject({
      kind: 'pick_entitlement',
      pickId: custodyPick,
      nominalPick: 15,
      originalClubId: clubId('Carlton'),
    });
    expect(pickIdOf(transferOf(candidate, 'Carlton', 'West Coast', 12))).toBe(custodyPick);
    // Picks 16 and 45 name other players and no custody: each keeps its own key.
    expect(pickIdOf(transferOf(candidate, 'Port Adelaide', 'West Coast', 16))).not.toBe(
      custodyPick
    );
    expect(candidate.issues.filter(({ code }) => code === 'lineage_unresolved')).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ subjectKey: expect.stringMatching(/^eventual-selection:/) }),
      ])
    );
  });

  it('keys a chain no custody reaches by its eventually selected player', () => {
    const candidate = reconcile([tradePeriod(), draftNight()], []);
    const [inbound, onward] = [
      transferOf(candidate, 'Carlton', 'West Coast', 12),
      transferOf(candidate, 'West Coast', 'Port Adelaide', 15),
    ];
    expect(pickIdOf(inbound)).toBe(pickIdOf(onward));
    expect(onward.status).toBe('unresolved');
  });

  it('leaves a group that branches as the slot rules made it', () => {
    // One player named on two picks West Coast gave away: a matched bid that used two picks.
    const branching = page('2024-picks-west_coast-richmond-9', [
      ['West Coast', 'Richmond', 30, 'joe_berry/1'],
    ]);
    const candidate = reconcile([tradePeriod(), draftNight(), branching], order);
    const custodyPick = candidate.pickCustody[0]!.pickId;
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).not.toBe(
      custodyPick
    );
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Richmond', 30))).not.toBe(custodyPick);
  });

  it('leaves a group that merges as the slot rules made it', () => {
    const merging = page('2024-picks-essendon-port_adelaide-8', [
      ['Essendon', 'Port Adelaide', 33, 'joe_berry/1'],
    ]);
    const candidate = reconcile([tradePeriod(), draftNight(), merging], order);
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).not.toBe(
      candidate.pickCustody[0]!.pickId
    );
  });

  it('admits a pick swapped back on draft night, walking it in its one order', () => {
    // As Hugh Boxshall's pick moved in 2024: West Coast receives it twice, once in the trade period
    // and once back from Port; there is still one walk, Carlton → West Coast → Port → West Coast.
    const swappedBack = page('2024-picks-port_adelaide-west_coast-30', [
      ['Port Adelaide', 'West Coast', 20, 'joe_berry/1'],
    ]);
    const candidate = reconcile([tradePeriod(), draftNight(), swappedBack], order);
    const custodyPick = candidate.pickCustody[0]!.pickId;
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).toBe(custodyPick);
    expect(pickIdOf(transferOf(candidate, 'Port Adelaide', 'West Coast', 20))).toBe(custodyPick);
  });

  it('refuses a closed loop, which has no first holder', () => {
    const loop = [
      page('2024-picks-port_adelaide-west_coast-21', [
        ['West Coast', 'Port Adelaide', 15, 'joe_berry/1'],
      ]),
      page('2024-picks-port_adelaide-richmond-22', [
        ['Port Adelaide', 'Richmond', 20, 'joe_berry/1'],
      ]),
      page('2024-picks-richmond-west_coast-23', [['Richmond', 'West Coast', 30, 'joe_berry/1']]),
    ];
    const candidate = reconcile(loop, []);
    const ids = new Set(
      [
        transferOf(candidate, 'West Coast', 'Port Adelaide', 15),
        transferOf(candidate, 'Port Adelaide', 'Richmond', 20),
        transferOf(candidate, 'Richmond', 'West Coast', 30),
      ].map(pickIdOf)
    );
    expect(ids.size).toBe(3);
  });

  it('refuses a group with two possible orders', () => {
    // West Coast sends the pick to Port twice (as 15 and as 25) and gets it back once in between:
    // nothing says which transfer came first.
    const ambiguous = [
      tradePeriod(),
      page('2024-picks-port_adelaide-west_coast-21', [
        ['West Coast', 'Port Adelaide', 15, 'joe_berry/1'],
      ]),
      page('2024-picks-port_adelaide-west_coast-22', [
        ['Port Adelaide', 'West Coast', 20, 'joe_berry/1'],
      ]),
      page('2024-picks-port_adelaide-west_coast-23', [
        ['West Coast', 'Port Adelaide', 25, 'joe_berry/1'],
      ]),
    ];
    const candidate = reconcile(ambiguous, order);
    const custodyPick = candidate.pickCustody[0]!.pickId;
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 15))).not.toBe(
      custodyPick
    );
    expect(pickIdOf(transferOf(candidate, 'West Coast', 'Port Adelaide', 25))).not.toBe(
      custodyPick
    );
  });

  it('takes the earliest custody pick when draft night misjoined a later transfer to another slot', () => {
    // The order also shows Port holding slot 15 as West Coast's own pick, so by number the draft-night
    // transfer (live #15) reaches that pick too. The order names West Coast, which the trade period
    // delivered the pick to, as slot 12's holder, so slot 12 is the pick and the #15 join is wrong.
    const candidate = reconcile(
      [tradePeriod(), draftNight()],
      [...order, custody(15, 'Port Adelaide', 'West Coast')]
    );
    const twelve = candidate.pickCustody.find(
      ({ recordedPickNumber }) => recordedPickNumber === 12
    )!;
    for (const transfer of [
      transferOf(candidate, 'Carlton', 'West Coast', 12),
      transferOf(candidate, 'West Coast', 'Port Adelaide', 15),
    ]) {
      expect(transfer.status).toBe('single_source');
      expect(transfer.asset).toMatchObject({ pickId: twelve.pickId });
    }
    expect(
      candidate.issues.some(({ subjectKey }) => subjectKey.startsWith('eventual-selection:'))
    ).toBe(false);
  });

  it('leaves a group unresolved when both custody picks rest on pre-draft numbering', () => {
    // Carlton's 2024 first-rounder went to West Coast in 2023, then to Port as #15. The order shows
    // Port holding both Carlton's first-rounder (slot 12) and West Coast's slot 15: the #15 transfer
    // preceded the order, so its number is the pre-draft slot and nothing chooses between the two.
    const future = page('2023-carlton-west_coast', [], {});
    future[0] = { ...(future[0] as Extract<Claim, { kind: 'transaction' }>), seasonYear: 2023 };
    future.push(
      {
        kind: 'transaction_party',
        nativeEventId: '2023-carlton-west_coast',
        nativePartyId: 'carlton',
        club: { nativeId: null, recordedName: 'Carlton' },
      },
      {
        kind: 'transaction_party',
        nativeEventId: '2023-carlton-west_coast',
        nativePartyId: 'west coast',
        club: { nativeId: null, recordedName: 'West Coast' },
      },
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
        player: { nativeId: 'joe_berry/1', recordedName: 'Joe Berry' },
      }
    );
    const candidate = reconcile(
      [future, draftNight()],
      [custody(12, 'Port Adelaide', 'Carlton'), custody(15, 'Port Adelaide', 'West Coast')]
    );
    const [twelve, fifteen] = [12, 15].map(
      (slot) =>
        candidate.pickCustody.find(({ recordedPickNumber }) => recordedPickNumber === slot)!.pickId
    );
    expect(transferOf(candidate, 'West Coast', 'Port Adelaide', 15).status).toBe('unresolved');
    const issue = candidate.issues.find(({ subjectKey }) =>
      subjectKey.startsWith('eventual-selection:2024|national|joe_berry/1')
    );
    expect(issue).toMatchObject({ code: 'lineage_unresolved', severity: 'blocking' });
    expect(issue!.detail).toContain(twelve!);
    expect(issue!.detail).toContain(fifteen!);
  });

  it('lets the grader follow the traded-on pick into its draft-night trade', () => {
    const grade = (eventual: boolean) => {
      const candidate = reconcile([tradePeriod(eventual), draftNight(eventual)], order);
      const leg = transferOf(candidate, 'Carlton', 'West Coast', 12);
      const batch = gradeAflTradesOnRealizedValue({
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
      });
      return batch.content.trades
        .flatMap(({ legs }) => legs)
        .find(({ transferId }) => transferId === leg.transferId)!;
    };
    expect(grade(false).reasons).toEqual(['traded_on_return_unlinked']);
    // Linked: the leg now follows the draft-night trade, whose own received picks have no stated
    // outcome here, so it is blocked on that trade rather than unlinked.
    expect(grade(true).reasons).toEqual(['traded_on_return_blocked']);
  });
});
