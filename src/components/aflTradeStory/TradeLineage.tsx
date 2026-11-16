'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { STORY_FONT_CLASS } from '@/components/aflStories/CameronMasthead';

import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { Connector, Outcome, TradeButton } from './LineageParts';
import { LineageTradePanel, panelId } from './LineageTradePanel';
import {
  bidShareOf,
  bidSharesByPickId,
  clubStyle,
  knownPav,
  storyClubNames,
  tradeHash,
  tradeIdFromHash,
  tradeName,
  tradeShortName,
  type AflTradePageAudience,
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
  audience,
}: {
  story: AflTradeStory;
  bidMatches: readonly AflTradePageBidMatch[];
  audience?: AflTradePageAudience;
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
        headingRef={headingRef}
        onClose={() => show(null)}
        audience={audience}
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

  const isPublic = audience === 'public';
  const groups = story.trade.clubs.map((club, index) => ({
    club,
    tint: index % 2 === 0 ? 'bg-(--ts-group-a)' : 'bg-(--ts-group-b)',
    assets: story.lineage.assets.filter(
      ({ hops }) => hops.find(({ relation }) => relation === 'this')?.clubId === club.clubId
    ),
  }));

  return (
    <section
      aria-labelledby="lineage-title"
      className={`mt-12 ${isPublic ? `lg-collage ${STORY_FONT_CLASS}` : ''}`}
    >
      <h2 id="lineage-title" className="ts-head font-semibold">
        {isPublic ? 'Where everything went' : 'Lineage'}
      </h2>
      <p className="mt-1 max-w-[70ch] text-(--ts-ink2)">
        Every player and pick in the trade, followed to the player it became and what he has been
        worth. A pick that was traded again shows each later trade on the way: open one to see it
        here.
      </p>
      <div className="lg-sheet mt-4 rounded-2xl border border-(--ts-line) bg-(--ts-surface) p-3 sm:p-4">
        {isPublic ? (
          <ul
            className="mb-3 flex flex-wrap gap-x-5 gap-y-1 ts-small text-(--ts-ink2)"
            aria-label="Key"
          >
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="lg-bar inline-block h-3 w-8" />a longer bar is
              more value
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="lg-bar-away inline-block h-3 w-8" />
              value the player gave another club
            </li>
          </ul>
        ) : (
          <ul
            className="mb-3 flex flex-wrap gap-x-5 gap-y-1 ts-small text-(--ts-ink2)"
            aria-label="Key"
          >
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="lg-node size-3 flex-none rounded-sm border-2 border-(--ts-accent) bg-(--ts-surface)"
              />
              this trade
            </li>
            <li className="flex items-center gap-1.5">
              <Connector /> stayed with the club
            </li>
            <li className="flex items-center gap-1.5">
              <Connector dashed /> went to another club
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="lg-bar inline-block h-2.5 w-8 rounded-full border-2 border-(--ts-accent) bg-(--ts-accent)/30"
              />
              a longer bar is more value (PAV)
            </li>
          </ul>
        )}
        {groups.map(({ club, tint, assets }) => (
          <div
            key={club.clubId}
            className={`lg-group mt-3 rounded-xl p-3 sm:p-4 ${tint}`}
            style={{ '--lg-fill': clubStyle(club.clubName).fill } as CSSProperties}
          >
            <h3 className="flex items-center gap-2 ts-body font-semibold">
              <ClubBadge clubName={club.clubName} size="md" named />
              <span className="lg-club">{club.clubName} received</span>
            </h3>
            {isPublic ? (
              <p aria-hidden="true" className="lg-row lg-head">
                <span>Got</span>
                <span>Became</span>
                <span>Worth so far (PAV)</span>
              </p>
            ) : null}
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
                    {isPublic ? (
                      <div className="lg-row">
                        <div>
                          <p className="lg-asset ts-body font-medium">{asset.label}</p>
                          {before.length > 0 ? (
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 ts-small text-(--ts-ink2)">
                              <span>Came via</span>
                              {before.map((hop, at) => (
                                <Fragment key={`before-${hop.tradeId}`}>
                                  {at > 0 ? <span>then</span> : null}
                                  {tradeButton(
                                    hop.tradeId,
                                    asset.transferId,
                                    `a ${hop.year} trade`
                                  )}
                                </Fragment>
                              ))}
                            </p>
                          ) : null}
                        </div>
                        <div className="lg-became">
                          {after.length > 0 ? (
                            <p className="mb-1.5 flex flex-wrap items-center gap-1.5 ts-small text-(--ts-ink2)">
                              <span>Traded on:</span>
                              {after.map((hop) => (
                                <Fragment key={`after-${hop.tradeId}`}>
                                  {tradeButton(
                                    hop.tradeId,
                                    asset.transferId,
                                    `⇄ ${tradeShortName([hop])} ${hop.year}`
                                  )}
                                </Fragment>
                              ))}
                            </p>
                          ) : null}
                          <Outcome
                            asset={asset}
                            groupClubId={club.clubId}
                            maxValue={maxValue}
                            share={share}
                            split
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
                        <div>
                          <p className="lg-asset ts-body font-medium">{asset.label}</p>
                          {before.length > 0 ? (
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 ts-small text-(--ts-ink2)">
                              <span>Came via</span>
                              {before.map((hop, at) => (
                                <Fragment key={`before-${hop.tradeId}`}>
                                  {at > 0 ? <span>then</span> : null}
                                  {tradeButton(
                                    hop.tradeId,
                                    asset.transferId,
                                    `a ${hop.year} trade`
                                  )}
                                </Fragment>
                              ))}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-y-2">
                          <span
                            aria-hidden="true"
                            className="lg-node size-3 flex-none rounded-sm border-2 border-(--ts-accent) bg-(--ts-surface)"
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
                              'clubId' in asset.outcome && asset.outcome.clubId !== club.clubId
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
                    )}
                    {panel(asset.transferId)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="mt-4">
          <h3 className="ts-small font-medium text-(--ts-ink2)">Every trade in this map</h3>
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
