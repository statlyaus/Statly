import Link from 'next/link';

import type { AflTradeClubChainsModel } from '@/server/aflTradeIntelligence/development/tradeStorySamples';
import type { AflTradeClubChainTrade } from '@/server/aflTradeIntelligence/valuation/clubTradeChains';

import './tradeStory.css';
import { ClubBadge } from './ClubBadge';
import { TradePageNotice } from './TradePageNotice';
import {
  formatSigned,
  tradeStoriesHref,
  tradeStoryHref,
  type AflTradePageAudience,
} from './tradePageModel';

const signed = (net: number, provisional: boolean, projected: boolean) =>
  `${formatSigned(net)}${provisional ? '*' : ''}${projected ? ' projected' : ''}`;

function TradeRow({
  trade,
  audience,
}: {
  trade: AflTradeClubChainTrade;
  audience?: AflTradePageAudience;
}) {
  return (
    <li>
      <Link
        href={tradeStoryHref(trade.tradeId, audience)}
        className="ts-inset-focus flex min-h-11 items-center justify-between gap-4 px-4 py-2 ts-body hover:bg-muted"
      >
        <span>
          <span className="text-muted-foreground">{trade.year}</span>{' '}
          <span className="font-medium">with {trade.withClubs.join(', ')}</span>
        </span>
        <span className="font-semibold tabular-nums text-foreground">
          {signed(trade.net, trade.provisional, trade.projected)}
        </span>
      </Link>
    </li>
  );
}

/**
 * Every chain of one club (#1051): trades linked by a pick the club received and traded on, each
 * trade's own net and the chain's sum. Private unless the model's source says public.
 */
export function ClubChainsPage({ model }: { model: AflTradeClubChainsModel }) {
  const { chains } = model;
  const club = chains.clubName;
  const audience = model.source.audience;
  // The public layout already provides the page's <main>.
  const Shell = audience === 'public' ? 'div' : 'main';
  return (
    <div className="afl-trade-story min-h-screen" data-surface="paper">
      <Shell className="mx-auto w-full max-w-3xl px-4 pt-5 pb-16 sm:px-6">
        <TradePageNotice source={model.source} />
        <nav aria-label="Breadcrumb" className="mb-3 ts-small text-muted-foreground">
          <Link href={tradeStoriesHref(audience)} className="underline underline-offset-2">
            {audience === 'public' ? 'AFL trades' : 'Private trades'}
          </Link>{' '}
          / {club}
        </nav>
        <header className="flex items-center gap-3">
          <ClubBadge clubName={club} />
          <h1
            className={
              audience === 'public' ? 'ts-net font-display font-bold' : 'ts-head font-semibold'
            }
          >
            {club}: trade chains
          </h1>
        </header>
        <p className="mt-2 ts-body text-muted-foreground">
          Trades linked by a pick {club} received and traded on. A chain&apos;s total is the sum of
          its trades&apos; own results for {club}, in PAV to {chains.throughSeason}. Players never
          link trades: each trade values a player at the club that received him. A projected result
          has had no season played since its trade.
        </p>

        <section aria-labelledby="chains-heading" className="mt-8">
          <h2 id="chains-heading" className="ts-head font-semibold">
            {chains.chains.length} chain{chains.chains.length === 1 ? '' : 's'}
          </h2>
          {chains.chains.length === 0 ? (
            <p className="mt-2 ts-body text-muted-foreground">
              No two of these trades share a pick.
            </p>
          ) : (
            <ol className="mt-3 space-y-4">
              {chains.chains.map((chain) => (
                <li key={chain.trades[0]!.tradeId} className="border border-border bg-card">
                  <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
                    <span className="ts-body font-medium">
                      {chain.trades.length} trades, {chain.trades[0]!.year}–
                      {chain.trades.at(-1)!.year}
                    </span>
                    <b className="ts-head font-semibold tabular-nums text-foreground">
                      {signed(chain.net, chain.provisional, chain.projected)}
                    </b>
                  </div>
                  <ul className="divide-y divide-border">
                    {chain.trades.map((trade) => (
                      <TradeRow audience={audience} key={trade.tradeId} trade={trade} />
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
          <ul className="mt-3 divide-y divide-border border border-border bg-card">
            {chains.standalone.map((trade) => (
              <TradeRow audience={audience} key={trade.tradeId} trade={trade} />
            ))}
          </ul>
        </section>
        <p className="mt-6 ts-small text-muted-foreground">
          * Provisional: a pick in the trade has no value yet, so the total leaves it out and will
          move.
        </p>
      </Shell>
    </div>
  );
}
