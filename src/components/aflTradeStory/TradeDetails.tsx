import type {
  AflTradeStory,
  AflTradeStoryAsset,
  AflTradeStoryNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { AssetValue } from './AssetValue';
import { BidMatchShareCard, bidShareAnchor } from './BidMatchShareCard';
import { ClubBadge } from './ClubBadge';
import {
  becameText,
  bidShareOf,
  formatPav,
  formatSigned,
  netText,
  netTone,
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
  const { outcome } = asset;
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-(--ts-line) py-2 ts-body">
      <span className="font-medium">
        {asset.label}
        {showTo ? (
          <span className="font-normal text-(--ts-ink2)"> to {clubNames.get(asset.toClubId)}</span>
        ) : null}
      </span>

      <span className="text-(--ts-ink2)">
        {becameText(asset, clubNames)}
        {outcome.kind === 'bid_share' ? (
          <>
            {' · '}
            {share ? (
              <a
                href={`#${bidShareAnchor(asset.assetId)}`}
                className="text-(--ts-accent) underline underline-offset-2"
              >
                share of {outcome.playerName}
              </a>
            ) : (
              `share of ${outcome.playerName}`
            )}
          </>
        ) : null}
        {' · at the trade '}
        <AssetValue asset={asset} view="atTrade" />
      </span>
      <span className="col-start-2 row-span-2 row-start-1 self-center text-right font-semibold tabular-nums">
        <AssetValue asset={asset} />
      </span>
    </li>
  );
}

function NetRow({ net, note }: { net: AflTradeStoryNet; note?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <ClubBadge clubName={net.clubName} />
      <span className={`ts-head font-semibold tabular-nums ${netTone(net.net)}`}>
        {netText(net)}
      </span>
      {note ? <span className="ts-small text-(--ts-ink2)">{note}</span> : null}
    </li>
  );
}

/**
 * Trade details: what each club gave, what every asset became, and each club's net on this trade
 * with its at-trade view beside it (never subtracted). The chain net is secondary.
 */
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
      label: player.acquired.label,
    })),
  ]
    .flatMap(({ assetId, label, value, outcome }) => {
      const share = bidShareOf({ assetId, outcome }, shares);
      return share ? [{ assetId, label, share, value }] : [];
    })
    .filter(
      (item, index, all) => all.findIndex(({ assetId }) => assetId === item.assetId) === index
    );

  return (
    <section aria-labelledby="details-title" className="mt-12">
      <h2 id="details-title" className="ts-head font-semibold">
        Trade details
      </h2>
      <p className="mt-1 text-(--ts-ink2)">
        What each club gave, what every asset became, and its value at the trade.
      </p>

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
              <p className="flex justify-between border-t border-(--ts-line) pt-2 ts-body">
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
          <h3 className="ts-small font-medium text-(--ts-ink2)">On this trade alone</h3>
          <ul className="mt-1">
            {story.nets.tradeAlone.map((net) => (
              <NetRow key={net.clubId} net={net} note={`at the trade ${netText(net.atTrade)}`} />
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-(--ts-line) p-4">
          <h3 className="ts-small font-medium text-(--ts-ink2)">With what each club did next</h3>
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
          <h3 className="ts-body font-semibold">Picks used to match a bid</h3>
          <p className="mt-1 ts-body text-(--ts-ink2)">
            A pick spent on a bid is swapped for a share of the player, by the points it covered.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {bidAssets.map(({ assetId, label, share, value }) => (
              <BidMatchShareCard
                key={assetId}
                assetId={assetId}
                label={label}
                share={share}
                value={value}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
