import type { AflTradeStoryAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { bidShareValue, formatPav, type AflTradePageBidShare } from './tradePageModel';

/** An asset's value: known PAV, a matched-bid pick's share (2 decimals, starred), or "not in yet". */
export function AssetValue({
  asset,
  share,
}: {
  asset: Pick<AflTradeStoryAsset, 'value'>;
  share: AflTradePageBidShare | null;
}) {
  if (asset.value.kind === 'known') return <>{formatPav(asset.value.pav)}</>;
  const shareValue = bidShareValue(share);
  if (shareValue !== null)
    return (
      <>
        {formatPav(shareValue, 2)}
        <span aria-hidden="true">*</span>
        <span className="sr-only"> (share, not in the totals yet)</span>
      </>
    );
  return <>not in yet</>;
}
