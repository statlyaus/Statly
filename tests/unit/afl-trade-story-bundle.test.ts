import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeStoryLeftoverLabels,
  aflTradeStoryOrderSpentLabel,
  aflTradeStoryPickLabel,
  createAflTradeStoryBundle,
  createAflTradeStoryBundleSource,
  verifyAflTradeStoryBundle,
  type AflTradeStoryBundleTransfer,
} from '@/server/aflTradeIntelligence/development/tradeStoryBundle';
import {
  cameronChainLines,
  cameronChainNames,
} from '@/server/aflTradeIntelligence/development/tradeStorySampleChain';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';
import type {
  AflTradeAssetLedger,
  AflTradeAssetLedgerBidMatch,
  AflTradeAssetLedgerBidSpentPick,
} from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/serverAuth', () => ({ getExplicitAuthenticatedUserIdFromServerContext: vi.fn() }));

/** The sample chain as the export command would see it: names as labels, each pick its own label. */
function sampleBundle(
  extra: {
    bidMatches?: AflTradeAssetLedgerBidMatch[];
    clubs?: [string, string][];
    players?: [string, string][];
  } = {}
) {
  const transfers: AflTradeStoryBundleTransfer[] =
    cameronChainLines.structure.content.trades.flatMap((trade) =>
      trade.legs.map((leg) => ({
        transferId: leg.transferId,
        asset:
          leg.assetKind === 'player'
            ? { kind: 'player' }
            : {
                kind: 'pick_entitlement',
                draftYear: trade.tradeYear,
                nominalRound: null,
                nominalPick: null,
                originalClubId: null,
                recordedLabel: cameronChainNames.labels.get(leg.transferId) ?? null,
              },
      }))
    );
  return createAflTradeStoryBundle({
    structure: cameronChainLines.structure,
    valueLines: cameronChainLines.valueLines,
    ledger: {
      ledgerId: 'asset-ledger:sample',
      content: { bidMatches: extra.bidMatches ?? [] },
    } as unknown as AflTradeAssetLedger,
    labels: {
      clubs: [...cameronChainNames.clubs, ...(extra.clubs ?? [])].map(([clubId, name]) => ({
        clubId,
        name,
      })),
      players: [...cameronChainNames.players, ...(extra.players ?? [])].map(([playerId, name]) => ({
        playerId,
        name,
      })),
    },
    transfers,
  });
}

/** A spent pick of a Draftguru order bid (owner, 2026-11-24), as the ledger lists it. */
const orderSpent = (
  asPick: number,
  fields: Partial<AflTradeAssetLedgerBidSpentPick> = {}
): AflTradeAssetLedgerBidSpentPick => ({
  nativePickId: `order-${asPick}`,
  label: `Pick ${asPick}`,
  originalNumber: null,
  originalClubId: 'gws',
  pointsUsed: 0,
  pickId: null,
  link: 'order_row_untied',
  countedPoints: null,
  share: null,
  use: null,
  value: null,
  asPick,
  viaClubIds: [],
  originKind: 'entitlement',
  ...fields,
});

describe('trade story bundle (#1052)', () => {
  it('lists each club’s result and what it received, matching the trade’s own page', () => {
    const source = createAflTradeStoryBundleSource(sampleBundle());
    for (const summary of source.list().stories) {
      const { story } = source.load(summary.tradeId)!;
      expect(summary.results?.map(({ clubId, net }) => [clubId, net])).toEqual(
        story.nets.tradeAlone.map(({ clubId, net }) => [clubId, net])
      );
      for (const result of summary.results!) {
        const side = story.sides.find(({ clubId }) => clubId === result.clubId)!;
        expect([...result.received].sort()).toEqual(side.received.map(({ label }) => label).sort());
        expect(result.provisional).toBe(
          story.nets.tradeAlone.find(({ clubId }) => clubId === result.clubId)!.pendingCount > 0
        );
      }
    }
  });

  it('serves the same stories as the samples it was built from', () => {
    const bundle = verifyAflTradeStoryBundle(JSON.parse(JSON.stringify(sampleBundle())));
    const source = createAflTradeStoryBundleSource(bundle);
    const samples = aflTradeStorySamples.list();
    const list = source.list();
    expect(list.source.kind).toBe('sealed_batch');
    expect(list.source.label).toContain(cameronChainLines.valueLines.valueLinesId.slice(0, 24));
    // The bundle adds each club's list result; the samples leave it out.
    expect(list.stories.map(({ results: _results, ...summary }) => summary)).toEqual(
      samples.stories
    );
    for (const { tradeId } of samples.stories)
      expect(source.load(tradeId)?.story).toEqual(aflTradeStorySamples.load(tradeId)?.story);
    expect(source.load('transaction:not-a-trade')).toBeNull();
    expect(bundle.content.publicationProhibited).toBe(true);
  });

  it('refuses a tampered bundle, other value lines, and lines from another structure', () => {
    const bundle = sampleBundle();
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.content.names.clubs[0][1] = 'Not a club';
    expect(() => verifyAflTradeStoryBundle(tampered)).toThrow(/does not match its content/);
    expect(() => verifyAflTradeStoryBundle({ bundleId: 'x', content: {} })).toThrow(/Not an/);
    const otherStructure = {
      ...cameronChainLines.valueLines,
      content: {
        ...cameronChainLines.valueLines.content,
        inputs: {
          ...cameronChainLines.valueLines.content.inputs,
          structureId: 'afl-trade-structure:other',
        },
      },
    };
    expect(() =>
      createAflTradeStoryBundle({
        structure: cameronChainLines.structure,
        valueLines: otherStructure,
        ledger: { ledgerId: 'x', content: { bidMatches: [] } } as unknown as AflTradeAssetLedger,
        labels: { clubs: [], players: [] },
        transfers: [],
      })
    ).toThrow(/value lines id does not match/);
  });

  it('names a pick by its source label, else year, slot and original club', () => {
    const club = (id: string) => (id === 'club:gee' ? 'Geelong' : id);
    const pick = {
      kind: 'pick_entitlement' as const,
      draftYear: 2021,
      nominalRound: 1,
      nominalPick: 15,
      originalClubId: 'club:gee',
      recordedLabel: null,
    };
    expect(aflTradeStoryPickLabel(pick, club)).toBe('2021 pick 15 (Geelong)');
    expect(aflTradeStoryPickLabel({ ...pick, nominalPick: null }, club)).toBe(
      '2021 round 1 (Geelong)'
    );
    expect(aflTradeStoryPickLabel({ ...pick, originalClubId: null }, club)).toBe('2021 pick 15');
    expect(aflTradeStoryPickLabel({ ...pick, recordedLabel: '2021 First Round (GEE)' }, club)).toBe(
      '2021 First Round (GEE)'
    );
    expect(aflTradeStoryPickLabel({ kind: 'special_entitlement' }, club)).toBe(
      'Special draft entitlement'
    );
  });

  it('shows a club under its AFL name where its record keeps a historical one', () => {
    const [clubId] = [...cameronChainNames.clubs.keys()];
    const bundle = sampleBundle();
    const renamed = JSON.parse(JSON.stringify(bundle));
    renamed.content.names.clubs = renamed.content.names.clubs.map(([id, name]: [string, string]) =>
      id === clubId ? [id, 'Footscray'] : [id, name]
    );
    renamed.bundleId = createAflTradeContentAddress('trade-story-bundle', renamed.content);
    const story = createAflTradeStoryBundleSource(verifyAflTradeStoryBundle(renamed))
      .list()
      .stories.find(({ clubIds }) => clubIds.includes(clubId!))!;
    expect(story.clubNames).toContain('Western Bulldogs');
    expect(story.clubNames).not.toContain('Footscray');
  });

  it("labels a pick with no stated original club by its custody's one club, never a guess", () => {
    const trade = cameronChainLines.structure.content.trades[0]!;
    const leg = trade.legs.find(({ assetKind }) => assetKind === 'pick')!;
    const [clubId, clubName] = [...cameronChainNames.clubs][0]!;
    const build = (custody: { pickId: string; originalClubId: string | null }[]) => {
      const transfers = cameronChainLines.structure.content.trades.flatMap((t) =>
        t.legs.map((l) => ({
          transferId: l.transferId,
          asset:
            l.transferId === leg.transferId
              ? {
                  kind: 'pick_entitlement' as const,
                  pickId: 'pick-x',
                  draftYear: 2020,
                  nominalRound: null,
                  nominalPick: 13,
                  originalClubId: null,
                  recordedLabel: null,
                }
              : l.assetKind === 'player'
                ? { kind: 'player' as const }
                : {
                    kind: 'pick_entitlement' as const,
                    draftYear: t.tradeYear,
                    nominalRound: null,
                    nominalPick: null,
                    originalClubId: null,
                    recordedLabel: cameronChainNames.labels.get(l.transferId) ?? null,
                  },
        }))
      );
      const bundle = createAflTradeStoryBundle({
        structure: cameronChainLines.structure,
        valueLines: cameronChainLines.valueLines,
        ledger: { ledgerId: 'x', content: { bidMatches: [] } } as unknown as AflTradeAssetLedger,
        labels: {
          clubs: [...cameronChainNames.clubs].map(([id, name]) => ({ clubId: id, name })),
          players: [...cameronChainNames.players].map(([playerId, name]) => ({ playerId, name })),
        },
        transfers,
        custody,
      });
      return new Map(bundle.content.names.labels).get(leg.transferId);
    };
    expect(build([{ pickId: 'pick-x', originalClubId: clubId }])).toBe(
      `2020 pick 13 (${clubName})`
    );
    expect(build([])).toBe('2020 pick 13');
    const [otherClub] = [...cameronChainNames.clubs.keys()].slice(1);
    expect(
      build([
        { pickId: 'pick-x', originalClubId: clubId },
        { pickId: 'pick-x', originalClubId: otherClub! },
      ])
    ).toBe('2020 pick 13');
  });

  it('fails, never guesses, when a name the stories need is missing', () => {
    const transfers: AflTradeStoryBundleTransfer[] = [];
    expect(() =>
      createAflTradeStoryBundle({
        structure: cameronChainLines.structure,
        valueLines: cameronChainLines.valueLines,
        ledger: { ledgerId: 'x', content: { bidMatches: [] } } as unknown as AflTradeAssetLedger,
        labels: { clubs: [], players: [] },
        transfers,
      })
    ).toThrow(/no name for club/);
  });

  it('reads the samples without a bundle path and the bundle with one, once', async () => {
    const { createConfiguredTradeStorySource } =
      await import('@/server/aflTradeIntelligence/development/privateTradeStoryReads');
    expect(createConfiguredTradeStorySource(() => ({})).list()).toEqual(
      aflTradeStorySamples.list()
    );
    const read = vi.fn(() => JSON.stringify(sampleBundle()));
    const source = createConfiguredTradeStorySource(
      () => ({ AFL_TRADE_STORY_BUNDLE_PATH: '/private/bundle.json' }),
      read
    );
    expect(source.list().source.kind).toBe('sealed_batch');
    source.list();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('/private/bundle.json');
  });
});

describe('trade story bundle: Draftguru order bids (owner, 2026-11-24)', () => {
  const names = new Map([
    ['gws', 'GWS'],
    ['melbourne', 'Melbourne'],
    ['port', 'Port Adelaide'],
    ['footscray', 'Western Bulldogs'],
  ]);
  const name = (clubId: string) => names.get(clubId);

  it('names a spent pick by its live slot and where it came from', () => {
    expect(
      aflTradeStoryOrderSpentLabel(
        orderSpent(13, { originalClubId: 'melbourne', viaClubIds: ['port'] }),
        'gws',
        name
      )
    ).toBe('Pick 13 (from Melbourne via Port Adelaide)');
    expect(
      aflTradeStoryOrderSpentLabel(orderSpent(22, { originalClubId: 'melbourne' }), 'port', name)
    ).toBe('Pick 22 (from Melbourne)');
    // The club's own pick, a compensation pick and a leftover-points pick.
    expect(aflTradeStoryOrderSpentLabel(orderSpent(8), 'gws', name)).toBe('Pick 8');
    expect(
      aflTradeStoryOrderSpentLabel(
        orderSpent(43, { originalClubId: null, originKind: 'compensation' }),
        'footscray',
        name
      )
    ).toBe('Pick 43 (compensation pick)');
    expect(
      aflTradeStoryOrderSpentLabel(orderSpent(30, { originKind: 'leftover_points' }), 'gws', name)
    ).toBe('Pick 30 (from leftover points)');
    // A club with no name leaves the slot alone; a board's spent pick keeps the board's label.
    expect(
      aflTradeStoryOrderSpentLabel(orderSpent(13, { originalClubId: 'unknown' }), 'gws', name)
    ).toBe('Pick 13');
    const board = { ...orderSpent(34), label: 'R3 - Pick 34' };
    delete (board as { asPick?: number }).asPick;
    expect(aflTradeStoryOrderSpentLabel(board, 'gws', name)).toBe('R3 - Pick 34');
  });

  it('carries an order bid with route labels and its leftover pick by number and player', () => {
    const match: AflTradeAssetLedgerBidMatch = {
      bidMatchId: 'external-draft-order-bid-match:test',
      source: 'draftguru_order',
      draftYear: 2026,
      draftType: 'national',
      selectionNumber: 6,
      clubId: 'gws',
      bidClubId: 'essendon',
      basis: 'next_generation_academy',
      ladderPosition: 12,
      nominee: { selectionId: 'sel-m', playerId: 'matthews', firstStint: null },
      pricing: {
        status: 'shared',
        ruleId: 'afl-bid-price-2026-ladder',
        pricePoints: 1493.1,
        leftover: {
          spentNativePickId: 'order-13',
          remainderPoints: 1029.9,
          boardLeftoverPickIds: ['order-eime'],
        },
        deficit: null,
      },
      spentPicks: [
        orderSpent(8),
        orderSpent(13, { originalClubId: 'melbourne', viaClubIds: ['port'] }),
      ],
      orderLeftovers: [{ orderPickId: 'order-eime', pickNumber: 13, playerId: 'eime' }],
    };
    const bundle = sampleBundle({
      bidMatches: [match],
      clubs: [...names],
      players: [
        ['matthews', 'Ethan Matthews'],
        ['eime', 'Jake Eime'],
      ],
    });
    const [carried] = bundle.content.bidMatches;
    expect(carried!.match.spentPicks.map(({ label }) => label)).toEqual([
      'Pick 8',
      'Pick 13 (from Melbourne via Port Adelaide)',
    ]);
    expect(carried!.leftoverLabels).toEqual(['Pick 13 (Jake Eime)']);
    expect(carried!.nomineeName).toBe('Ethan Matthews');
    // A board's bid keeps its leftover label by points, as before.
    expect(
      aflTradeStoryLeftoverLabels({ ...match, orderLeftovers: undefined }, () => undefined)
    ).toEqual(['Leftover-points pick (1029.9 points)']);
  });
});
