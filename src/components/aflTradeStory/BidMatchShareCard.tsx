import type {
  AflTradeStory,
  AflTradeStoryValue,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  bidPriceText,
  formatPav,
  formatPercent,
  formatPoints,
  inSentence,
  leftoverPlayersOf,
  nameList,
  type AflTradePageBidShare,
} from './tradePageModel';

export const bidShareAnchor = (assetId: string) =>
  `bid-${assetId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;

/**
 * The card's own pick in the table. When the pick was traded as one number and spent as another on
 * draft night, the row says both, so it reads as the same pick as the heading: "Pick 13 on the night
 * (traded as pick 12)".
 */
function ownRowLabel(label: string, spent: { label: string; asPick?: number }): string {
  const traded = /\bpick (\d+)\b/iu.exec(label)?.[1];
  return spent.asPick !== undefined && traded !== undefined && Number(traded) !== spent.asPick
    ? `Pick ${spent.asPick} on the night (traded as pick ${traded}) · this pick`
    : `${spent.label} (this pick)`;
}

/**
 * A pick spent matching a bid, shown as a swap: the pick bought a share of the nominee, in
 * proportion to the points it covered of the AFL price. The price, points and shares come from the
 * asset ledger; the pick's value is its value line (the share of the nominee's line). A nominee who
 * has not played a season yet is valued from his draft slot, so his value reads as projected, as an
 * unplayed draftee's does. A shortfall the club owes is charged to its next first-round pick.
 */
export function BidMatchShareCard({
  assetId,
  label,
  share,
  value,
  checkpoint,
}: {
  assetId: string;
  label: string;
  share: AflTradePageBidShare;
  /** The pick's value line at the story's checkpoint. */
  value: AflTradeStoryValue;
  /** The story's checkpoint: before the end of the season after the draft, the nominee is unplayed. */
  checkpoint: AflTradeStory['checkpoint'];
}) {
  const { bid, spentIndex } = share;
  const { match, nomineeName, clubName, leftoverLabels } = bid;
  const spent = match.spentPicks[spentIndex]!;
  const price = match.pricing.status === 'shared' ? match.pricing.pricePoints : null;
  const leftover = match.pricing.status === 'shared' ? match.pricing.leftover : null;
  const deficit = match.pricing.status === 'shared' ? match.pricing.deficit : null;
  const short =
    deficit !== null && deficit.points !== null && deficit.against === 'next_draft_first_pick'
      ? deficit.points
      : null;
  const projected = checkpoint.season <= match.draftYear;
  const headingId = `${bidShareAnchor(assetId)}-title`;
  // The players this pick also carries through the bid's leftover pick (2026-11-26).
  const carried = leftoverPlayersOf(share);
  const carriedText = carried
    .map(({ name, whole }) => (whole ? `all of ${name}\u2019s` : `a share of ${name}\u2019s`))
    .join(' and ');
  const unplayed = [nomineeName, ...carried.map(({ name }) => name)];

  return (
    <article
      id={bidShareAnchor(assetId)}
      aria-labelledby={headingId}
      className="scroll-mt-6 border border-border bg-card p-4"
    >
      <p className="inline-flex rounded-md border border-current bg-muted px-2 py-0.5 ts-small font-bold tracking-wide text-warning-text">
        BID MATCH
      </p>
      <h4 id={headingId} className="mt-2 ts-body font-semibold">
        {label} became a share of {nomineeName}
      </h4>
      <p className="mt-1 ts-body text-muted-foreground">
        {clubName} matched a bid for {nomineeName} at pick {match.selectionNumber} in{' '}
        {match.draftYear}. {bidPriceText(bid)}
      </p>

      {short !== null ? (
        <p className="mt-1 ts-body text-muted-foreground">
          {clubName} were {formatPoints(short)} points short. Those points come off their
          first-round pick in the {match.draftYear + 1} draft.
        </p>
      ) : null}

      {spent.share !== null && value.kind === 'known' ? (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="ts-head font-semibold tabular-nums">{formatPav(value.pav, 2)}</span>
            <span className="ts-body text-muted-foreground">
              {label}&rsquo;s share: {formatPercent(spent.share)} of {nomineeName}&rsquo;s{' '}
              {projected ? 'projected value' : 'value'}
              {carriedText === '' ? '' : `, plus ${carriedText}`}
            </span>
          </p>
          {projected ? (
            <p className="mt-1 ts-small text-muted-foreground">
              {unplayed.length === 1
                ? `${nomineeName} has not played a season yet, so his value is projected from pick ${match.selectionNumber}.`
                : `${nameList(unplayed)} have not played a season yet, so their values are projected from their draft picks.`}
            </p>
          ) : null}
        </>
      ) : spent.share !== null ? (
        <p className="mt-3 ts-body font-semibold">
          {label}&rsquo;s share is {formatPercent(spent.share)} of {nomineeName}. His value is not
          in yet.
        </p>
      ) : (
        <p className="mt-3 ts-body font-semibold">
          This bid has no price yet, so the pick&rsquo;s share is not in yet.
        </p>
      )}

      {price !== null ? (
        <div aria-hidden="true" className="mt-3 flex h-4 overflow-hidden bg-muted">
          {match.spentPicks.map((pick, index) => (
            <span
              key={pick.nativePickId}
              className={`h-full border-r-2 border-card ${
                index === spentIndex ? 'bg-primary' : 'bg-border'
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
          <tr className="text-left ts-small text-muted-foreground">
            <th scope="col" className="py-1 font-medium">
              Pick
            </th>
            <th scope="col" className="py-1 pl-4 text-right font-medium">
              Points covered
            </th>
            <th scope="col" className="py-1 pl-4 text-right font-medium">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {match.spentPicks.map((pick, index) => (
            <tr
              key={pick.nativePickId}
              className={`border-t border-border ${index === spentIndex ? 'font-semibold' : ''}`}
              aria-current={index === spentIndex ? 'true' : undefined}
            >
              <th scope="row" className="py-1.5 pr-2 text-left font-[inherit]">
                {index === spentIndex ? ownRowLabel(label, pick) : pick.label}
                {pick.use === 'partial' ? ' · part used' : ''}
              </th>
              <td className="whitespace-nowrap py-1.5 pl-4 text-right tabular-nums">
                {pick.countedPoints === null ? '—' : formatPoints(pick.countedPoints)}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-4 text-right tabular-nums">
                {pick.share === null ? '—' : formatPercent(pick.share)}
              </td>
            </tr>
          ))}
          {short !== null && price !== null ? (
            <tr className="border-t border-border text-muted-foreground">
              <th scope="row" className="py-1.5 pr-2 text-left font-[inherit]">
                Points short (off the {match.draftYear + 1} first-round pick)
              </th>
              <td className="whitespace-nowrap py-1.5 pl-4 text-right tabular-nums">
                {formatPoints(short)}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-4 text-right tabular-nums">
                {formatPercent(short / price)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {leftover !== null ? (
        <p className="mt-2 ts-body text-muted-foreground">
          {match.spentPicks.find(({ nativePickId }) => nativePickId === leftover.spentNativePickId)
            ?.label ?? 'The last pick'}{' '}
          had {formatPoints(leftover.remainderPoints)} points left over
          {leftoverLabels.length > 0
            ? `, which became ${leftoverLabels.map(inSentence).join(' and ')}.`
            : '.'}
        </p>
      ) : null}
    </article>
  );
}
