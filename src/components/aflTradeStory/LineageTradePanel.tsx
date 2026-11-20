import Link from 'next/link';
import { useEffect, useRef, type RefObject } from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';
import type { AflTradeStoryLineageTrade } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { AssetValue } from './AssetValue';
import {
  becameText,
  netText,
  tradeName,
  tradeStoryHref,
  type AflTradePageAudience,
} from './tradePageModel';

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
  audience,
}: {
  trade: AflTradeStoryLineageTrade;
  isThisTrade: boolean;
  clubNames: ReadonlyMap<string, string>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  audience?: AflTradePageAudience;
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
      className="mt-3 border border-primary bg-card p-4"
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
            <span className="ml-2 ts-body font-normal text-muted-foreground">(this trade)</span>
          ) : null}
        </h4>
        <div className="flex items-center gap-2">
          {isThisTrade ? null : (
            <Link
              href={tradeStoryHref(trade.tradeId, audience)}
              className={buttonStyles({ variant: 'outline', size: 'md' })}
            >
              Trade page <span aria-hidden="true">&nbsp;→</span>
              <span className="sr-only"> for {name}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className={buttonStyles({ variant: 'outline', size: 'md' })}
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
                  <span className="ml-auto font-semibold tabular-nums text-foreground">
                    {netText(net)}
                    <span className="sr-only"> net on this trade</span>
                  </span>
                ) : null}
              </p>
              <ul className="mt-1">
                {got.map((asset) => (
                  <li
                    key={asset.transferId}
                    className="flex justify-between gap-3 border-t border-border py-1.5 ts-body"
                  >
                    <span>
                      {asset.label}{' '}
                      <span className="text-muted-foreground">
                        · {becameText(asset, clubNames)}
                      </span>
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
