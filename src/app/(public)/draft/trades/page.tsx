import { Suspense } from 'react';

import { DraftHubState } from '@/components/draft/DraftHubState';
import { DraftTradesExplorer } from '@/components/draft/DraftTradesExplorer';
import { listDraftTradeYears, listDraftTradesByYear } from '@/lib/draftTrades/read';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

export const dynamic = 'force-dynamic';

type DraftTradesSearchParams = Record<string, string | string[] | undefined>;
type DraftTradeAssetType = 'player' | 'pick' | 'future_pick';

function DraftTradesExplorerFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading trades explorer">
      <div className="h-52 animate-pulse rounded-[1.75rem] bg-muted md:h-56" />
      <div className="h-[min(28rem,55vh)] animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function firstSearchParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseYear(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) {
    return 0;
  }
  return parsed;
}

function parseAssetType(value: string): DraftTradeAssetType | undefined {
  if (value === 'player' || value === 'pick' || value === 'future_pick') {
    return value;
  }

  return undefined;
}

function normalizeSearchParams(resolved: DraftTradesSearchParams) {
  const club = firstSearchParam(resolved.club).trim().toLowerCase();
  const q = firstSearchParam(resolved.q).trim();
  const type = parseAssetType(firstSearchParam(resolved.type).trim());
  const trade = firstSearchParam(resolved.trade).trim();
  const requestedYear = parseYear(firstSearchParam(resolved.year));

  return { club, q, requestedYear, trade, type };
}

function buildTradesSearchString({
  club,
  q,
  trade,
  type,
  year,
}: {
  club: string;
  q: string;
  trade: string;
  type?: DraftTradeAssetType;
  year?: number;
}) {
  const p = new URLSearchParams();
  if (year) p.set('year', String(year));
  if (club) p.set('club', club);
  if (q) p.set('q', q);
  if (type) p.set('type', type);
  if (trade) p.set('trade', trade);
  return p.toString();
}

export default async function DraftTradesPage({
  searchParams,
}: {
  searchParams: Promise<DraftTradesSearchParams>;
}) {
  const resolved = await searchParams;
  const { club, q, requestedYear, trade, type } = normalizeSearchParams(resolved);
  const retrySearchString = buildTradesSearchString({
    club,
    q,
    trade,
    type,
    year: requestedYear || undefined,
  });
  const retryHref = retrySearchString ? `/draft/trades?${retrySearchString}` : '/draft/trades';

  try {
    const yearOptions = await listDraftTradeYears();
    if (yearOptions.length === 0) {
      return (
        <DraftHubState
          variant="empty"
          title="No draft trade records found"
          description="The public AFL trade explorer is ready, but no trade years have been imported yet."
        />
      );
    }

    const defaultYear = yearOptions[0] ?? new Date().getFullYear();
    const year = requestedYear || defaultYear;
    const trades = await listDraftTradesByYear(year, {
      clubSlug: club || undefined,
      type,
      q: q || undefined,
    });
    const runtime = await getPublicAflTradeReadRuntime();
    const valuationTradeIds = trades.slice(0, 100).map(({ tradeId }) => tradeId);
    const [atTradeValueResponse, currentValueResponse] =
      valuationTradeIds.length === 0
        ? [null, null]
        : await Promise.all([
            runtime.valueReadService.list({
              scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
              requestedView: 'at_trade',
              tradeIds: valuationTradeIds,
              limit: valuationTradeIds.length,
              cursor: null,
            }),
            runtime.valueReadService.list({
              scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
              requestedView: 'current',
              tradeIds: valuationTradeIds,
              limit: valuationTradeIds.length,
              cursor: null,
            }),
          ]);

    const initialSearchString = buildTradesSearchString({
      club,
      q,
      trade,
      type,
      year,
    });

    return (
      <div className="space-y-4">
        <Suspense fallback={<DraftTradesExplorerFallback />}>
          <DraftTradesExplorer
            year={year}
            yearOptions={yearOptions}
            trades={trades}
            initialSearchString={initialSearchString}
            atTradeValueResponse={atTradeValueResponse}
            currentValueResponse={currentValueResponse}
          />
        </Suspense>
      </div>
    );
  } catch {
    return (
      <DraftHubState
        variant="error"
        title="Draft trade records could not be loaded"
        description="The public trade explorer is temporarily unavailable. Retry the current view to load the latest imported records."
        actionHref={retryHref}
        actionLabel="Retry trades"
      />
    );
  }
}
