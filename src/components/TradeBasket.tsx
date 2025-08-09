// src/components/TradeBasket.tsx
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTradeStore } from '@/state/tradeStore';
import type { Player } from '@/types';

type StatValue = string | number | null | undefined;
type StatBag = Record<string, StatValue>;

// Keep it compatible with your Player while letting us read stats safely.
type PlayerLite = Pick<Player, 'id' | 'name'> & {
  stats?: StatBag;
};

type Summary = {
  outMG: number;
  inMG: number;
  outClr: number;
  inClr: number;
};

type Side = 'incoming' | 'outgoing';

export default function TradeBasket() {
  const { outgoing, incoming, clearAll } = useTradeStore();

  const summary: Summary = useMemo(() => {
    const sum = (arr: PlayerLite[], key: string) =>
      Math.round(
        arr.reduce((total, p) => total + Number(p.stats?.[key] ?? 0), 0)
      );

    return {
      outMG: sum(outgoing as PlayerLite[], 'metresGained'),
      inMG: sum(incoming as PlayerLite[], 'metresGained'),
      outClr: sum(outgoing as PlayerLite[], 'clearances'),
      inClr: sum(incoming as PlayerLite[], 'clearances'),
    };
  }, [outgoing, incoming]);

  const fairness = scoreFairness(summary);

  return (
    <aside className="sticky top-24 h-fit rounded-xl bg-gray-800 p-4 ring-1 ring-black/10">
      <h3 className="text-lg font-semibold mb-2 text-white">Trade Basket</h3>

      <Section title="Outgoing" items={outgoing as PlayerLite[]} side="outgoing" />
      <Section title="Incoming" items={incoming as PlayerLite[]} side="incoming" />

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
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
        Tip: Click a name to view details. You can fine‑tune in the player page.
      </p>
    </aside>
  );
}

function Section({
  title,
  items,
  side,
}: {
  title: string;
  items: PlayerLite[];
  side: Side;
}) {
  const { remove } = useTradeStore();
  return (
    <div className="mb-3">
      <h4 className="text-gray-300 mb-1">{title}</h4>
      {items.length === 0 ? (
        <div className="text-gray-500 text-sm">No players</div>
      ) : (
        <ul className="space-y-1">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <Link href={`/players/${p.id}`} className="text-blue-400 hover:underline">
                {p.name}
              </Link>
              <button
                onClick={() => remove(side, p.id)}
                className="text-gray-400 hover:text-white"
                aria-label={`Remove ${p.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-gray-700/40 p-2">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

function scoreFairness(s: Summary) {
  // Toy model: weight MG 1x, CLR 8x
  const outScore = s.outMG + 8 * s.outClr;
  const inScore = s.inMG + 8 * s.inClr;
  const delta = inScore - outScore;
  const label =
    delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
  return { delta, label };
}