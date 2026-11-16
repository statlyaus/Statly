'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { STORY_FONT_CLASS } from '@/components/aflStories/CameronMasthead';

import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { Connector, Outcome, TradeButton } from './LineageParts';
import { LineageTradePanel, panelId } from './LineageTradePanel';
import { PublicLineageRow } from './PublicLineageRow';
import {
  bidShareOf,
  bidSharesByPickId,
  clubStyle,
  formatPav,
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
  const tradeButton = (tradeId: string, anchor: string, label: string, slip?: 'plain' | 'this') => {
    const trade = trades.get(tradeId);
    if (!trade)
      return slip ? (
        <span>{label}</span>
      ) : (
        <span className="ts-body text-(--ts-ink2)">{label}</span>
      );
    const key = `${anchor}|${tradeId}`;
    return (
      <TradeButton
        label={label}
        name={`${tradeName(trade.clubs)}, ${trade.year}`}
        open={open?.tradeId === tradeId && open.anchor === anchor}
        controls={panelId(tradeId)}
        slip={slip}
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

  if (audience === 'public') {
    // Every bar shares one scale: the largest value, rounded up to the next 20.
    const scaleMax = Math.max(20, Math.ceil(maxValue / 20) * 20);
    const ticks = [50, 100, 150, 200, 250, 300].filter((tick) => tick < scaleMax);
    const tradedPlayers = new Set(
      story.sides
        .flatMap(({ received }) => received)
        .filter(({ assetKind }) => assetKind === 'player')
        .map(({ transferId }) => transferId)
    );
    return (
      <section aria-labelledby="lineage-title" className={`mp-lineage ${STORY_FONT_CLASS}`}>
        <header>
          <h2 id="lineage-title" className="mp-title">
            Where everything went
          </h2>
          <p className="mp-lede">
            Every player and pick in the deal, followed to the player it became and what he has been
            worth since.
          </p>
        </header>
        <ul className="mp-key" aria-label="Key">
          <li>
            <span aria-hidden="true" className="mp-key-bar" />
            PAV, on one scale for every row
          </li>
          <li>
            <span aria-hidden="true" className="mp-key-bar mp-key-away" />
            value that went to another club
          </li>
          {ticks.length > 0 ? (
            <li>
              <span aria-hidden="true" className="mp-key-tick" />
              marks every 50
            </li>
          ) : null}
        </ul>
        <div className="mp-columns">
          {groups.map(({ club, assets }, index) => {
            const style = clubStyle(club.clubName);
            const side = story.sides.find(({ clubId }) => clubId === club.clubId);
            const tilt = index % 2 === 0 ? -0.8 : 0.7;
            return (
              <article
                key={club.clubId}
                className="mp-card"
                style={{ transform: `rotate(${tilt}deg)` }}
                aria-label={`${club.clubName} received`}
              >
                <span
                  aria-hidden="true"
                  className="mp-tape"
                  style={{ transform: `translateX(-50%) rotate(${-tilt * 3}deg)` }}
                />
                <header
                  className="mp-card-head"
                  style={{
                    backgroundColor: style.fill,
                    borderBottomColor: style.trim,
                    color: style.ink,
                  }}
                >
                  <div>
                    <h3>{club.clubName}</h3>
                    <p className="mp-hand">received</p>
                  </div>
                  {side ? (
                    <p className="mp-total">
                      <b>
                        {formatPav(side.receivedValue)}
                        {side.receivedPendingCount > 0 ? '*' : ''}
                      </b>
                      <span>PAV received</span>
                    </p>
                  ) : null}
                </header>
                <ol>
                  {assets.map((asset) => (
                    <PublicLineageRow
                      key={asset.transferId}
                      asset={asset}
                      isPlayer={tradedPlayers.has(asset.transferId)}
                      receiver={club.clubName}
                      receiverId={club.clubId}
                      colour={style.fill}
                      scaleMax={scaleMax}
                      ticks={ticks}
                      maxValue={maxValue}
                      share={bidShareOf(asset, shares)}
                      cameVia={asset.hops
                        .filter(({ relation }) => relation === 'before')
                        .map((hop) =>
                          tradeButton(hop.tradeId, asset.transferId, `a ${hop.year} trade`, 'plain')
                        )}
                      tradedOn={asset.hops
                        .filter(({ relation }) => relation === 'after')
                        .map((hop) =>
                          tradeButton(
                            hop.tradeId,
                            asset.transferId,
                            `${tradeShortName([hop])} ${hop.year}`,
                            'plain'
                          )
                        )}
                      panel={panel(asset.transferId)}
                    />
                  ))}
                </ol>
              </article>
            );
          })}
        </div>
        <footer className="mp-foot">
          <h3>Every trade in this map</h3>
          <ul>
            {story.lineage.trades.map((trade) => (
              <li key={trade.tradeId}>
                {tradeButton(
                  trade.tradeId,
                  LIST_ANCHOR,
                  `${tradeShortName(trade.clubs)} ${trade.year}${trade.tradeId === story.trade.id ? ' · this trade' : ''}`,
                  trade.tradeId === story.trade.id ? 'this' : 'plain'
                )}
              </li>
            ))}
          </ul>
          {panel(LIST_ANCHOR)}
        </footer>
      </section>
    );
  }

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
                          dashed={'clubId' in asset.outcome && asset.outcome.clubId !== club.clubId}
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
