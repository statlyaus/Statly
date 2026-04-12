import { Suspense } from 'react';

import { DraftTradesExplorer } from '@/components/draft/DraftTradesExplorer';
import { listDraftTradeYears, listDraftTradesByYear } from '@/lib/draftTrades/firestore';

function DraftTradesExplorerFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading trades explorer">
      <div className="h-52 animate-pulse rounded-[1.75rem] bg-slate-200/50 md:h-56" />
      <div className="h-[min(28rem,55vh)] animate-pulse rounded-2xl bg-slate-200/35" />
    </div>
  );
}

function parseYear(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
    return 0;
  }
  return parsed;
}

export default async function DraftTradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const yearRaw = resolved.year;
  const clubRaw = typeof resolved.club === 'string' ? resolved.club.trim().toLowerCase() : '';
  const qRaw = typeof resolved.q === 'string' ? resolved.q.trim() : '';
  const typeRaw = typeof resolved.type === 'string' ? resolved.type : '';
  const type =
    typeRaw === 'player' || typeRaw === 'pick' || typeRaw === 'future_pick' ? typeRaw : undefined;
  const requestedYear = parseYear(typeof yearRaw === 'string' ? yearRaw : undefined);
  const yearOptions = await listDraftTradeYears();
  const defaultYear = yearOptions[0] ?? new Date().getFullYear();
  const year = requestedYear || defaultYear;
  const trades = await listDraftTradesByYear(year, {
    clubSlug: clubRaw || undefined,
    type,
    q: qRaw || undefined,
  });

  const tradeRaw = typeof resolved.trade === 'string' ? resolved.trade.trim() : '';
  const initialSearchString = (() => {
    const p = new URLSearchParams();
    p.set('year', String(year));
    if (clubRaw) p.set('club', clubRaw);
    if (qRaw) p.set('q', qRaw);
    if (type) p.set('type', type);
    if (tradeRaw) p.set('trade', tradeRaw);
    return p.toString();
  })();

  return (
    <div className="space-y-4">
      <Suspense fallback={<DraftTradesExplorerFallback />}>
        <DraftTradesExplorer
          year={year}
          yearOptions={yearOptions}
          trades={trades}
          initialSearchString={initialSearchString}
        />
      </Suspense>
    </div>
  );
}
