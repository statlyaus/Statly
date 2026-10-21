import type { AflTradeStoryValue } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  formatPav,
  formatPercent,
  formatPoints,
  inSentence,
  type AflTradePageBidShare,
} from './tradePageModel';

export const bidShareAnchor = (assetId: string) =>
  `bid-${assetId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;

/**
 * A pick spent matching a bid, shown as a swap: the pick bought a share of the nominee, in
 * proportion to the points it covered of the AFL price. The price, points and shares come from the
 * asset ledger; the pick's value is its value line (the share of the nominee's line).
 */
export function BidMatchShareCard({
  assetId,
  label,
  share: { bid, spentIndex },
  value,
}: {
  assetId: string;
  label: string;
  share: AflTradePageBidShare;
  /** The pick's value line at the story's checkpoint. */
  value: AflTradeStoryValue;
}) {
  const { match, nomineeName, clubName, leftoverLabels } = bid;
  const spent = match.spentPicks[spentIndex]!;
  const price = match.pricing.status === 'shared' ? match.pricing.pricePoints : null;
  const leftover = match.pricing.status === 'shared' ? match.pricing.leftover : null;
  const headingId = `${bidShareAnchor(assetId)}-title`;

  return (
    <article
      id={bidShareAnchor(assetId)}
      aria-labelledby={headingId}
      className="scroll-mt-6 rounded-xl border border-(--ts-line) bg-(--ts-surface) p-4"
    >
      <p className="inline-flex rounded-md bg-(--ts-bid-soft) px-2 py-0.5 ts-small font-bold tracking-wide text-(--ts-bid)">
        BID MATCH
      </p>
      <h4 id={headingId} className="mt-2 ts-body font-semibold">
        {label} became a share of {nomineeName}
      </h4>
      <p className="mt-1 ts-body text-(--ts-ink2)">
        {clubName} matched a bid for {nomineeName} at pick {match.selectionNumber} in{' '}
        {match.draftYear}.{' '}
        {price === null
          ? 'Their next pick paid for him.'
          : `The price was ${formatPoints(price)} points, paid with ${match.spentPicks.length} picks.`}
      </p>

      {spent.share !== null && value.kind === 'known' ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
          <span className="ts-head font-semibold tabular-nums">{formatPav(value.pav, 2)}</span>
          <span className="ts-body text-(--ts-ink2)">
            {label}&rsquo;s share: {formatPercent(spent.share)} of {nomineeName}&rsquo;s value
          </span>
        </p>
      ) : (
        <p className="mt-3 ts-body font-semibold">Value pending: the price is not known yet.</p>
      )}

      {price !== null ? (
        <div aria-hidden="true" className="mt-3 flex h-4 overflow-hidden rounded bg-(--ts-bg2)">
          {match.spentPicks.map((pick, index) => (
            <span
              key={pick.nativePickId}
              className={`h-full border-r-2 border-(--ts-surface) ${
                index === spentIndex ? 'bg-(--ts-accent)' : 'bg-(--ts-bar)'
              }`}
              style={{ width: `${((pick.countedPoints ?? 0) / price) * 100}%` }}
            />
          ))}
        </div>
      ) : null}

      <table className="mt-3 w-full ts-body">
        <caption className="sr-only">
          Points each pick covered of the price, and its share of {nomineeName}
        </caption>
        <thead>
          <tr className="text-left ts-small text-(--ts-muted)">
            <th scope="col" className="py-1 font-medium">
              Pick
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Points covered
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {match.spentPicks.map((pick, index) => (
            <tr
              key={pick.nativePickId}
              className={`border-t border-(--ts-line) ${index === spentIndex ? 'font-semibold' : ''}`}
              aria-current={index === spentIndex ? 'true' : undefined}
            >
              <th scope="row" className="py-1.5 text-left font-[inherit]">
                {pick.label}
                {index === spentIndex ? ' (this pick)' : ''}
                {pick.use === 'partial' ? ' · part used' : ''}
              </th>
              <td className="py-1.5 text-right tabular-nums">
                {pick.countedPoints === null ? '—' : formatPoints(pick.countedPoints)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {pick.share === null ? '—' : formatPercent(pick.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {leftover !== null ? (
        <p className="mt-2 ts-body text-(--ts-ink2)">
          {match.spentPicks.find(({ nativePickId }) => nativePickId === leftover.spentNativePickId)
            ?.label ?? 'The last pick'}{' '}
          had {formatPoints(leftover.remainderPoints)} points left over.
          {leftoverLabels.length > 0
            ? ` They became ${leftoverLabels.map(inSentence).join(' and ')}.`
            : ''}
        </p>
      ) : null}
    </article>
  );
}
