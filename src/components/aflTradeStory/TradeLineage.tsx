'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { Connector, Outcome, TradeButton } from './LineageParts';
import { LineageTradePanel, panelId } from './LineageTradePanel';
import {
  bidShareOf,
  bidSharesByPickId,
  knownPav,
  storyClubNames,
  tradeHash,
  tradeIdFromHash,
  tradeName,
  tradeShortName,
  type AflTradePageBidMatch,
} from './tradePageModel';

/** Where an open trade shows: under the row that opened it, or under the trade list. */
interface OpenTrade {
  readonly tradeId: string;
  readonly anchor: string;
  /** The control that opened it, so closing returns focus there. */
  readonly triggerKey: string | null;
}

const LIST_ANCHOR = 'list';

/**
 * The lineage map: each asset of the trade, followed through every later trade to the player it
 * became. Any trade opens inside the map, with its own hash (`#trade=<id>`) and a link to its page.
 */
export function TradeLineage({
  story,
  bidMatches,
}: {
  story: AflTradeStory;
  bidMatches: readonly AflTradePageBidMatch[];
}) {
  const clubNames = useMemo(() => storyClubNames(story), [story]);
  const shares = useMemo(() => bidSharesByPickId(bidMatches), [bidMatches]);
  const trades = useMemo(
    () => new Map(story.lineage.trades.map((trade) => [trade.tradeId, trade])),
    [story]
  );
  const maxValue = Math.max(0, ...story.lineage.assets.map(({ value }) => knownPav(value) ?? 0));
  const [open, setOpen] = useState<OpenTrade | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const focusTarget = useRef<'panel' | string | null>(null);

  /** The first row a trade appears in, so a linked trade opens where it sits in the map. */
  const anchorFor = useCallback(
    (tradeId: string) =>
      story.lineage.assets.find(({ hops }) =>
        hops.some((hop) => hop.tradeId === tradeId && hop.relation !== 'this')
      )?.transferId ?? LIST_ANCHOR,
    [story]
  );

  const show = useCallback((next: OpenTrade | null) => {
    setOpen((current) => {
      focusTarget.current = next ? 'panel' : (current?.triggerKey ?? null);
      return next;
    });
    const url = `${window.location.pathname}${window.location.search}${next ? tradeHash(next.tradeId) : ''}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const toggle = (tradeId: string, anchor: string, triggerKey: string) =>
    show(
      open?.tradeId === tradeId && open.anchor === anchor ? null : { tradeId, anchor, triggerKey }
    );

  // Before the hash effect, so a trade a hash opens on load takes focus on the next render.
  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'panel' && headingRef.current) {
      headingRef.current.focus({ preventScroll: true });
      headingRef.current.scrollIntoView({ block: 'nearest' });
    } else if (target) triggers.current.get(target)?.focus();
  }, [open]);

  useEffect(() => {
    const fromHash = () => {
      const tradeId = tradeIdFromHash(window.location.hash);
      if (tradeId === null || !trades.has(tradeId)) return;
      focusTarget.current = 'panel';
      setOpen({ tradeId, anchor: anchorFor(tradeId), triggerKey: null });
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [anchorFor, trades]);

  const panel = (anchor: string) => {
    if (open?.anchor !== anchor) return null;
    const trade = trades.get(open.tradeId);
    return trade ? (
      <LineageTradePanel
        trade={trade}
        isThisTrade={trade.tradeId === story.trade.id}
        clubNames={clubNames}
        shares={shares}
        headingRef={headingRef}
        onClose={() => show(null)}
      />
    ) : null;
  };

  /** A trade's button; a trade the lineage does not list (an earlier one) is plain text. */
  const tradeButton = (tradeId: string, anchor: string, label: string) => {
    const trade = trades.get(tradeId);
    if (!trade) return <span className="ts-body text-(--ts-ink2)">{label}</span>;
    const key = `${anchor}|${tradeId}`;
    return (
      <TradeButton
        label={label}
        name={`${tradeName(trade.clubs)}, ${trade.year}`}
        open={open?.tradeId === tradeId && open.anchor === anchor}
        controls={panelId(tradeId)}
        onToggle={() => toggle(tradeId, anchor, key)}
        buttonRef={(element) => {
          if (element) triggers.current.set(key, element);
          else triggers.current.delete(key);
        }}
      />
    );
  };

  const groups = story.trade.clubs.map((club, index) => ({
    club,
    tint: index % 2 === 0 ? 'bg-(--ts-group-a)' : 'bg-(--ts-group-b)',
    assets: story.lineage.assets.filter(
      ({ hops }) => hops.find(({ relation }) => relation === 'this')?.clubId === club.clubId
    ),
  }));

  return (
    <section aria-labelledby="lineage-title" className="mt-12">
      <h2 id="lineage-title" className="ts-head font-semibold">
        Lineage
      </h2>
      <p className="mt-1 text-(--ts-ink2)">
        Every asset from the trade, followed to the player it became. Open any{' '}
        <span aria-hidden="true">⇄</span>
        <span className="sr-only">trade button</span> to see that trade here.
      </p>
      <div className="mt-4 rounded-2xl border border-(--ts-line) bg-(--ts-surface) p-3 sm:p-4">
        <ul
          className="mb-3 flex flex-wrap gap-x-5 gap-y-1 ts-small text-(--ts-ink2)"
          aria-label="Key"
        >
          <li className="flex items-center gap-1.5">
            <Connector /> held by the club
          </li>
          <li className="flex items-center gap-1.5">
            <Connector dashed /> after it left the club
          </li>
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-8 rounded-full border-2 border-(--ts-accent) bg-(--ts-accent)/30"
            />
            bar length is PAV
          </li>
        </ul>
        {groups.map(({ club, tint, assets }) => (
          <div key={club.clubId} className={`mt-3 rounded-xl p-3 sm:p-4 ${tint}`}>
            <h3 className="flex items-center gap-2 ts-body font-semibold">
              <ClubBadge clubName={club.clubName} size="md" named />
              {club.clubName} received
            </h3>
            <ul className="mt-2">
              {assets.map((asset) => {
                const before = asset.hops.filter(({ relation }) => relation === 'before');
                const after = asset.hops.filter(({ relation }) => relation === 'after');
                const share = bidShareOf(asset, shares);
                return (
                  <li
                    key={asset.transferId}
                    className="border-t border-(--ts-line) py-3 first:border-t-0"
                  >
                    <div className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
                      <p className="ts-body font-medium">{asset.label}</p>
                      <div className="flex flex-wrap items-center gap-y-2">
                        {before.map((hop) => (
                          <Fragment key={`before-${hop.tradeId}`}>
                            {tradeButton(hop.tradeId, asset.transferId, `via ${hop.year}`)}
                            <Connector dashed />
                          </Fragment>
                        ))}
                        <span
                          aria-hidden="true"
                          className="size-3 flex-none rounded-sm border-2 border-(--ts-accent) bg-(--ts-surface)"
                        />
                        {after.map((hop) => (
                          <Fragment key={`after-${hop.tradeId}`}>
                            <Connector />
                            {tradeButton(
                              hop.tradeId,
                              asset.transferId,
                              `⇄ ${tradeShortName([hop])} ${hop.year}`
                            )}
                          </Fragment>
                        ))}
                        <Connector
                          dashed={
                            asset.outcome.kind === 'player' && asset.outcome.clubId !== club.clubId
                          }
                        />
                        <Outcome
                          asset={asset}
                          groupClubId={club.clubId}
                          maxValue={maxValue}
                          share={share}
                        />
                      </div>
                    </div>
                    {panel(asset.transferId)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="mt-4">
          <h3 className="ts-small font-medium text-(--ts-ink2)">Trades in this lineage</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {story.lineage.trades.map((trade) => (
              <li key={trade.tradeId}>
                {tradeButton(
                  trade.tradeId,
                  LIST_ANCHOR,
                  `${tradeShortName(trade.clubs)} ${trade.year}${trade.tradeId === story.trade.id ? ' · this trade' : ''}`
                )}
              </li>
            ))}
          </ul>
          {panel(LIST_ANCHOR)}
        </div>
      </div>
    </section>
  );
}
