import { useEffect, useRef, type ReactElement } from 'react';

import { displayPlayerName, formatPlayerMeta } from '@/components/trades/tradePlayerUtils';
import { getDeltaClass } from '@/components/trades/tradeUiUtils';

import type { RosterPlayer } from './tradeUiTypes';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

type TradeConfirmModalProps = {
  open: boolean;
  createSubmitting: boolean;
  createSummary: string | null;
  createNetImpact: { net: number; label: string };
  hasVisibleKeys: boolean;
  outgoingPlayers: RosterPlayer[];
  incomingPlayers: RosterPlayer[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export default function TradeConfirmModal({
  open,
  createSubmitting,
  createSummary,
  createNetImpact,
  hasVisibleKeys,
  outgoingPlayers,
  incomingPlayers,
  onCancel,
  onConfirm,
}: TradeConfirmModalProps): ReactElement | null {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstFocusable = modalRef.current ? getFocusableElements(modalRef.current)[0] : null;
    firstFocusable?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(modalRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-confirm-title"
        aria-describedby="trade-confirm-description"
        tabIndex={-1}
        className="w-full max-w-2xl rounded-2xl bg-white p-7 shadow-2xl space-y-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl">
            🤝
          </div>
          <div>
            <h3 id="trade-confirm-title" className="text-2xl font-semibold text-foreground">
              Confirm Trade
            </h3>
            <p id="trade-confirm-description" className="text-sm text-muted-foreground">
              Are you sure you want to complete this trade?
            </p>
          </div>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm text-foreground leading-relaxed">
            {createSummary ||
              "You're proposing a trade. Please review the players moving in and out before submitting."}
          </p>
          {hasVisibleKeys && (
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span className="text-lg" aria-hidden="true">
                  {createNetImpact.net > 0 ? '🟩' : createNetImpact.net < 0 ? '🟥' : '🟧'}
                </span>
                <span className="font-semibold">Net impact:</span>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getDeltaClass(
                    createNetImpact.net
                  )}`}
                >
                  {createNetImpact.label}
                </span>
                <span className="text-xs text-muted-foreground">across selected stats</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {createNetImpact.net > 0
                  ? "This trade should boost your team's output."
                  : createNetImpact.net < 0
                    ? 'This trade may reduce your output, double check before submitting.'
                    : 'No projected change from this trade.'}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">You send</p>
            <div className="space-y-2">
              {outgoingPlayers.length === 0 ? (
                <span className="text-muted-foreground text-xs">No players selected.</span>
              ) : (
                outgoingPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-md bg-muted px-3 py-2 text-foreground shadow-sm"
                  >
                    <div className="font-semibold">{displayPlayerName(p)}</div>
                    <div className="text-[11px] text-muted-foreground">{formatPlayerMeta(p)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">You receive</p>
            <div className="space-y-2">
              {incomingPlayers.length === 0 ? (
                <span className="text-muted-foreground text-xs">No players selected.</span>
              ) : (
                incomingPlayers.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-md bg-success/10 px-3 py-2 text-foreground shadow-sm"
                  >
                    <div className="font-semibold">{displayPlayerName(p)}</div>
                    <div className="text-[11px] text-muted-foreground">{formatPlayerMeta(p)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm();
            }}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-muted"
            disabled={createSubmitting}
          >
            {createSubmitting ? 'Submitting…' : 'Yes, Confirm Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}
