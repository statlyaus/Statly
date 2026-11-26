'use client';

import type React from 'react';

import { buttonStyles } from '@/components/ui/controlStyles';

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
            className={buttonStyles({ className: 'w-full sm:w-auto' })}
          >
            Clear
          </button>
          <button
            ref={reviewButtonRef}
            type="button"
            disabled={!selectionComplete || disabled}
            onClick={onReview}
            className={buttonStyles({ variant: 'primary', className: 'w-full sm:w-auto' })}
          >
            Review trade
          </button>
        </div>
      </div>
    </div>
  );
}
