'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useTradeStore } from '@/state/tradeStore';
import type { Player } from '@/types';

/* ---------- stat helpers (typed, no any) ---------- */

type StatBag =
  | Record<string, number | string | null | undefined>
  | undefined;

function readRaw(p: Player, key: string): unknown {
  const top = (p as unknown as Record<string, unknown>)[key];
  const bag: StatBag = p.stats;
  const inBag = bag ? bag[key] : undefined;
  return inBag ?? top;
}

function readNum(p: Player, key: string): number {
  const v = readRaw(p, key);
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- component ---------- */

export default function OfferDock() {
  const outgoing = useTradeStore((s) => s.outgoing);
  const incoming = useTradeStore((s) => s.incoming);
  const remove = useTradeStore((s) => s.remove);
  const clearAll = useTradeStore((s) => s.clearAll);

  const sums = useMemo(() => {
    const sum = (arr: Player[], k: string) =>
      Math.round(arr.reduce((t, p) => t + readNum(p, k), 0));
    return {
      outMG: sum(outgoing, 'metresGained'),
      inMG: sum(incoming, 'metresGained'),
      outClr: sum(outgoing, 'clearances'),
      inClr: sum(incoming, 'clearances'),
    };
  }, [outgoing, incoming]);

  const fairness = scoreFairness(sums);

  return (
    <aside className="rounded-xl border border-gray-800 bg-[#121821] p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-3">Offer</h3>

      <Section title="Outgoing">
        {outgoing.length === 0 && <EmptyLine text="No players" />}
        {outgoing.map((p) => (
          <Line
            key={p.id}
            name={p.name}
            href={`/players/${p.id}`}
            onRemove={() => remove('outgoing', p.id)}
          />
        ))}
      </Section>

      <Section title="Incoming">
        {incoming.length === 0 && <EmptyLine text="No players" />}
        {incoming.map((p) => (
          <Line
            key={p.id}
            name={p.name}
            href={`/players/${p.id}`}
            onRemove={() => remove('incoming', p.id)}
          />
        ))}
      </Section>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Metric label="MG Δ" value={sums.inMG - sums.outMG} />
        <Metric label="Clr Δ" value={sums.inClr - sums.outClr} />
        <Metric label="Fairness" value={fairness.label} />
      </div>

      <div className="mt-4 flex gap-2">
        <button className="flex-1 rounded-md bg-blue-600 py-2 text-white hover:bg-blue-700">
          Send offer
        </button>
        <button
          onClick={clearAll}
          className="rounded-md bg-gray-800 py-2 px-3 text-white hover:bg-gray-700"
        >
          Clear
        </button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Tip: Click a name to view details. You can fine‑tune on the player page.
      </p>
    </aside>
  );
}

/* ---------- subcomponents ---------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="text-gray-300 font-medium mb-1">{title}</div>
      <div className="rounded-lg bg-gray-900/40 border border-gray-800 divide-y divide-gray-800">
        {children}
      </div>
    </div>
  );
}

function Line({
  name,
  href,
  onRemove,
}: {
  name: string;
  href: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <Link href={href} className="truncate text-sm text-blue-300 hover:underline">
        {name}
      </Link>
      <button
        aria-label={`Remove ${name}`}
        className="text-gray-400 hover:text-white"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="px-3 py-2 text-sm text-gray-500">{text}</div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-gray-900/50 p-2">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="font-semibold tabular-nums text-gray-100">{value}</div>
    </div>
  );
}

/* ---------- fairness model ---------- */

function scoreFairness(s: { outMG: number; inMG: number; outClr: number; inClr: number }) {
  const outScore = s.outMG + 8 * s.outClr;
  const inScore = s.inMG + 8 * s.inClr;
  const delta = inScore - outScore;
  const label = delta > 30 ? 'Favors You' : delta < -30 ? 'Favors Opponent' : 'Balanced';
  return { delta, label };
}