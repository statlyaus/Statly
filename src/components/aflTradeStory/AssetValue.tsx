import type { AflTradeStoryAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { PENDING_TEXT, valueText } from './tradePageModel';

/**
 * An asset's value from its value line (a matched-bid share to 2 decimals), or "not in yet". An
 * at-trade value not in yet gives the line's reason, as nothing else on its row does.
 */
export function AssetValue({
  asset,
  view = 'value',
}: {
  asset: Pick<AflTradeStoryAsset, 'value' | 'atTrade' | 'outcome'>;
  /** `atTrade`: the asset's value at this trade, shown beside the result. */
  view?: 'value' | 'atTrade';
}) {
  if (view === 'atTrade')
    return (
      <>
        {asset.atTrade.kind === 'pending'
          ? PENDING_TEXT[asset.atTrade.pending]
          : valueText(asset.atTrade)}
      </>
    );
  return <>{valueText(asset.value, asset.outcome) ?? 'not in yet'}</>;
}
