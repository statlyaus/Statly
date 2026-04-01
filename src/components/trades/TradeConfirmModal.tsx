import { useEffect, useRef, type ReactElement } from 'react';

import { displayPlayerName, formatPlayerMeta } from '@/components/trades/tradePlayerUtils';
import { getDeltaClass } from '@/components/trades/tradeUiUtils';

import type { RosterPlayer } from './tradeUiTypes';

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
    const firstButton = modalRef.current?.querySelector('button');
    firstButton?.focus();
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
        className="w-full max-w-2xl rounded-2xl bg-white p-7 shadow-2xl space-y-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">🤝</div>
          <div>
            <h3 id="trade-confirm-title" className="text-2xl font-semibold text-slate-900">
              Confirm Trade
            </h3>
            <p className="text-sm text-slate-600">Are you sure you want to complete this trade?</p>
          </div>
        </div>
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            {createSummary ||
              "You're proposing a trade. Please review the players moving in and out before submitting."}
          </p>
          {hasVisibleKeys && (
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
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
                <span className="text-xs text-slate-500">across selected stats</span>
              </p>
              <p className="text-xs text-slate-600">
                {createNetImpact.net > 0
                  ? "This trade should boost your team's output."
                  : createNetImpact.net < 0
                    ? 'This trade may reduce your output, double check before submitting.'
                    : 'No projected change from this trade.'}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-200 pt-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-slate-500">You send</p>
            <div className="space-y-2">
              {outgoingPlayers.length === 0 ? (
                <span className="text-slate-400 text-xs">No players selected.</span>
              ) : (
                outgoingPlayers.map((p) => (
                  <div key={p.id} className="rounded-md bg-slate-50 px-3 py-2 text-slate-800 shadow-sm">
                    <div className="font-semibold">{displayPlayerName(p)}</div>
                    <div className="text-[11px] text-slate-500">{formatPlayerMeta(p)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-slate-500">You receive</p>
            <div className="space-y-2">
              {incomingPlayers.length === 0 ? (
                <span className="text-slate-400 text-xs">No players selected.</span>
              ) : (
                incomingPlayers.map((p) => (
                  <div key={p.id} className="rounded-md bg-emerald-50 px-3 py-2 text-slate-800 shadow-sm">
                    <div className="font-semibold">{displayPlayerName(p)}</div>
                    <div className="text-[11px] text-slate-500">{formatPlayerMeta(p)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm();
            }}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            disabled={createSubmitting}
          >
            {createSubmitting ? 'Submitting…' : 'Yes, Confirm Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}
