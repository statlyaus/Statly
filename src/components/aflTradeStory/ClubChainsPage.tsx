import Link from 'next/link';

import type { AflTradeClubChainsModel } from '@/server/aflTradeIntelligence/development/tradeStorySamples';
import type { AflTradeClubChainTrade } from '@/server/aflTradeIntelligence/valuation/clubTradeChains';

import './tradeStory.css';
import { ClubBadge } from './ClubBadge';
import { formatSigned, netTone, tradeStoryHref } from './tradePageModel';

const signed = (net: number, provisional: boolean) =>
  `${formatSigned(net)}${provisional ? '*' : ''}`;

function TradeRow({ trade }: { trade: AflTradeClubChainTrade }) {
  return (
    <li>
      <Link
        href={tradeStoryHref(trade.tradeId)}
        className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 ts-body hover:bg-(--ts-bg2)"
      >
        <span>
          <span className="text-(--ts-ink2)">{trade.year}</span>{' '}
          <span className="font-medium">with {trade.withClubs.join(', ')}</span>
        </span>
        <span className={`font-semibold tabular-nums ${netTone(trade.net)}`}>
          {signed(trade.net, trade.provisional)}
        </span>
      </Link>
    </li>
  );
}

/**
 * Every chain of one club (#1051): trades linked by a pick the club received and traded on, each
 * trade's own net and the chain's sum. Private reader only.
 */
export function ClubChainsPage({ model }: { model: AflTradeClubChainsModel }) {
  const { chains } = model;
  const club = chains.clubName;
  return (
    <div className="afl-trade-story min-h-screen">
      <main className="mx-auto w-full max-w-3xl px-4 pt-5 pb-16 sm:px-6">
        <p className="mb-4 rounded-lg border border-(--ts-line) bg-(--ts-bg2) px-3 py-2 ts-body">
          <b>Private page.</b> Not for publication. {model.source.label}.
        </p>
        <nav aria-label="Breadcrumb" className="mb-3 ts-small text-(--ts-ink2)">
          <Link href="/dev/afl-trade-stories" className="underline underline-offset-2">
            Private trades
          </Link>{' '}
          / {club}
        </nav>
        <header className="flex items-center gap-3">
          <ClubBadge clubName={club} />
          <h1 className="ts-head font-semibold">{club}: trade chains</h1>
        </header>
        <p className="mt-2 ts-body text-(--ts-ink2)">
          Trades linked by a pick {club} received and traded on. A chain&apos;s total is the sum of
          its trades&apos; own results for {club}, in PAV to {chains.throughSeason}. Players never
          link trades: each trade values a player at the club that received him.
        </p>

        <section aria-labelledby="chains-heading" className="mt-8">
          <h2 id="chains-heading" className="ts-head font-semibold">
            {chains.chains.length} chain{chains.chains.length === 1 ? '' : 's'}
          </h2>
          {chains.chains.length === 0 ? (
            <p className="mt-2 ts-body text-(--ts-ink2)">No two of these trades share a pick.</p>
          ) : (
            <ol className="mt-3 space-y-4">
              {chains.chains.map((chain) => (
                <li
                  key={chain.trades[0]!.tradeId}
                  className="rounded-xl border border-(--ts-line) bg-(--ts-surface)"
                >
                  <div className="flex items-center justify-between gap-4 border-b border-(--ts-line) px-4 py-3">
                    <span className="ts-body font-medium">
                      {chain.trades.length} trades, {chain.trades[0]!.year}–
                      {chain.trades.at(-1)!.year}
                    </span>
                    <b className={`ts-head font-semibold tabular-nums ${netTone(chain.net)}`}>
                      {signed(chain.net, chain.provisional)}
                    </b>
                  </div>
                  <ul className="divide-y divide-(--ts-line)">
                    {chain.trades.map((trade) => (
                      <TradeRow key={trade.tradeId} trade={trade} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="standalone-heading" className="mt-8">
          <h2 id="standalone-heading" className="ts-head font-semibold">
            {chains.standalone.length} trade{chains.standalone.length === 1 ? '' : 's'} on their own
          </h2>
          <ul className="mt-3 divide-y divide-(--ts-line) rounded-xl border border-(--ts-line) bg-(--ts-surface)">
            {chains.standalone.map((trade) => (
              <TradeRow key={trade.tradeId} trade={trade} />
            ))}
          </ul>
        </section>
        <p className="mt-6 ts-small text-(--ts-ink2)">
          * Provisional: a pick in the trade has no value yet, so the total leaves it out and will
          move.
        </p>
      </main>
    </div>
  );
}
