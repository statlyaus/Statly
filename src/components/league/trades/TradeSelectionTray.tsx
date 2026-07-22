'use client';

import type React from 'react';

export interface TradeSelectionTrayProps {
  selectedCount: number;
  selectionComplete: boolean;
  disabled: boolean;
  reviewButtonRef: React.RefObject<HTMLButtonElement | null>;
  onClear: () => void;
  onReview: () => void;
}

export function TradeSelectionTray({
  selectedCount,
  selectionComplete,
  disabled,
  reviewButtonRef,
  onClear,
  onReview,
}: TradeSelectionTrayProps): React.JSX.Element {
  const selectedLabel = `${selectedCount} ${selectedCount === 1 ? 'player' : 'players'} selected`;
  const statusLabel = selectionComplete ? 'Ready to review' : 'Select from both teams';

  return (
    <div
      data-trade-selection-tray
      className="z-10 shrink-0 border-t border-[color:var(--trade-border)] bg-[color:var(--trade-surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[var(--trade-card-shadow)] sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="text-sm font-bold tabular-nums text-[color:var(--trade-text)]">
            {selectedLabel}
          </p>
          <p className="text-xs text-[color:var(--trade-text-muted)]">{statusLabel}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
          <button
            type="button"
            aria-label="Clear selected players"
            disabled={selectedCount === 0 || disabled}
            onClick={onClear}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-4 text-sm font-semibold text-[color:var(--trade-text)] transition-colors hover:bg-[color:var(--trade-action-soft)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          >
            Clear
          </button>
          <button
            ref={reviewButtonRef}
            type="button"
            disabled={!selectionComplete || disabled}
            onClick={onReview}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[color:var(--trade-action)] px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[color:var(--trade-action-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[color:var(--trade-border-strong)] disabled:text-[color:var(--trade-text-muted)] sm:w-auto"
          >
            Review trade
          </button>
        </div>
      </div>
    </div>
  );
}
