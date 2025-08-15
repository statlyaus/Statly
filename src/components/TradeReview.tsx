'use client';

import React, { useMemo } from 'react';
import type { Player } from '@/types/players';

/* ----------------------------- types ----------------------------- */

export type TradeConstraints = {
  listSpotsAfter?: number | undefined;
};

export interface TradeReviewProps {
  outgoing: Player[];
  incoming: Player[];
  constraints?: TradeConstraints;
  onCancel: () => void;
  onConfirm: () => void;
}

/* --------------------------- stat helpers ------------------------ */

type StatKey = keyof NonNullable<Player['stats']>;
const MG: StatKey = 'metresGained';
const CLR: StatKey = 'clearances';

const sum = (arr: Player[], k: StatKey) => arr.reduce((t, p) => t + Number(p.stats?.[k] ?? 0), 0);

function fmt(n: number | undefined): string {
  if (!Number.isFinite(n ?? NaN)) return '–';
  const v = Math.round(n as number);
  return v >= 0 ? `+${v}` : `${v}`;
}

function fairnessScore(outgoing: Player[], incoming: Player[]) {
  // same heuristic (MG + 8 × CLR)
  const score = (list: Player[]) =>
    list.reduce(
      (t, p) => t + Number(p.stats?.metresGained ?? 0) + 8 * Number(p.stats?.clearances ?? 0),
      0
    );
  const outS = score(outgoing);
  const inS = score(incoming);
  const delta = inS - outS;

  const label = delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
  const tone: Tone = delta > 30 ? 'good' : delta < -30 ? 'bad' : 'neutral';

  return { delta, label, tone };
}

/* --------------------------- small UI bits ----------------------- */

type Tone = 'neutral' | 'good' | 'bad';

interface PillProps {
  children: React.ReactNode;
  tone?: Tone;
}

const Pill: React.FC<PillProps> = ({ children, tone = 'neutral' }) => {
  const map: Record<Tone, string> = {
    neutral: 'bg-white/10 text-gray-200 ring-white/20',
    good: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    bad: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
};

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

/* ------------------------------- UI ------------------------------ */

export default function TradeReview({
  outgoing,
  incoming,
  constraints,
  onCancel,
  onConfirm,
}: TradeReviewProps) {
  const mgOut = useMemo(() => sum(outgoing, MG), [outgoing]);
  const mgIn = useMemo(() => sum(incoming, MG), [incoming]);
  const clrOut = useMemo(() => sum(outgoing, CLR), [outgoing]);
  const clrIn = useMemo(() => sum(incoming, CLR), [incoming]);

  const fairness = useMemo(() => fairnessScore(outgoing, incoming), [outgoing, incoming]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-gray-900 ring-1 ring-white/10">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Review trade</h2>
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-2 py-1 text-sm text-gray-200 hover:bg-white/20"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_1fr_18rem]">
          {/* Outgoing column */}
          <section aria-label="Trade out" className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Trade out</h3>
            <ul className="space-y-2">
              {outgoing.length === 0 ? (
                <li className="rounded-lg bg-white/5 p-3 text-sm text-gray-400 ring-1 ring-white/10">
                  No players
                </li>
              ) : (
                outgoing.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Pill>MG {Math.round(Number(p.stats?.metresGained ?? 0))}</Pill>
                      <Pill>Clr {Math.round(Number(p.stats?.clearances ?? 0))}</Pill>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Incoming column */}
          <section aria-label="Trade in" className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-gray-300">Trade in</h3>
            <ul className="space-y-2">
              {incoming.length === 0 ? (
                <li className="rounded-lg bg-white/5 p-3 text-sm text-gray-400 ring-1 ring-white/10">
                  No players
                </li>
              ) : (
                incoming.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3 ring-1 ring-white/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Pill tone="good">MG {Math.round(Number(p.stats?.metresGained ?? 0))}</Pill>
                      <Pill tone="good">Clr {Math.round(Number(p.stats?.clearances ?? 0))}</Pill>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* Summary column */}
          <aside className="space-y-3">
            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-300">Fairness</span>
                <Pill tone={fairness.tone}>{fairness.label}</Pill>
              </div>
              <p className="text-[11px] text-gray-500">
                Heuristic: MG + 8×Clearances • Δ {fairness.delta > 0 ? '+' : ''}
                {Math.round(fairness.delta)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatBadge label="MG Δ" value={fmt(mgIn - mgOut)} />
              <StatBadge label="Clr Δ" value={fmt(clrIn - clrOut)} />
            </div>

            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 text-sm font-medium text-white">Constraints</div>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">List spots (post)</dt>
                  <dd className="tabular-nums">
                    {Number.isFinite(constraints?.listSpotsAfter ?? NaN)
                      ? Math.round(constraints!.listSpotsAfter!)
                      : '–'}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            onClick={onCancel}
            className="rounded-md bg-white/10 px-3 py-2 text-white ring-1 ring-white/15 hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Confirm & send
          </button>
        </div>
      </div>
    </div>
  );
}
