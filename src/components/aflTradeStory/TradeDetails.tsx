import type {
  AflTradeStory,
  AflTradeStoryAsset,
  AflTradeStoryNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { BidMatchShareCard, bidShareAnchor } from './BidMatchShareCard';
import { ClubBadge } from './ClubBadge';
import {
  becameText,
  bidShareOf,
  formatPav,
  formatSigned,
  netText,
  type AflTradePageBidShare,
} from './tradePageModel';

type Shares = ReadonlyMap<string, AflTradePageBidShare>;

function AssetRow({
  asset,
  clubNames,
  shares,
  showTo,
}: {
  asset: AflTradeStoryAsset;
  clubNames: ReadonlyMap<string, string>;
  shares: Shares;
  showTo: boolean;
}) {
  const share = bidShareOf(asset, shares);
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-(--ts-line) py-2 text-sm">
      <span className="font-medium">
        {asset.label}
        {showTo ? (
          <span className="font-normal text-(--ts-ink2)"> to {clubNames.get(asset.toClubId)}</span>
        ) : null}
      </span>

      <span className="text-(--ts-ink2)">
        {becameText(asset, clubNames)}
        {share ? (
          <>
            {' · '}
            <a
              href={`#${bidShareAnchor(asset.assetId)}`}
              className="text-(--ts-accent) underline underline-offset-2"
            >
              see its share of {share.bid.nomineeName}
            </a>
          </>
        ) : null}
      </span>
      <span className="col-start-2 row-span-2 row-start-1 self-center text-right font-semibold tabular-nums">
        {asset.value.kind === 'known' ? formatPav(asset.value.pav) : 'pending'}
      </span>
    </li>
  );
}

function NetRow({ net, note }: { net: AflTradeStoryNet; note?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <ClubBadge clubName={net.clubName} />
      <span
        className={`text-lg font-semibold tabular-nums ${net.net < 0 ? 'text-(--ts-neg)' : 'text-(--ts-pos)'}`}
      >
        {netText(net)}
      </span>
      {note ? <span className="text-sm text-(--ts-ink2)">{note}</span> : null}
    </li>
  );
}

/** Trade details: what each club gave, what every asset became, and each club's net. */
export function TradeDetails({
  story,
  clubNames,
  shares,
}: {
  story: AflTradeStory;
  clubNames: ReadonlyMap<string, string>;
  shares: Shares;
}) {
  const twoClubs = story.sides.length === 2;
  const alone = new Map(story.nets.tradeAlone.map((net) => [net.clubId, net]));
  // Every pick of the story spent on a bid: the trade's own, and any a club ended up with later.
  const bidAssets = [
    ...story.sides.flatMap(({ gave }) => gave),
    ...story.players.map((player) => ({
      ...player,
      label: player.acquired.pickLabel ?? 'Pick',
    })),
  ]
    .flatMap(({ assetId, label, value }) => {
      const share = bidShareOf({ assetId, value }, shares);
      return share ? [{ assetId, label, share }] : [];
    })
    .filter(
      (item, index, all) => all.findIndex(({ assetId }) => assetId === item.assetId) === index
    );

  return (
    <section aria-labelledby="details-title" className="mt-12">
      <h2 id="details-title" className="text-2xl font-semibold">
        Trade details
      </h2>
      <p className="mt-1 text-(--ts-ink2)">What each club gave, and what every asset became.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {story.sides.map((side) => {
          const other = twoClubs
            ? story.sides.find(({ clubId }) => clubId !== side.clubId)
            : undefined;
          const given = side.gave.reduce(
            (total, asset) => total + (asset.value.kind === 'known' ? asset.value.pav : 0),
            0
          );
          const pending = side.gave.some(({ value }) => value.kind === 'pending');
          return (
            <div
              key={side.clubId}
              className="rounded-xl border border-(--ts-line) bg-(--ts-surface) p-4"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <ClubBadge clubName={side.clubName} named />
                {side.clubName} gave{other ? ` ${other.clubName}` : ''}
              </h3>
              <ul className="mt-2">
                {side.gave.map((asset) => (
                  <AssetRow
                    key={asset.transferId}
                    asset={asset}
                    clubNames={clubNames}
                    shares={shares}
                    showTo={!twoClubs}
                  />
                ))}
              </ul>
              <p className="flex justify-between border-t border-(--ts-line) pt-2 text-sm">
                <span>{other ? `${other.clubName} received` : 'Total given'}</span>
                <b className="tabular-nums">
                  {formatPav(given)}
                  {pending ? '*' : ''}
                </b>
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-(--ts-bg2) p-4">
          <h3 className="text-sm font-medium text-(--ts-ink2)">On this trade alone</h3>
          <ul className="mt-1">
            {story.nets.tradeAlone.map((net) => (
              <NetRow key={net.clubId} net={net} />
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-(--ts-bg2) p-4">
          <h3 className="text-sm font-medium text-(--ts-ink2)">With what each club did next</h3>
          <ul className="mt-1">
            {story.nets.withNextMoves.map((net) => {
              const later = net.net - (alone.get(net.clubId)?.net ?? 0);
              const trades = net.tradeIds.length - 1;
              return (
                <NetRow
                  key={net.clubId}
                  net={net}
                  note={
                    trades === 0
                      ? 'no later trade'
                      : `${formatSigned(later)} from ${trades} later trade${trades === 1 ? '' : 's'}`
                  }
                />
              );
            })}
          </ul>
        </div>
      </div>

      {bidAssets.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-lg font-semibold">Picks used to match a bid</h3>
          <p className="mt-1 text-sm text-(--ts-ink2)">
            A pick spent on a bid is swapped for a share of the player, by the points it covered.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {bidAssets.map(({ assetId, label, share }) => (
              <BidMatchShareCard key={assetId} assetId={assetId} label={label} share={share} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
