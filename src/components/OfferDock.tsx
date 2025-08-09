'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTradeStore, type Side } from '@/state/tradeStore';
import type { Player } from '@/types';

function idOf(id: string | number | undefined): string {
  return String(id ?? '');
}

function readNum(p: Player, key: string): number {
  const v =
    (p.stats?.[key as keyof NonNullable<Player['stats']>] as number | string | undefined) ?? 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-gray-700/40 p-2">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Section({
  title,
  items,
  side,
}: {
  title: string;
  items: Player[];
  side: Side;
}) {
  const remove = useTradeStore((s) => s.remove);

  return (
    <div className="mb-3">
      <h4 className="text-gray-300 mb-1">{title}</h4>
      {items.length === 0 ? (
        <div className="text-gray-500 text-sm">No players</div>
      ) : (
        <ul className="space-y-1">
          {items.map((p) => {
            const pid = idOf(p.id); // ← normalize to string (fixes TS2345)
            return (
              <li key={pid} className="flex items-center justify-between text-sm">
                <Link href={`/players/${encodeURIComponent(pid)}`} className="text-blue-400 hover:underline">
                  {p.name}
                </Link>
                <button
                  onClick={() => remove(side, pid)} // ← string id
                  className="text-gray-400 hover:text-white"
                  aria-label={`Remove ${p.name}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function OfferDock() {
  const outgoing = useTradeStore((s) => s.outgoing);
  const incoming = useTradeStore((s) => s.incoming);
  const clearAll = useTradeStore((s) => s.clearAll);

  const summary = useMemo(() => {
    const sum = (arr: Player[], k: string) =>
      Math.round(arr.reduce((t, p) => t + readNum(p, k), 0));
    return {
      outMG: sum(outgoing, 'metresGained'),
      inMG: sum(incoming, 'metresGained'),
      outClr: sum(outgoing, 'clearances'),
      inClr: sum(incoming, 'clearances'),
    };
  }, [outgoing, incoming]);

  const fairness = (() => {
    const outScore = summary.outMG + 8 * summary.outClr;
    const inScore = summary.inMG + 8 * summary.inClr;
    const delta = inScore - outScore;
    const label = delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
    return { delta, label };
  })();

  return (
    <aside className="rounded-2xl bg-gray-900 ring-1 ring-white/10 p-4">
      <h3 className="text-lg font-semibold mb-2 text-white">Offer</h3>

      <Section title="Outgoing" items={outgoing} side="outgoing" />
      <Section title="Incoming" items={incoming} side="incoming" />

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <Metric label="MG Δ" value={summary.inMG - summary.outMG} />
        <Metric label="Clr Δ" value={summary.inClr - summary.outClr} />
        <Metric label="Fairness" value={fairness.label} />
      </div>

      <div className="mt-4 flex gap-2">
        <button className="flex-1 rounded-md bg-blue-600 py-2 text-white hover:bg-blue-700">
          Send offer
        </button>
        <button
          onClick={clearAll}
          className="rounded-md bg-gray-700 py-2 px-3 text-white hover:bg-gray-600"
        >
          Clear
        </button>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Tip: Click a name to view details. Fine‑tune on the player page.
      </p>
    </aside>
  );
}