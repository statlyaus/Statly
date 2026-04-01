'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TeamLogo } from '@/components/TeamLogo';
import { DraftTradeDetail } from './DraftTradeDetail';

type DraftTradeHeader = {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubSlugs: string[];
  clubNames: string[];
  partyCount: number;
  assetCount: number;
  hasPlayers: boolean;
  hasPicks: boolean;
  hasFuturePicks: boolean;
  receivesByClub: Array<{
    clubSlug: string;
    clubName: string;
    assetCount: number;
    playerCount: number;
    pickCount: number;
    futurePickCount: number;
  }>;
};

type DraftTradeParty = {
  id: string;
  clubName: string;
  assetsRaw: string;
  rowOrder: number;
  expected: number | null;
  actual: number | null;
};

type DraftTradeAsset = {
  id: string;
  clubSlug: string;
  assetIndex: number;
  clubName: string;
  assetType: 'player' | 'pick' | 'future_pick' | 'unknown';
  assetText: string;
  playerName: string | null;
  draftedPlayer: string | null;
  games: number | null;
};

type DraftTradeDetailData = {
  trade: DraftTradeHeader;
  parties: DraftTradeParty[];
  assets: DraftTradeAsset[];
};

type ClubReceiveSummary = {
  clubSlug: string;
  clubName: string;
  assetCount: number;
  playerCount: number;
  pickCount: number;
  futurePickCount: number;
};

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  timestamp: string;
};

type DraftTradesExplorerProps = {
  year: number;
  yearOptions: number[];
  trades: DraftTradeHeader[];
};

const detailCache = new Map<string, DraftTradeDetailData>();
const detailRequestCache = new Map<string, Promise<DraftTradeDetailData>>();

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function buildClubOptions(trades: DraftTradeHeader[]): Array<{ slug: string; name: string }> {
  const map = new Map<string, string>();
  for (const trade of trades) {
    trade.clubSlugs.forEach((slug, index) => {
      map.set(slug, trade.clubNames[index] ?? slug);
    });
  }
  return Array.from(map.entries())
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeTrade(trade: DraftTradeHeader): string {
  const clubs = trade.clubNames.join(', ');
  return `${clubs} • ${trade.partyCount} parties • ${trade.assetCount} assets`;
}

function formatMetricLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function tradeTypeBadges(trade: DraftTradeHeader): string[] {
  const badges: string[] = [];
  if (trade.hasPlayers) badges.push('Players');
  if (trade.hasPicks) badges.push('Picks');
  if (trade.hasFuturePicks) badges.push('Future');
  return badges;
}

function tradeTypeBadgeClass(label: string): string {
  if (label === 'Players') return 'badge-success badge-outline';
  if (label === 'Picks') return 'badge-info badge-outline';
  if (label === 'Future') return 'badge-warning badge-outline';
  return 'badge-ghost';
}

function filterBadgeClass(kind: 'meta' | 'club' | 'type' | 'query'): string {
  if (kind === 'club') return 'badge-primary badge-outline';
  if (kind === 'type') return 'badge-accent badge-outline';
  if (kind === 'query') return 'badge-neutral badge-outline';
  return 'badge-outline';
}

function fallbackClubSlug(clubName: string): string {
  return clubName.trim().toLowerCase().replace(/\s+/g, '-');
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('a, button, input, select, textarea, label, [role="button"], [data-no-row-toggle]')
  );
}

function updateSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | null
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (!value) {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  return next;
}

function summarizeClubReceives(detail: DraftTradeDetailData): ClubReceiveSummary[] {
  const grouped = new Map<string, ClubReceiveSummary>();
  for (const asset of detail.assets) {
    const key = asset.clubSlug || asset.clubName || 'unknown';
    const current = grouped.get(key) ?? {
      clubSlug: asset.clubSlug || key,
      clubName: key,
      assetCount: 0,
      playerCount: 0,
      pickCount: 0,
      futurePickCount: 0,
    };
    if (current.clubName === key && asset.clubName) {
      current.clubName = asset.clubName;
    }
    current.assetCount += 1;
    if (asset.assetType === 'player') current.playerCount += 1;
    if (asset.assetType === 'pick') current.pickCount += 1;
    if (asset.assetType === 'future_pick') current.futurePickCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((a, b) => a.clubName.localeCompare(b.clubName));
}

function formatReceiveSummary(summary: ClubReceiveSummary): string {
  const bits: string[] = [];
  if (summary.playerCount > 0) bits.push(`${summary.playerCount} player${summary.playerCount === 1 ? '' : 's'}`);
  if (summary.pickCount > 0) bits.push(`${summary.pickCount} pick${summary.pickCount === 1 ? '' : 's'}`);
  if (summary.futurePickCount > 0) {
    bits.push(`${summary.futurePickCount} future pick${summary.futurePickCount === 1 ? '' : 's'}`);
  }
  if (bits.length === 0) bits.push(`${summary.assetCount} asset${summary.assetCount === 1 ? '' : 's'}`);
  return bits.join(', ');
}

function formatClubLabel(slug: string, options: Array<{ slug: string; name: string }>): string {
  return options.find((option) => option.slug === slug)?.name ?? slug;
}

function isDraftTradeDetail(value: unknown): value is DraftTradeDetailData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    trade?: { title?: unknown; seqInYear?: unknown; year?: unknown };
    parties?: unknown;
    assets?: unknown;
  };
  return (
    !!candidate.trade &&
    typeof candidate.trade.title === 'string' &&
    typeof candidate.trade.seqInYear === 'number' &&
    typeof candidate.trade.year === 'number' &&
    Array.isArray(candidate.parties) &&
    Array.isArray(candidate.assets)
  );
}

function extractTradeDetail(payload: unknown): DraftTradeDetailData | null {
  if (isDraftTradeDetail(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const wrapped = payload as Partial<ApiSuccessResponse<unknown>>;
    if (wrapped.success === true && isDraftTradeDetail(wrapped.data)) {
      return wrapped.data;
    }
  }

  return null;
}

async function requestTradeDetail(tradeId: string): Promise<DraftTradeDetailData> {
  const cached = detailCache.get(tradeId);
  if (cached) {
    return cached;
  }

  const inFlight = detailRequestCache.get(tradeId);
  if (inFlight) {
    return inFlight;
  }

  const request = fetch(`/api/draft-trades/${tradeId}`, { method: 'GET' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const json = (await response.json()) as unknown;
      const detail = extractTradeDetail(json);
      if (!detail) {
        throw new Error('Unexpected trade detail response');
      }
      detailCache.set(tradeId, detail);
      return detail;
    })
    .finally(() => {
      detailRequestCache.delete(tradeId);
    });

  detailRequestCache.set(tradeId, request);
  return request;
}

export function DraftTradesExplorer({
  year,
  yearOptions,
  trades,
}: DraftTradesExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const paramsString = searchParams?.toString() ?? '';
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString]);
  const selectedClub = params.get('club') ?? '';
  const expandedTradeId = params.get('trade') ?? '';
  const q = params.get('q') ?? '';
  const selectedType = params.get('type') ?? '';

  const [queryInput, setQueryInput] = useState(q);
  const [activeTradeId, setActiveTradeId] = useState('');
  const [expandedDetail, setExpandedDetail] = useState<DraftTradeDetailData | null>(
    expandedTradeId ? detailCache.get(expandedTradeId) ?? null : null
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingTradeId, setLoadingTradeId] = useState<string | null>(null);

  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = updateSearchParam(
        params,
        'q',
        queryInput.trim().length > 0 ? queryInput.trim() : null
      );
      if (next.toString() !== params.toString()) {
        next.delete('trade');
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [params, pathname, queryInput, router]);

  useEffect(() => {
    let isActive = true;
    if (!expandedTradeId) {
      setExpandedDetail(null);
      setDetailError(null);
      setLoadingTradeId(null);
      return;
    }

    const cached = detailCache.get(expandedTradeId);
    if (cached) {
      setExpandedDetail(cached);
      setDetailError(null);
      setLoadingTradeId(null);
      return;
    }

    async function loadDetail() {
      try {
        setLoadingTradeId(expandedTradeId);
        setDetailError(null);
        const detail = await requestTradeDetail(expandedTradeId);
        if (isActive) {
          setExpandedDetail(detail);
        }
      } catch (error) {
        if (isActive) {
          setExpandedDetail(null);
          setDetailError(error instanceof Error ? error.message : 'Failed to load trade');
        }
      } finally {
        if (isActive) {
          setLoadingTradeId((current) => (current === expandedTradeId ? null : current));
        }
      }
    }

    void loadDetail();
    return () => {
      isActive = false;
    };
  }, [expandedTradeId]);

  const clubOptions = useMemo(() => buildClubOptions(trades), [trades]);
  const filteredTrades = useMemo(() => {
    const normalizedQuery = normalizeQuery(queryInput);
    return trades.filter((trade) => {
      const clubMatch = !selectedClub || trade.clubSlugs.includes(selectedClub);
      if (!clubMatch) return false;
      const typeMatch =
        !selectedType ||
        (selectedType === 'player' && trade.hasPlayers) ||
        (selectedType === 'pick' && trade.hasPicks) ||
        (selectedType === 'future_pick' && trade.hasFuturePicks);
      if (!typeMatch) return false;
      if (!normalizedQuery) return true;
      const titleMatch = normalizeQuery(trade.title).includes(normalizedQuery);
      const clubMatchQuery = trade.clubNames.some((name) =>
        normalizeQuery(name).includes(normalizedQuery)
      );
      return titleMatch || clubMatchQuery;
    });
  }, [queryInput, selectedClub, selectedType, trades]);

  const filteredSummary = useMemo(() => {
    const totals = filteredTrades.reduce(
      (acc, trade) => {
        acc.parties += trade.partyCount;
        acc.assets += trade.assetCount;
        return acc;
      },
      { parties: 0, assets: 0 }
    );
    return totals;
  }, [filteredTrades]);
  const filteredClubCount = useMemo(() => {
    const clubs = new Set<string>();
    for (const trade of filteredTrades) {
      trade.clubNames.forEach((clubName) => clubs.add(clubName));
    }
    return clubs.size;
  }, [filteredTrades]);

  useEffect(() => {
    if (filteredTrades.length === 0) {
      setActiveTradeId('');
      return;
    }
    if (!activeTradeId || !filteredTrades.some((trade) => trade.tradeId === activeTradeId)) {
      setActiveTradeId(filteredTrades[0].tradeId);
    }
  }, [activeTradeId, filteredTrades]);

  useEffect(() => {
    function isTextInputTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    function onKeydown(event: KeyboardEvent) {
      if (
        isTextInputTarget(event.target) ||
        isInteractiveTarget(event.target) ||
        filteredTrades.length === 0
      ) {
        return;
      }
      const currentIndex = filteredTrades.findIndex((trade) => trade.tradeId === activeTradeId);

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const delta = event.key === 'j' ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(filteredTrades.length - 1, currentIndex + delta));
        const next = filteredTrades[nextIndex];
        if (next) {
          setActiveTradeId(next.tradeId);
          const prefersDesktop = window.matchMedia('(min-width: 768px)').matches;
          const el = prefersDesktop
            ? document.getElementById(`desktop-trade-row-${next.tradeId}`) ??
              document.getElementById(`mobile-trade-row-${next.tradeId}`)
            : document.getElementById(`mobile-trade-row-${next.tradeId}`) ??
              document.getElementById(`desktop-trade-row-${next.tradeId}`);
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && activeTradeId) {
        event.preventDefault();
        toggleExpanded(activeTradeId);
      }
    }

    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [activeTradeId, filteredTrades]);

  useEffect(() => {
    if (!expandedTradeId) return;

    let timer: number | null = null;
    const raf = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        const panel =
          document.getElementById(`trade-panel-${expandedTradeId}`) ??
          document.getElementById(`mobile-trade-panel-${expandedTradeId}`) ??
          document.getElementById(`desktop-trade-row-${expandedTradeId}`) ??
          document.getElementById(`mobile-trade-row-${expandedTradeId}`);
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (panel && !prefersReducedMotion) {
          panel.animate(
            [
              { opacity: 0, transform: 'translateY(6px)' },
              { opacity: 1, transform: 'translateY(0px)' },
            ],
            { duration: 190, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
        panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [expandedTradeId]);

  function replaceParams(next: URLSearchParams) {
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function setYear(nextYear: number) {
    const next = updateSearchParam(params, 'year', String(nextYear));
    next.delete('trade');
    replaceParams(next);
  }

  function setClub(nextClub: string) {
    const next = updateSearchParam(params, 'club', nextClub || null);
    next.delete('trade');
    replaceParams(next);
  }

  function setType(nextType: string) {
    const next = updateSearchParam(params, 'type', nextType || null);
    next.delete('trade');
    replaceParams(next);
  }

  function openTrade(tradeId: string) {
    const next = updateSearchParam(params, 'trade', tradeId);
    replaceParams(next);
  }

  function toggleExpanded(tradeId: string) {
    const next = updateSearchParam(
      params,
      'trade',
      expandedTradeId === tradeId ? null : tradeId
    );
    replaceParams(next);
  }

  function toggleFromContainer(target: EventTarget | null, tradeId: string) {
    if (isInteractiveTarget(target)) return;
    toggleExpanded(tradeId);
  }

  function prefetchTradeDetail(tradeId: string) {
    if (detailCache.has(tradeId) || detailRequestCache.has(tradeId)) {
      return;
    }
    void requestTradeDetail(tradeId).catch(() => {
      // Prefetch is best-effort; errors are handled on explicit expand.
    });
  }

  function renderReceiveSummary(summary: ClubReceiveSummary[] | undefined, keyPrefix: string) {
    if (summary === undefined) {
      return <p className="text-xs text-base-content/60">Open details to load receive split</p>;
    }
    if (summary.length === 0) {
      return <p className="text-xs text-base-content/60">No received assets recorded</p>;
    }
    return summary.map((entry) => (
      <p key={`${keyPrefix}-${entry.clubName}`} className="text-xs leading-snug text-base-content/85">
        <span className="font-semibold">{entry.clubName}</span> receives {formatReceiveSummary(entry)}
      </p>
    ));
  }

  const currentYearIndex = yearOptions.indexOf(year);
  const newerYear =
    currentYearIndex > 0 ? yearOptions[currentYearIndex - 1] : null;
  const olderYear =
    currentYearIndex >= 0 && currentYearIndex < yearOptions.length - 1
      ? yearOptions[currentYearIndex + 1]
      : null;
  const exportParams = new URLSearchParams();
  exportParams.set('year', String(year));
  if (selectedClub) exportParams.set('club', selectedClub);
  if (q) exportParams.set('q', q);
  if (selectedType) exportParams.set('type', selectedType);
  const selectedClubLabel = selectedClub ? formatClubLabel(selectedClub, clubOptions) : '';
  const selectedTrade = expandedTradeId
    ? filteredTrades.find((trade) => trade.tradeId === expandedTradeId) ?? null
    : null;
  const selectedTradeReceives =
    selectedTrade == null
      ? undefined
      : selectedTrade.receivesByClub.length > 0
        ? selectedTrade.receivesByClub
        : expandedDetail?.trade.tradeId === selectedTrade.tradeId
          ? summarizeClubReceives(expandedDetail)
          : undefined;

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-5 shadow-[0_24px_80px_-40px_rgba(14,165,233,0.45)] md:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary via-secondary to-primary" />
        <div className="mb-5 flex flex-col gap-5 border-b border-sky-900/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700/80">
              Historical AFL Exchange
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
              Explore every trade without losing context
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
              Filter the market by season, club, and asset profile. Open a trade, keep its full breakdown in view, and continue scanning the list without collapsing your reading flow.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Keyboard: <kbd className="kbd kbd-xs">j</kbd>/<kbd className="kbd kbd-xs">k</kbd> navigate,{' '}
              <kbd className="kbd kbd-xs">enter</kbd> expand.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <a
              href={`/api/draft-trades/export?${exportParams.toString()}`}
              className="btn btn-primary btn-sm shadow-sm"
            >
              Export CSV
            </a>
            <button
              type="button"
              className="btn btn-outline btn-sm bg-white/80"
              onClick={() => router.replace(`${pathname}?year=${year}`, { scroll: false })}
            >
              Reset filters
            </button>
            <span className="rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-sm font-semibold text-sky-800 shadow-sm">
              Season {year}
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Trades in view</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{filteredTrades.length}</p>
            <p className="mt-1 text-sm text-slate-600">Current result set after filters and search.</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Clubs represented</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{filteredClubCount}</p>
            <p className="mt-1 text-sm text-slate-600">Distinct clubs appearing across the visible trades.</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Club sides</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{filteredSummary.parties}</p>
            <p className="mt-1 text-sm text-slate-600">Total participating sides across the visible deals.</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Assets moved</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{filteredSummary.assets}</p>
            <p className="mt-1 text-sm text-slate-600">Players and picks included in the visible trades.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 md:grid-cols-5 md:items-end">
          <label className="form-control">
            <span className="label-text text-sm font-medium">Year</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => olderYear && setYear(olderYear)}
                disabled={!olderYear}
                aria-label="Go to older year"
              >
                ◀
              </button>
              <select
                className="select select-bordered select-sm w-full"
                value={String(year)}
                onChange={(event) => setYear(Number.parseInt(event.target.value, 10))}
                aria-label="Select trade year"
              >
                {yearOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => newerYear && setYear(newerYear)}
                disabled={!newerYear}
                aria-label="Go to newer year"
              >
                ▶
              </button>
            </div>
          </label>

          <label className="form-control">
            <span className="label-text text-sm font-medium">Club</span>
            <select
              className="select select-bordered select-sm w-full"
              value={selectedClub}
              onChange={(event) => setClub(event.target.value)}
              aria-label="Filter by club"
            >
              <option value="">All clubs</option>
              {clubOptions.map((club) => (
                <option key={club.slug} value={club.slug}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <span className="label-text text-sm font-medium">Type</span>
            <select
              className="select select-bordered select-sm w-full"
              value={selectedType}
              onChange={(event) => setType(event.target.value)}
              aria-label="Filter by trade type"
            >
              <option value="">All types</option>
              <option value="player">Players</option>
              <option value="pick">Picks</option>
              <option value="future_pick">Future picks</option>
            </select>
          </label>

          <label className="form-control md:col-span-2">
            <span className="label-text text-sm font-medium">Search</span>
            <input
              type="search"
              className="input input-bordered input-sm w-full"
              placeholder="Search by trade title or club..."
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
          <span className={`badge ${filterBadgeClass('meta')}`}>{filteredTrades.length} results</span>
          <span className={`badge ${filterBadgeClass('meta')}`}>Season {year}</span>
          {selectedClub && (
            <span className={`badge ${filterBadgeClass('club')}`}>Club: {selectedClubLabel}</span>
          )}
          {selectedType && (
            <span className={`badge ${filterBadgeClass('type')}`}>Type: {selectedType}</span>
          )}
          {queryInput && (
            <span className={`badge ${filterBadgeClass('query')}`}>Query: {queryInput}</span>
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {filteredTrades.map((trade) => {
          const isExpanded = expandedTradeId === trade.tradeId;
          const isLoadingDetail = isExpanded && loadingTradeId === trade.tradeId;
          const receives =
            trade.receivesByClub.length > 0
              ? trade.receivesByClub
              : isExpanded && expandedDetail?.trade.tradeId === trade.tradeId
                ? summarizeClubReceives(expandedDetail)
                : undefined;
          return (
            <article
              key={`mobile-${trade.tradeId}`}
              id={`mobile-trade-row-${trade.tradeId}`}
              className={`cursor-pointer rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm transition motion-safe:duration-200 motion-safe:active:scale-[0.995] ${
                isExpanded ? 'ring-1 ring-primary/30' : ''
              } ${activeTradeId === trade.tradeId ? 'border-primary/50' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setActiveTradeId(trade.tradeId)}
              onClick={(event) => toggleFromContainer(event.target, trade.tradeId)}
              onKeyDown={(event) => {
                if (isInteractiveTarget(event.target)) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleExpanded(trade.tradeId);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold leading-tight">{trade.title}</h3>
                    <span className="badge badge-ghost badge-xs">#{trade.seqInYear}</span>
                  </div>
                  <p className="text-xs text-base-content/70">{summarizeTrade(trade)}</p>
                  <div className="flex flex-wrap gap-1">
                    {tradeTypeBadges(trade).map((badge) => (
                      <span
                        key={`${trade.tradeId}-${badge}`}
                        className={`badge badge-xs ${tradeTypeBadgeClass(badge)}`}
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn btn-xs gap-1 rounded-full px-2 normal-case ${
                    isExpanded ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => toggleExpanded(trade.tradeId)}
                  onMouseEnter={() => prefetchTradeDetail(trade.tradeId)}
                  onFocus={() => prefetchTradeDetail(trade.tradeId)}
                  aria-expanded={isExpanded}
                  aria-controls={`mobile-trade-panel-${trade.tradeId}`}
                  aria-label={isExpanded ? `Collapse ${trade.title}` : `Expand ${trade.title}`}
                    data-no-row-toggle
                >
                  <span className="text-[11px] font-semibold">
                    {isLoadingDetail ? 'Loading' : isExpanded ? 'Hide' : 'Details'}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`text-xs leading-none transition-transform motion-safe:duration-200 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  >
                    v
                  </span>
                </button>
              </div>
              <div className="mt-2 space-y-1 rounded-md border border-base-300 bg-base-200/35 p-2">
                {renderReceiveSummary(receives, `mobile-receives-${trade.tradeId}`)}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {trade.clubNames.map((clubName, index) => {
                  const clubSlug = trade.clubSlugs[index] ?? fallbackClubSlug(clubName);
                  return (
                  <span
                    key={`mobile-${trade.tradeId}-${clubName}`}
                    className="inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-100 px-2 py-1 text-xs"
                  >
                    <TeamLogo team={clubName} size={12} withCircle />
                    <Link
                      href={`/draft/clubs/${clubSlug}`}
                      className="link link-hover no-underline"
                    >
                      {clubName}
                    </Link>
                  </span>
                  );
                })}
              </div>

              {isExpanded && (
                <section id={`mobile-trade-panel-${trade.tradeId}`} className="mt-3" aria-live="polite">
                  {isLoadingDetail && (
                    <div className="space-y-2">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-base-300" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-base-300" />
                      <div className="h-24 animate-pulse rounded bg-base-300" />
                    </div>
                  )}
                  {!isLoadingDetail && detailError && (
                    <p className="text-sm text-error">Could not load trade details: {detailError}</p>
                  )}
                  {!isLoadingDetail && !detailError && expandedDetail?.trade && (
                    <div className="rounded-lg border border-base-300 bg-base-200/30 p-2 motion-safe:transition-all motion-safe:duration-200 motion-reduce:transition-none">
                      <DraftTradeDetail detail={expandedDetail} showOpenFullPageLink mode="inline" />
                    </div>
                  )}
                </section>
              )}
            </article>
          );
        })}
        {filteredTrades.length === 0 && (
          <div className="rounded-lg border border-base-300 py-10 text-center text-sm text-base-content/70">
            No trades match the selected filters.
          </div>
        )}
      </div>

      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.72fr)]">
        <section className="min-w-0 space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Trade index</p>
              <h3 className="text-xl font-semibold text-slate-950">Scan the market</h3>
              <p className="text-sm text-slate-600">Open a trade in the detail rail and keep the list in view while you explore.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 shadow-sm">
              {filteredTrades.length} visible
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="rounded-2xl border border-base-300 bg-base-100 py-14 text-center text-sm text-base-content/70 shadow-sm">
              <div className="space-y-2">
                <p>No trades match the selected filters.</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => router.replace(`${pathname}?year=${year}`, { scroll: false })}
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTrades.map((trade) => {
                const isExpanded = expandedTradeId === trade.tradeId;
                const isActive = activeTradeId === trade.tradeId;
                const receives =
                  trade.receivesByClub.length > 0
                    ? trade.receivesByClub
                    : isExpanded && expandedDetail?.trade.tradeId === trade.tradeId
                      ? summarizeClubReceives(expandedDetail)
                      : undefined;

                return (
                  <article
                    key={`desktop-card-${trade.tradeId}`}
                    id={`desktop-trade-row-${trade.tradeId}`}
                    className={`rounded-2xl border bg-white p-4 shadow-sm transition duration-200 ${
                      isExpanded
                        ? 'border-sky-400/80 ring-2 ring-sky-200/70'
                        : isActive
                          ? 'border-slate-300 bg-slate-50/70'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                    tabIndex={0}
                    onMouseEnter={() => {
                      setActiveTradeId(trade.tradeId);
                      prefetchTradeDetail(trade.tradeId);
                    }}
                    onFocus={() => {
                      setActiveTradeId(trade.tradeId);
                      prefetchTradeDetail(trade.tradeId);
                    }}
                    onClick={(event) => {
                      if (isInteractiveTarget(event.target)) return;
                      openTrade(trade.tradeId);
                    }}
                    onKeyDown={(event) => {
                      if (isInteractiveTarget(event.target)) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openTrade(trade.tradeId);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            Trade #{trade.seqInYear}
                          </span>
                          {tradeTypeBadges(trade).map((badge) => (
                            <span
                              key={`${trade.tradeId}-card-${badge}`}
                              className={`badge badge-sm ${tradeTypeBadgeClass(badge)}`}
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                        <h4 className="text-lg font-semibold leading-tight text-slate-950">{trade.title}</h4>
                        <p className="text-sm text-slate-600">{summarizeTrade(trade)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className={`btn btn-sm ${isExpanded ? 'btn-primary' : 'btn-outline bg-white'}`}
                          onClick={() => (isExpanded ? toggleExpanded(trade.tradeId) : openTrade(trade.tradeId))}
                          data-no-row-toggle
                        >
                          {isExpanded ? 'Close' : 'Open detail'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {trade.clubNames.map((clubName, index) => {
                        const clubSlug = trade.clubSlugs[index] ?? fallbackClubSlug(clubName);
                        return (
                          <span
                            key={`desktop-card-${trade.tradeId}-${clubName}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                          >
                            <TeamLogo team={clubName} size={14} withCircle />
                            <Link href={`/draft/clubs/${clubSlug}`} className="link link-hover no-underline">
                              {clubName}
                            </Link>
                          </span>
                        );
                      })}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Receive snapshot</p>
                        <div className="mt-2 space-y-1.5">
                          {renderReceiveSummary(receives, `desktop-receives-${trade.tradeId}`)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Parties</p>
                          <p className="text-lg font-semibold text-slate-950">{trade.partyCount}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Assets</p>
                          <p className="text-lg font-semibold text-slate-950">{trade.assetCount}</p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="min-w-0">
          <div className="sticky top-24 space-y-3">
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)]">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Detail rail</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    {selectedTrade ? selectedTrade.title : 'Select a trade'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedTrade
                      ? 'Keep this panel open while you continue exploring the trade list.'
                      : 'Open any trade from the list to inspect the full club-by-club breakdown.'}
                  </p>
                </div>
                {selectedTrade ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleExpanded(selectedTrade.tradeId)}
                  >
                    Close
                  </button>
                ) : null}
              </div>

              {!selectedTrade ? (
                <div className="space-y-4 px-1 py-8">
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                    Start with any row on the left. The detail rail is designed to preserve context so users can compare multiple trades without being pushed down the page.
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Filter fast</p>
                      <p className="mt-1 text-xs text-slate-600">Use season, club, type, and search together.</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Open detail</p>
                      <p className="mt-1 text-xs text-slate-600">Keep the full breakdown anchored while scanning more trades.</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-700">Deep dive</p>
                      <p className="mt-1 text-xs text-slate-600">Jump to the full trade page or export when needed.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 pt-4" id={`trade-panel-${selectedTrade.tradeId}`} aria-live="polite">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">At a glance</p>
                    <div className="mt-2 space-y-1.5">
                      {renderReceiveSummary(selectedTradeReceives, `desktop-rail-${selectedTrade.tradeId}`)}
                    </div>
                  </div>

                  {loadingTradeId === selectedTrade.tradeId && (
                    <div className="space-y-2 rounded-2xl border border-base-300 bg-base-100 p-4">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-base-300" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-base-300" />
                      <div className="h-24 animate-pulse rounded bg-base-300" />
                    </div>
                  )}

                  {!loadingTradeId && detailError && (
                    <div className="rounded-2xl border border-error/30 bg-error/5 p-4 text-sm text-error">
                      Could not load trade details: {detailError}
                    </div>
                  )}

                  {!loadingTradeId &&
                    !detailError &&
                    expandedDetail?.trade.tradeId === selectedTrade.tradeId && (
                      <DraftTradeDetail detail={expandedDetail} showOpenFullPageLink mode="inline" />
                    )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

    </section>
  );
}
