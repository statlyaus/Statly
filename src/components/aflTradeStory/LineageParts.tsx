import type { AflTradeStoryLineageAsset } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { bidShareAnchor } from './BidMatchShareCard';
import { formatPav, knownPav, PENDING_TEXT, type AflTradePageBidShare } from './tradePageModel';

/** The longest outcome bar, in pixels: every row's bar is on the same scale. */
const BAR_WIDTH = 240;

export function TradeButton({
  label,
  name,
  open,
  controls,
  onToggle,
  buttonRef,
}: {
  label: string;
  name: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 bg-(--ts-surface) px-3 ts-body font-semibold ${
        open
          ? 'border-(--ts-accent) text-(--ts-accent)'
          : 'border-(--ts-line) hover:border-(--ts-muted)'
      }`}
    >
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {open ? 'Hide' : 'Show'} the {name} trade
      </span>
    </button>
  );
}

export const Connector = ({ dashed }: { dashed?: boolean }) => (
  <span
    aria-hidden="true"
    className={`h-0 w-5 flex-none border-t-2 sm:w-8 ${dashed ? 'border-dashed border-(--ts-muted)' : 'border-(--ts-accent)'}`}
  />
);

export function Outcome({
  asset,
  groupClubId,
  maxValue,
  share,
}: {
  asset: AflTradeStoryLineageAsset;
  groupClubId: string;
  maxValue: number;
  share: AflTradePageBidShare | null;
}) {
  const { outcome } = asset;
  const value = knownPav(asset.value);
  if (
    outcome.kind === 'bid_share' ||
    (outcome.kind === 'pending' && outcome.pending === 'matched_bid')
  )
    return (
      <span className="inline-flex flex-wrap items-center gap-2 ts-body">
        <span className="rounded-md bg-(--ts-bid-soft) px-2 py-0.5 ts-small font-bold tracking-wide text-(--ts-bid)">
          BID MATCH
        </span>
        {outcome.kind === 'bid_share' && value !== null ? (
          share ? (
            <a
              href={`#${bidShareAnchor(asset.assetId)}`}
              className="text-(--ts-accent) underline underline-offset-2"
            >
              Share of {outcome.playerName}: {formatPav(value, 2)}
            </a>
          ) : (
            <span>
              Share of {outcome.playerName}: {formatPav(value, 2)}
            </span>
          )
        ) : (
          <span className="text-(--ts-ink2)">Value pending</span>
        )}
      </span>
    );
  if (outcome.kind === 'pending')
    return (
      <span className="ts-body text-(--ts-ink2)">
        Value pending: {PENDING_TEXT[outcome.pending]}
      </span>
    );
  if (outcome.kind === 'not_used')
    return <span className="ts-body text-(--ts-ink2)">Not used · 0.0</span>;
  if (outcome.kind === 'pick')
    return (
      <span className="ts-body">
        {outcome.draftYear} draft to come · pick {outcome.selectionNumber} ·{' '}
        <span className="font-semibold tabular-nums">{formatPav(value ?? 0)}</span>
      </span>
    );
  const away = outcome.clubId !== groupClubId;
  const shown = value ?? 0;
  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      <span className="ts-body">
        <span className="font-semibold">{outcome.playerName}</span>
        {outcome.selection ? (
          <span className="text-(--ts-ink2)">
            {' '}
            (pick {outcome.selection.selectionNumber}, {outcome.selection.draftYear})
          </span>
        ) : null}
        {away ? <span className="text-(--ts-ink2)"> at {outcome.clubName}</span> : null} ·{' '}
        <span className="font-semibold tabular-nums">{formatPav(shown)}</span>
      </span>
      <span aria-hidden="true" className="block h-2.5">
        <span
          className={`block h-full rounded-full border-2 ${
            away
              ? 'border-dashed border-(--ts-muted) bg-transparent'
              : 'border-(--ts-accent) bg-(--ts-accent)/30'
          }`}
          style={{
            width: `${Math.max(10, maxValue > 0 ? (Math.max(0, shown) / maxValue) * BAR_WIDTH : 0)}px`,
          }}
        />
      </span>
    </span>
  );
}
