import Link from 'next/link';

import './tradeStory.css';

import { ClubBadge } from './ClubBadge';
import { TradeDetails } from './TradeDetails';
import { TradeLineage } from './TradeLineage';
import { TradePlayerCards } from './TradePlayerCards';
import { TradeScarf } from './TradeScarf';
import { TradeValueLine } from './TradeValueLine';
import {
  bidSharesByPickId,
  checkpointText,
  inSentence,
  netText,
  netTone,
  storyClubNames,
  tradeName,
  type AflTradePageModel,
} from './tradePageModel';

/**
 * "Geelong are ahead so far" on this trade alone (owner, 2026-10-21), or "Level so far" when the top
 * two nets read the same to one decimal, as the chips show them. The chain's nets are secondary and
 * never set the headline.
 */
export function headline(model: AflTradePageModel): string {
  const nets = [...model.story.nets.tradeAlone].sort((left, right) => right.net - left.net);
  const [first, second] = nets;
  const shown = (net: number) => Number(net.toFixed(1));
  if (!first || (second && shown(first.net) === shown(second.net))) return 'Level so far';
  return `${first.clubName} are ahead so far`;
}

/**
 * The private trade page (statlyaus/Statly#789): values, not letter grades. A scarf timeline, the
 * trade's details and players, and the lineage map. Realized values are publication-prohibited, so
 * only the local private reader renders this; public pages never import it.
 */
export function AflTradeStoryPage({ model }: { model: AflTradePageModel }) {
  const { story, throughSeason, bidMatches } = model;
  const clubNames = storyClubNames(story);
  const shares = bidSharesByPickId(bidMatches);
  const pendingNow = [...story.nets.tradeAlone, ...story.nets.withNextMoves].some(
    ({ pendingCount }) => pendingCount > 0
  );
  // The at-trade view is starred too when a leg's at-trade value is not in yet.
  const pendingAtTrade = story.nets.tradeAlone.some(({ atTrade }) => atTrade.pendingCount > 0);

  return (
    <div className="afl-trade-story min-h-screen">
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-16 sm:px-6">
        <p className="mb-4 rounded-lg border border-(--ts-line) bg-(--ts-bg2) px-3 py-2 ts-body">
          <b>Private page.</b> Not for publication. {model.source.label}.
        </p>
        <nav aria-label="Breadcrumb" className="mb-3 ts-small text-(--ts-ink2)">
          <Link href="/dev/afl-trade-stories" className="underline underline-offset-2">
            Private trades
          </Link>{' '}
          / {story.trade.year} / {tradeName(story.trade.clubs)}
        </nav>

        <header>
          <h1 className="ts-head max-w-[24ch] font-semibold text-balance">{headline(model)}</h1>
          <p className="mt-1 ts-body text-(--ts-ink2)">
            {tradeName(story.trade.clubs)} trade, {story.trade.year}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2.5" aria-label="Each club’s net on this trade">
            {story.nets.tradeAlone.map((net) => (
              <li
                key={net.clubId}
                className="flex items-center gap-2.5 rounded-xl border border-(--ts-line) bg-(--ts-surface) px-3.5 py-2"
              >
                <ClubBadge clubName={net.clubName} named />
                <b className={`ts-net font-semibold tabular-nums ${netTone(net.net)}`}>
                  {netText(net)}
                </b>
                <span className="ts-small text-(--ts-ink2)">{net.clubName}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 grid gap-1.5" aria-label="What each club gave">
            {story.sides.map((side) => (
              <li key={side.clubId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ClubBadge clubName={side.clubName} named />
                <b className="font-semibold">{side.clubName} gave</b>
                <span>{side.gave.map(({ label }) => inSentence(label)).join(', ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[68ch] text-(--ts-ink2)">
            Values are PAV (Player Approximate Value) value lines at{' '}
            {checkpointText(story.checkpoint)}: what each player has given the club that drafted or
            traded for him, plus what a stint still open is expected to add. A pick whose draft is
            to come is valued at its slot.
          </p>
        </header>

        <div className="mt-6">
          <TradeScarf story={story} throughSeason={throughSeason} />
        </div>

        {/* Keyed by trade: a client navigation to another trade starts at its latest point. */}
        <TradeValueLine key={story.trade.id} story={story} />
        <TradeDetails story={story} clubNames={clubNames} shares={shares} />
        <TradePlayerCards story={story} clubNames={clubNames} shares={shares} />
        <TradeLineage story={story} bidMatches={bidMatches} />

        <footer className="mt-10 max-w-[80ch] space-y-1 ts-small text-(--ts-ink2)">
          <p>
            PAV (Player Approximate Value): what each player has given the club that drafted or
            traded for him to {throughSeason}, plus what an open stint is expected to add. A pick
            used to match a bid is worth its share of the player.
          </p>
          {pendingNow ? (
            <p>* Totals leave out values not in yet, so they will move.</p>
          ) : pendingAtTrade ? (
            <p>* Totals leave out values not in yet.</p>
          ) : null}
          <p>Players still at their club: values will move. Club colours only, no club marks.</p>
        </footer>
      </main>
    </div>
  );
}
