'use client';

import type React from 'react';

import { VERDICT_TONE_CLASS } from './TradeVerdictStrip';
import type { TradeVerdict } from './tradeVerdict';

export interface TradeSelectionTrayProps {
  selectedCount: number;
  selectionComplete: boolean;
  disabled: boolean;
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
  onClear: () => void;
  onReview: () => void;
  /** The live verdict, repeated here so it stays visible when the trade panel is folded on phones. */
  verdict?: TradeVerdict;
}

/** The trade panel's footer: how many players are picked, the verdict, Clear and Review. */
export function TradeSelectionTray({
  selectedCount,
  selectionComplete,
  disabled,
  reviewButtonRef,
  onClear,
  onReview,
  verdict,
}: TradeSelectionTrayProps): React.JSX.Element {
  const selectedLabel = `${selectedCount} ${selectedCount === 1 ? 'player' : 'players'} selected`;
  const statusLabel = selectionComplete ? 'Ready' : 'Pick from both teams';

  return (
    <div
      data-trade-selection-tray
      className="z-10 shrink-0 border-t border-border bg-card pl-4 pr-20 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
    >
      <div className="flex flex-col gap-2.5">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="text-sm font-semibold tabular-nums text-foreground">{selectedLabel}</p>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
          {selectionComplete && verdict ? (
            // Repeated for phones, where the panel above is folded away.
            <p className={`text-sm font-bold lg:hidden ${VERDICT_TONE_CLASS[verdict.tone]}`}>
              {verdict.headline}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <button
            type="button"
            aria-label="Clear selected players"
            disabled={selectedCount === 0 || disabled}
            onClick={onClear}
            className="inline-flex h-11 w-full items-center justify-center rounded-cut border border-foreground bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            Clear
          </button>
          <button
            ref={reviewButtonRef}
            type="button"
            disabled={!selectionComplete || disabled}
            onClick={onReview}
            className="inline-flex h-11 w-full items-center justify-center rounded-cut bg-brand-bar px-5 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:border-2 disabled:border-dashed disabled:border-muted-foreground disabled:bg-transparent disabled:text-muted-foreground sm:w-auto"
          >
            Review trade
          </button>
        </div>
      </div>
    </div>
  );
}
