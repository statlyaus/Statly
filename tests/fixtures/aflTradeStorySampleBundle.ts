import {
  createAflTradeStoryBundle,
  type AflTradeStoryBundle,
  type AflTradeStoryBundleTransfer,
} from '@/server/aflTradeIntelligence/development/tradeStoryBundle';
import {
  cameronChainLines,
  cameronChainNames,
} from '@/server/aflTradeIntelligence/development/tradeStorySampleChain';
import type { AflTradeAssetLedger } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';

/** The synthetic sample chain as a sealed bundle, the way the export command builds one. */
export function sampleTradeStoryBundle(): AflTradeStoryBundle {
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
