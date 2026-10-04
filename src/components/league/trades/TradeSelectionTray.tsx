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
      className="z-10 shrink-0 border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] pl-4 pr-20 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
    >
      <div className="flex flex-col gap-2.5">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="text-sm font-semibold tabular-nums text-[color:var(--trade-text)]">
            {selectedLabel}
          </p>
          <p className="text-xs text-[color:var(--trade-text-muted)]">{statusLabel}</p>
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
            className="inline-flex h-11 w-full items-center justify-center rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            Clear
          </button>
          <button
            ref={reviewButtonRef}
            type="button"
            disabled={!selectionComplete || disabled}
            onClick={onReview}
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[color:var(--trade-action)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)] sm:w-auto"
          >
            Review trade
          </button>
        </div>
      </div>
    </div>
  );
}
