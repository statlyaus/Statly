import type { AflTradeStoryAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { valueText } from './tradePageModel';

/** An asset's value from its value line (a matched-bid share to 2 decimals), or "not in yet". */
export function AssetValue({
  asset,
  view = 'value',
}: {
  asset: Pick<AflTradeStoryAsset, 'value' | 'atTrade' | 'outcome'>;
  /** `atTrade`: the asset's value at this trade, shown beside the result. */
  view?: 'value' | 'atTrade';
}) {
  const text =
    view === 'atTrade' ? valueText(asset.atTrade) : valueText(asset.value, asset.outcome);
  return <>{text ?? 'not in yet'}</>;
}
