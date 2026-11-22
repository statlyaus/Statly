import Link from 'next/link';

import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import { buttonStyles } from '@/components/ui/controlStyles';

import { ClubBadge } from './ClubBadge';
import { TradeTree } from './TradeTree';
import {
  checkpointText,
  formatSigned,
  headline,
  netText,
  tradeStoryHref,
  type AflTradePageModel,
} from './tradePageModel';
import { clubSlug, tradesListHref, type TradesListQuery } from './tradesListQuery';
import { clubTotals, rowSides, samePlayerTrades } from './tradesPreviewModel';

const label = 'font-display ts-small font-bold tracking-[0.1em] text-muted-foreground uppercase';
const nextRow =
  'flex min-h-11 flex-wrap items-center gap-x-3 border-b border-border py-2 font-display ts-body font-semibold text-primary underline-offset-4 hover:underline';
const nextMeta =
  'w-full font-sans sm:ml-auto sm:w-auto sm:text-right ts-small font-normal text-muted-foreground tabular-nums';

/** One "Where next" link: a label, the link's words and a figure to its right. */
function NextLink({
  href,
  tag,
  meta,
  children,
}: {
  href: string;
  tag: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} prefetch={false} className={nextRow}>
        <span className={`${label} w-24 flex-none`}>{tag}</span>
        <span>{children}</span>
        <span className={nextMeta}>{meta}</span>
      </Link>
    </li>
  );
}

/**
 * The trade open beside the list (owner, 2026-11-22): its headline and nets, the trade tree in its
 * compact layout, then where to go next. Every link stays a plain address, so it works without
 * scripts and never prefetches (Netlify credits, #1385).
 */
export function TradePreview({
  model,
  stories,
  query,
}: {
  model: AflTradePageModel;
  stories: readonly AflTradeStorySampleSummary[];
  query: TradesListQuery;
}) {
  const { story } = model;
  const summary = stories.find(({ tradeId }) => tradeId === story.trade.id);
  const samePlayer = summary ? samePlayerTrades(stories, summary).slice(0, 2) : [];
  // The lineage lists this trade too.
  const linked = story.lineage.trades.length - 1;

  return (
    <section
      id="trade-preview"
      aria-labelledby="trade-preview-title"
      className="grid gap-6 border border-border bg-card p-6"
    >
      <div>
        <p className={label}>{story.trade.year} trade</p>
        <h2 id="trade-preview-title" className="mt-1 ts-head font-semibold text-balance">
          {headline(model)}
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Each club’s net on this trade">
          {story.nets.tradeAlone.map((net) => (
            <li key={net.clubId} className="flex items-center gap-3 border border-border px-3 py-2">
              <ClubBadge clubName={net.clubName} />
              <b className="font-display ts-net leading-none font-black tracking-tight tabular-nums">
                {netText(net)}
              </b>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-display ts-body font-bold">Where the trade went</h3>
        <div className="mt-2">
          <TradeTree story={story} compact />
        </div>
        <p className="mt-2 ts-small text-muted-foreground">
          PAV to {checkpointText(story.checkpoint)}: what each player has given the club that got
          him, plus what an open stint is expected to add.{' '}
          <Link href="/afl/trades/method" prefetch={false} className="underline underline-offset-2">
            How trades are valued
          </Link>
        </p>
      </div>

      <nav aria-labelledby="where-next-title" className="border-t-[1.5px] border-foreground pt-3">
        <h3 id="where-next-title" className="font-display ts-body font-bold">
          Where next
        </h3>
        <ul className="mt-1">
          {samePlayer.map(({ player, story: other }) => {
            const lead = rowSides(other, null)?.lead;
            return (
              <NextLink
                key={other.tradeId}
                tag="Same player"
                href={tradesListHref({
                  year: other.year,
                  club: null,
                  sort: query.sort,
                  trade: other.tradeId,
                })}
                meta={lead ? `${lead.clubName} ${formatSigned(lead.net)}` : ''}
              >
                {player}’s {other.year} trade, {other.clubNames.join(' and ')}
              </NextLink>
            );
          })}
          {linked > 0 ? (
            <NextLink
              tag="Chain"
              href={`${tradeStoryHref(story.trade.id, 'public')}#lineage-title`}
              meta="on the trade page"
            >
              {linked} linked trade{linked === 1 ? '' : 's'}
            </NextLink>
          ) : null}
          {story.trade.clubs.map(({ clubId, clubName }) => {
            const slug = clubSlug(clubName);
            const totals = clubTotals(stories, slug);
            return (
              <NextLink
                key={clubId}
                tag="Club"
                href={tradesListHref({
                  year: null,
                  club: slug,
                  sort: query.sort,
                })}
                meta={`${totals.trades} trade${totals.trades === 1 ? '' : 's'}, ${formatSigned(totals.net)}`}
              >
                Every {clubName} trade
              </NextLink>
            );
          })}
        </ul>
        <Link
          href={tradeStoryHref(story.trade.id, 'public')}
          prefetch={false}
          className={`${buttonStyles({ variant: 'primary', size: 'md' })} mt-6`}
        >
          Open the full trade
        </Link>
      </nav>
    </section>
  );
}
