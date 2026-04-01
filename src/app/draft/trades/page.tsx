import { DraftTradesExplorer } from '@/components/draft/DraftTradesExplorer';
import { listDraftTradeYears, listDraftTradesByYear } from '@/lib/draftTrades/firestore';

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

  return (
    <div className="space-y-4">
      <DraftTradesExplorer year={year} yearOptions={yearOptions} trades={trades} />
    </div>
  );
}
