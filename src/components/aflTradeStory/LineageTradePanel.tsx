import Link from 'next/link';
import { useEffect, useRef, type RefObject } from 'react';

import type { AflTradeStoryLineageTrade } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { AssetValue } from './AssetValue';
import { becameText, netText, tradeName, tradeStoryHref } from './tradePageModel';

export const panelId = (tradeId: string) =>
  `trade-panel-${tradeId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;

/**
 * One trade of the lineage, opened inside the map: what each club got, each club's net on that
 * trade, and a link to the trade's own page. Escape or Close returns focus to what opened it.
 */
export function LineageTradePanel({
  trade,
  isThisTrade,
  clubNames,
  headingRef,
  onClose,
}: {
  trade: AflTradeStoryLineageTrade;
  isThisTrade: boolean;
  clubNames: ReadonlyMap<string, string>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const id = panelId(trade.tradeId);
  const name = `${tradeName(trade.clubs)}, ${trade.year}`;
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = container.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    element?.addEventListener('keydown', onKeyDown);
    return () => element?.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div
      id={id}
      role="region"
      aria-labelledby={`${id}-title`}
      ref={container}
      className="mt-3 rounded-xl border border-(--ts-accent) bg-(--ts-surface) p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id={`${id}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="ts-body font-semibold focus:outline-none focus-visible:outline-2"
        >
          {name}
          {isThisTrade ? (
            <span className="ml-2 ts-body font-normal text-(--ts-ink2)">(this trade)</span>
          ) : null}
        </h4>
        <div className="flex items-center gap-2">
          {isThisTrade ? null : (
            <Link
              href={tradeStoryHref(trade.tradeId)}
              className="inline-flex min-h-10 items-center rounded-lg border border-(--ts-accent) px-3 ts-body font-semibold text-(--ts-accent) hover:bg-(--ts-bg2)"
            >
              Trade page <span aria-hidden="true">&nbsp;→</span>
              <span className="sr-only"> for {name}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center rounded-lg border border-(--ts-line) px-3 ts-body hover:border-(--ts-muted)"
          >
            Close<span className="sr-only"> {name}</span>
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {trade.clubs.map((club) => {
          const net = trade.nets.find(({ clubId }) => clubId === club.clubId);
          const got = trade.assets.filter(({ toClubId }) => toClubId === club.clubId);
          return (
            <div key={club.clubId}>
              <p className="flex items-center gap-2 ts-body font-medium">
                <ClubBadge clubName={club.clubName} named />
                {club.clubName} got
                {net ? (
                  <span
                    className={`ml-auto font-semibold tabular-nums ${net.net < 0 ? 'text-(--ts-neg)' : 'text-(--ts-pos)'}`}
                  >
                    {netText(net)}
                    <span className="sr-only"> net on this trade</span>
                  </span>
                ) : null}
              </p>
              <ul className="mt-1">
                {got.map((asset) => (
                  <li
                    key={asset.transferId}
                    className="flex justify-between gap-3 border-t border-(--ts-line) py-1.5 ts-body"
                  >
                    <span>
                      {asset.label}{' '}
                      <span className="text-(--ts-ink2)">· {becameText(asset, clubNames)}</span>
                    </span>
                    <span className="font-semibold whitespace-nowrap tabular-nums">
                      <AssetValue asset={asset} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
