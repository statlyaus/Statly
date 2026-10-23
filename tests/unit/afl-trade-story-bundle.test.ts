import { describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
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
import type { AflTradeAssetLedger } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/serverAuth', () => ({ getExplicitAuthenticatedUserIdFromServerContext: vi.fn() }));

/** The sample chain as the export command would see it: names as labels, each pick its own label. */
function sampleBundle() {
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
      content: { bidMatches: [] },
    } as unknown as AflTradeAssetLedger,
    labels: {
      clubs: [...cameronChainNames.clubs].map(([clubId, name]) => ({ clubId, name })),
      players: [...cameronChainNames.players].map(([playerId, name]) => ({ playerId, name })),
    },
    transfers,
  });
}

describe('trade story bundle (#1052)', () => {
  it('serves the same stories as the samples it was built from', () => {
    const bundle = verifyAflTradeStoryBundle(JSON.parse(JSON.stringify(sampleBundle())));
    const source = createAflTradeStoryBundleSource(bundle);
    const samples = aflTradeStorySamples.list();
    const list = source.list();
    expect(list.source.kind).toBe('sealed_batch');
    expect(list.source.label).toContain(cameronChainLines.valueLines.valueLinesId.slice(0, 24));
    expect(list.stories).toEqual(samples.stories);
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
