'use client';

import React, { useMemo, useState, useCallback } from 'react';
import type { Player } from '@/types';
import { useTradeStore, type Side } from '@/state/tradeStore';
import TradeReview from '@/components/TradeReview';

/* ----------------------------- helpers ---------------------------------- */

type StatKey = keyof NonNullable<Player['stats']>;

const MG: StatKey = 'metresGained';
const CLR: StatKey = 'clearances';

function sum(players: Player[], key: StatKey): number {
  return players.reduce((t, p) => t + Number(p.stats?.[key] ?? 0), 0);
}

function readNum(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return `${Math.round(n)}`;
}

function fairnessScore(outgoing: Player[], incoming: Player[]) {
  // same heuristic we’ve been using
  const score = (arr: Player[]) =>
    arr.reduce(
      (t, p) => t + (Number(p.stats?.metresGained ?? 0) + 8 * Number(p.stats?.clearances ?? 0)),
      0
    );
  const outS = score(outgoing);
  const inS = score(incoming);
  const delta = inS - outS;

  const label =
    delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
  const tone: 'neutral' | 'good' | 'bad' =
    delta > 30 ? 'good' : delta < -30 ? 'bad' : 'neutral';

  return { delta, label, tone };
}

function Badge({
  children,
  tone = 'neutral' as 'neutral' | 'good' | 'bad',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const map = {
    neutral: 'bg-white/10 text-gray-200 ring-white/20',
    good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  } as const;
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
}

/* ----------------------------- component --------------------------------- */

export default function OfferDock() {
  const outgoing = useTradeStore((s) => s.outgoing);
  const incoming = useTradeStore((s) => s.incoming);
  const remove = useTradeStore((s) => s.remove);
  const clearAll = useTradeStore((s) => s.clearAll);

  const [reviewOpen, setReviewOpen] = useState(false);

  const mgOut = useMemo(() => sum(outgoing, MG), [outgoing]);
  const mgIn = useMemo(() => sum(incoming, MG), [incoming]);
  const clrOut = useMemo(() => sum(outgoing, CLR), [outgoing]);
  const clrIn = useMemo(() => sum(incoming, CLR), [incoming]);

  const fairness = useMemo(() => fairnessScore(outgoing, incoming), [outgoing, incoming]);

  const handleRemove = useCallback(
    (side: Side, id: string | number) => remove(side, id),
    [remove]
  );

  const hasOffer = outgoing.length > 0 || incoming.length > 0;

  return (
    <>
      <aside
        className="sticky top-24 h-fit rounded-2xl bg-gray-900 p-4 ring-1 ring-white/10"
        aria-label="Trade offer summary"
      >
        <h3 className="text-lg font-semibold text-white">Offer</h3>

        {/* Outgoing */}
        <section className="mt-3">
          <h4 className="mb-2 text-sm font-medium text-gray-300">Outgoing</h4>
          {outgoing.length === 0 ? (
            <div className="rounded-lg bg-white/5 p-2 text-sm text-gray-400 ring-1 ring-white/10">
              No players
            </div>
          ) : (
            <ul className="space-y-1">
              {outgoing.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/5 p-2 text-sm ring-1 ring-white/10"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{p.name}</div>
                    <div className="text-xs text-gray-400">
                      {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge>MG {readNum(Number(p.stats?.metresGained ?? 0))}</Badge>
                    <Badge>Clr {readNum(Number(p.stats?.clearances ?? 0))}</Badge>
                    <button
                      onClick={() => handleRemove('outgoing', p.id)}
                      className="rounded-md bg-white/10 px-2 py-1 text-xs text-gray-200 hover:bg-white/20"
                      aria-label={`Remove ${p.name} from outgoing`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Incoming */}
        <section className="mt-4">
          <h4 className="mb-2 text-sm font-medium text-gray-300">Incoming</h4>
          {incoming.length === 0 ? (
            <div className="rounded-lg bg-white/5 p-2 text-sm text-gray-400 ring-1 ring-white/10">
              No players
            </div>
          ) : (
            <ul className="space-y-1">
              {incoming.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/5 p-2 text-sm ring-1 ring-white/10"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{p.name}</div>
                    <div className="text-xs text-gray-400">
                      {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge>MG {readNum(Number(p.stats?.metresGained ?? 0))}</Badge>
                    <Badge>Clr {readNum(Number(p.stats?.clearances ?? 0))}</Badge>
                    <button
                      onClick={() => handleRemove('incoming', p.id)}
                      className="rounded-md bg-white/10 px-2 py-1 text-xs text-gray-200 hover:bg-white/20"
                      aria-label={`Remove ${p.name} from incoming`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Deltas */}
        <section className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
            <div className="text-xs text-gray-400">MG Δ</div>
            <div
              className={`font-semibold tabular-nums ${
                mgIn - mgOut > 0 ? 'text-emerald-300' : mgIn - mgOut < 0 ? 'text-rose-300' : 'text-gray-200'
              }`}
            >
              {mgIn - mgOut > 0 ? '+' : ''}
              {readNum(mgIn - mgOut)}
            </div>
          </div>
          <div className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
            <div className="text-xs text-gray-400">Clr Δ</div>
            <div
              className={`font-semibold tabular-nums ${
                clrIn - clrOut > 0 ? 'text-emerald-300' : clrIn - clrOut < 0 ? 'text-rose-300' : 'text-gray-200'
              }`}
            >
              {clrIn - clrOut > 0 ? '+' : ''}
              {readNum(clrIn - clrOut)}
            </div>
          </div>
        </section>

        {/* Fairness */}
        <section className="mt-3">
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
            <span className="text-sm text-gray-300">Fairness</span>
            <Badge tone={fairness.tone === 'good' ? 'good' : fairness.tone === 'bad' ? 'bad' : 'neutral'}>
              {fairness.label}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Heuristic: MG + 8×Clearances • Δ {fairness.delta > 0 ? '+' : ''}
            {readNum(fairness.delta)}
          </p>
        </section>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            disabled={!hasOffer}
            onClick={() => setReviewOpen(true)}
            className="flex-1 rounded-md bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-50 hover:bg-blue-700"
          >
            Send offer
          </button>
          <button
            onClick={clearAll}
            className="rounded-md bg-white/10 px-3 py-2 text-white ring-1 ring-white/15 hover:bg-white/20"
          >
            Clear
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-400">
          Tip: Click a player’s name to view details. You can fine‑tune in the player page.
        </p>
      </aside>

      {/* Review modal */}
      {reviewOpen && (
        <TradeReview
          outgoing={outgoing}
          incoming={incoming}
          // wire any constraints you track here:
          constraints={{
            capDelta: 0,          // replace with your calc
            budgetAfter: undefined,
            listSpotsAfter: undefined,
          }}
          onCancel={() => setReviewOpen(false)}
          onConfirm={() => {
            setReviewOpen(false);
            // TODO: submit the offer payload here.
            // Example:
            // await submitTrade({ outgoing, incoming })
          }}
        />
      )}
    </>
  );
}