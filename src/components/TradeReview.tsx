'use client';

import React from 'react';
import type { Player } from '@/types';

// ---------- Config you can tweak any time ----------
const STAT_FIELDS: Array<{ key: keyof NonNullable<Player['stats']>; label: string; dp?: number }> = [
  { key: 'metresGained', label: 'Metres Gained' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'goals', label: 'Goals' },
  { key: 'scoreInvolvements', label: 'Score Inv.' },
  { key: 'inside50s', label: 'Inside 50s' },
];

const POSITION_KEYS = ['DEF', 'MID', 'FWD', 'RUC'] as const;
type Pos = (typeof POSITION_KEYS)[number];

type Constraints = {
  capDelta?: number;       // +/- salary/cap effect
  budgetAfter?: number;    // remaining budget after trade
  listSpotsAfter?: number; // optional roster spots
};

type TradeReviewProps = {
  outgoing: Player[];
  incoming: Player[];
  constraints?: Constraints;
  onConfirm: () => void;
  onCancel: () => void;
};

// ---------- Helpers ----------
const readNum = (v: unknown, dp = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '–';
  return dp > 0 ? n.toFixed(dp) : `${Math.round(n)}`;
};

function sumField(players: Player[], key: keyof NonNullable<Player['stats']>) {
  return players.reduce((t, p) => t + Number(p.stats?.[key] ?? 0), 0);
}

function countPos(players: Player[]) {
  const by: Record<Pos, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0 };
  for (const p of players) {
    const pos = String(p.position ?? '').toUpperCase();
    for (const tag of POSITION_KEYS) if (pos.includes(tag)) by[tag] += 1;
  }
  return by;
}

function fairnessScore(outgoing: Player[], incoming: Player[]) {
  // Toy model we used earlier: MG + 8*CLR
  const score = (arr: Player[]) =>
    arr.reduce(
      (t, p) => t + (Number(p.stats?.metresGained ?? 0) + 8 * Number(p.stats?.clearances ?? 0)),
      0
    );
  const outS = score(outgoing);
  const inS = score(incoming);
  const delta = inS - outS;
  const verdict =
    delta > 30 ? { text: 'Favors You', tone: 'green' } :
    delta < -30 ? { text: 'Favors Opponent', tone: 'red' } :
                  { text: 'Balanced', tone: 'neutral' };
  return { delta, ...verdict };
}

function Badge({ children, tone = 'neutral' as 'neutral' | 'blue' | 'green' | 'amber' | 'red' }) {
  const map = {
    neutral: 'bg-white/10 text-gray-200 ring-white/20',
    blue: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-gray-900 ring-1 ring-white/10">
      <header className="px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </header>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

function PlayerRow({ p }: { p: Player }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
      <div className="min-w-0">
        <div className="truncate font-medium text-white">{p.name}</div>
        <div className="text-xs text-gray-400">
          {p.team ?? '—'} {p.position ? `• ${p.position}` : ''}
        </div>
      </div>
      <div className="hidden sm:flex gap-1">
        <Badge tone="blue">MG {readNum(p.stats?.metresGained)}</Badge>
        <Badge tone="green">Clr {readNum(p.stats?.clearances)}</Badge>
        {Number(p.stats?.goals ?? 0) > 0 && <Badge tone="amber">G {readNum(p.stats?.goals)}</Badge>}
      </div>
    </li>
  );
}

// ---------- Component ----------
export default function TradeReview({
  outgoing,
  incoming,
  constraints,
  onConfirm,
  onCancel,
}: TradeReviewProps) {
  const fairness = fairnessScore(outgoing, incoming);

  const totals = STAT_FIELDS.map(({ key, label, dp }) => {
    const out = sumField(outgoing, key);
    const inc = sumField(incoming, key);
    const delta = inc - out;
    return { key, label, out, inc, delta, dp };
  });

  const posOut = countPos(outgoing);
  const posIn = countPos(incoming);
  const posDelta: Record<Pos, number> = { DEF: 0, MID: 0, FWD: 0, RUC: 0 };
  for (const k of POSITION_KEYS) posDelta[k] = posIn[k] - posOut[k];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div className="w-full max-w-7xl rounded-2xl bg-gray-950 ring-1 ring-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">Review Trade</h2>
            <p className="text-sm text-gray-400">Check totals, position balance, & fairness before confirming.</p>
          </div>
          <button
            className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10"
            onClick={onCancel}
          >
            Close
          </button>
        </div>

        {/* Three-column layout */}
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.15fr_22rem]">
          {/* Outgoing */}
          <CardShell title={`Outgoing • ${outgoing.length} player${outgoing.length === 1 ? '' : 's'}`}>
            {outgoing.length ? (
              <ul className="space-y-2">
                {outgoing.map((p) => (
                  <PlayerRow key={p.id} p={p} />
                ))}
              </ul>
            ) : (
              <div className="text-sm text-gray-400">No players.</div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {STAT_FIELDS.map(({ key, label, dp }) => (
                <div key={String(key)} className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                  <div className="text-[11px] text-gray-400">{label}</div>
                  <div className="text-white font-semibold tabular-nums">
                    {readNum(sumField(outgoing, key), dp)}
                  </div>
                </div>
              ))}
            </div>
          </CardShell>

          {/* Middle: Comparison */}
          <CardShell title="Comparison & Deltas">
            {/* Totals table */}
            <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-gray-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Stat</th>
                    <th className="px-3 py-2 text-right">Out</th>
                    <th className="px-3 py-2 text-right">In</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {totals.map(({ label, out, inc, delta, dp }) => (
                    <tr key={label}>
                      <td className="px-3 py-2 text-gray-200">{label}</td>
                      <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{readNum(out, dp)}</td>
                      <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{readNum(inc, dp)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'text-gray-200'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}{readNum(delta, dp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Position balance */}
            <div className="mt-4 grid grid-cols-4 gap-2">
              {POSITION_KEYS.map((pos) => {
                const d = posDelta[pos];
                return (
                  <div key={pos} className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                    <div className="text-[11px] text-gray-400">{pos}</div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-gray-400">Out {posOut[pos]}</span>
                      <span className="text-xs text-gray-400">In {posIn[pos]}</span>
                    </div>
                    <div className={`mt-1 text-sm font-semibold tabular-nums ${
                      d > 0 ? 'text-emerald-300' : d < 0 ? 'text-rose-300' : 'text-gray-200'
                    }`}>
                      Δ {d > 0 ? `+${d}` : d}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fairness */}
            <div className="mt-4 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-300">Fairness</div>
                <Badge tone={
                  fairness.tone === 'green' ? 'green' :
                  fairness.tone === 'red' ? 'red' : 'neutral'
                }>
                  {fairness.text}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                Model: MG + 8 × Clearances • Δ {fairness.delta > 0 ? '+' : ''}{readNum(fairness.delta)}
              </div>
            </div>
          </CardShell>

          {/* Incoming / Constraints / CTA */}
          <div className="space-y-4">
            <CardShell title={`Incoming • ${incoming.length} player${incoming.length === 1 ? '' : 's'}`}>
              {incoming.length ? (
                <ul className="space-y-2">
                  {incoming.map((p) => (
                    <PlayerRow key={p.id} p={p} />
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-400">No players.</div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                {STAT_FIELDS.map(({ key, label, dp }) => (
                  <div key={String(key)} className="rounded-lg bg-white/5 p-2 ring-1 ring-white/10">
                    <div className="text-[11px] text-gray-400">{label}</div>
                    <div className="text-white font-semibold tabular-nums">
                      {readNum(sumField(incoming, key), dp)}
                    </div>
                  </div>
                ))}
              </div>
            </CardShell>

            <CardShell title="Constraints">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Cap Δ</span>
                  <span className={`font-semibold tabular-nums ${
                    (constraints?.capDelta ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}>
                    {(constraints?.capDelta ?? 0) >= 0 ? '+' : ''}{readNum(constraints?.capDelta ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Budget after</span>
                  <span className="font-semibold text-white tabular-nums">
                    {constraints?.budgetAfter != null ? constraints.budgetAfter.toLocaleString() : '–'}
                  </span>
                </div>
                {constraints?.listSpotsAfter != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">List spots</span>
                    <span className="font-semibold text-white tabular-nums">
                      {constraints.listSpotsAfter}
                    </span>
                  </div>
                )}
              </div>
            </CardShell>

            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 rounded-md bg-white/5 px-4 py-2 text-gray-200 ring-1 ring-white/10 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
              >
                Confirm Trade
              </button>
            </div>
          </div>
        </div>

        {/* Footer tip */}
        <div className="border-t border-white/10 px-6 py-3 text-xs text-gray-400">
          Tip: Click a player’s name in the main app to view full details. You can fine‑tune the offer before confirming.
        </div>
      </div>
    </div>
  );
}