'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DraftTeamLogo } from '@/components/draft/DraftHubState';
import {
  draftHubClubLogoStripOrder,
  draftHubHeroShellClass,
  draftHubSectionPillClass,
  draftHubSubtlePanelClass,
  draftHubHeroTopAccentClass,
  draftHubSkyPillClass,
} from '@/components/draft/draftHubChrome';
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
  /** RSC snapshot of the URL query — must match the request so SSR and first client paint agree (useSearchParams differs on the server). */
  initialSearchString: string;
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
    target.closest(
      'a, button, input, select, textarea, label, [role="button"], [data-no-row-toggle]'
    )
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
  if (summary.playerCount > 0)
    bits.push(`${summary.playerCount} player${summary.playerCount === 1 ? '' : 's'}`);
  if (summary.pickCount > 0)
    bits.push(`${summary.pickCount} pick${summary.pickCount === 1 ? '' : 's'}`);
  if (summary.futurePickCount > 0) {
    bits.push(`${summary.futurePickCount} future pick${summary.futurePickCount === 1 ? '' : 's'}`);
  }
  if (bits.length === 0)
    bits.push(`${summary.assetCount} asset${summary.assetCount === 1 ? '' : 's'}`);
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
  initialSearchString,
}: DraftTradesExplorerProps): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [urlHydrated, setUrlHydrated] = useState(false);

  useEffect(() => {
    setUrlHydrated(true);
  }, []);

  const liveQuery = searchParams?.toString() ?? '';
  const paramsString = useMemo(() => {
    if (!urlHydrated) return initialSearchString;
    return liveQuery.length > 0 ? liveQuery : initialSearchString;
  }, [urlHydrated, initialSearchString, liveQuery]);

  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString]);
  const selectedClub = params.get('club') ?? '';
  const expandedTradeId = params.get('trade') ?? '';
  const q = params.get('q') ?? '';
  const selectedType = params.get('type') ?? '';

  const [queryInput, setQueryInput] = useState(q);
  const [activeTradeId, setActiveTradeId] = useState('');
  const [expandedDetail, setExpandedDetail] = useState<DraftTradeDetailData | null>(
    expandedTradeId ? (detailCache.get(expandedTradeId) ?? null) : null
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
    // Keep in sync with `listDraftTradesByYear` (firestore.ts): trim/lowercase q only;
    // do not trim trade title/club strings so SSR trade list and client filter agree.
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
      const titleMatch = trade.title.toLowerCase().includes(normalizedQuery);
      const clubMatchQuery = trade.clubNames.some((name) =>
        name.toLowerCase().includes(normalizedQuery)
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

  const railNav = useMemo(() => {
    const index = filteredTrades.findIndex((trade) => trade.tradeId === expandedTradeId);
    return {
      index,
      prev: index > 0 ? (filteredTrades[index - 1] ?? null) : null,
      next:
        index >= 0 && index < filteredTrades.length - 1
          ? (filteredTrades[index + 1] ?? null)
          : null,
    };
  }, [expandedTradeId, filteredTrades]);

  const railBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expandedTradeId) return;
    const node = railBodyRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: 'auto' });
  }, [expandedTradeId]);

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
            ? (document.getElementById(`desktop-trade-row-${next.tradeId}`) ??
              document.getElementById(`mobile-trade-row-${next.tradeId}`))
            : (document.getElementById(`mobile-trade-row-${next.tradeId}`) ??
              document.getElementById(`desktop-trade-row-${next.tradeId}`));
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
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

  const hasClearableFilters = Boolean(
    selectedClub || selectedType || q || expandedTradeId || queryInput.trim().length > 0
  );

  function clearFilters() {
    setQueryInput('');
    router.replace(`${pathname}?year=${String(year)}`, { scroll: false });
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
    const next = updateSearchParam(params, 'trade', expandedTradeId === tradeId ? null : tradeId);
    replaceParams(next);
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
      <p
        key={`${keyPrefix}-${entry.clubName}`}
        className="text-xs leading-snug text-base-content/85"
      >
        <span className="font-semibold">{entry.clubName}</span>
        <span>{` receives ${formatReceiveSummary(entry)}`}</span>
      </p>
    ));
  }

  const currentYearIndex = yearOptions.indexOf(year);
  const newerYear = currentYearIndex > 0 ? yearOptions[currentYearIndex - 1] : null;
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
    ? (filteredTrades.find((trade) => trade.tradeId === expandedTradeId) ?? null)
    : null;

  return (
    <section className="space-y-6">
      <div className={draftHubHeroShellClass}>
        <div className={draftHubHeroTopAccentClass} />
        <div className="mb-5 flex flex-col gap-5 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
              Trade explorer
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              Research the AFL trade market with list and detail in sync
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Filter by season, club, and asset profile, then keep the selected trade open in the
              detail rail while you continue scanning the market. The goal is fast historical
              research without losing list context.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={draftHubSectionPillClass}>Persistent detail rail</span>
              <span className={draftHubSectionPillClass}>Season and club filters</span>
              <span className={draftHubSectionPillClass}>CSV export</span>
            </div>
            <div
              className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
              role="note"
            >
              <span>Keyboard:</span>
              <kbd className="kbd kbd-xs">j</kbd>
              <span className="text-muted-foreground/70" aria-hidden="true">
                /
              </span>
              <kbd className="kbd kbd-xs">k</kbd>
              <span>move through the index.</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <a
              href={`/api/draft-trades/export?${exportParams.toString()}`}
              className="btn btn-primary btn-sm shadow-sm"
            >
              Export CSV
            </a>
            <Link href="/draft/clubs" className="btn btn-outline btn-sm bg-background/85">
              Club directory
            </Link>
            <span className={draftHubSkyPillClass}>{`Season ${year}`}</span>
          </div>
        </div>

        <div
          className="rounded-xl bg-background/60 p-3 shadow-sm ring-1 ring-border backdrop-blur-[2px] md:p-3.5"
          aria-label="AFL club marks referenced in historical exchange data"
        >
          <p className="sr-only">
            Club logos for all current AFL teams plus Fitzroy for merged-era historical trades.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start sm:gap-2.5 md:gap-3">
            {draftHubClubLogoStripOrder.map((name) => (
              <span key={name} className="inline-flex" title={name}>
                <DraftTeamLogo
                  team={name}
                  size={28}
                  withCircle
                  decorative
                  className="bg-background"
                />
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Trades in view
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {filteredTrades.length}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Current result set after filters and search.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Clubs represented
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {filteredClubCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Distinct clubs appearing across the visible trades.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Club sides
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {filteredSummary.parties}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Total participating sides across the visible deals.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Assets moved
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {filteredSummary.assets}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Players and picks included in the visible trades.
            </p>
          </div>
        </div>

        <div className={`${draftHubSubtlePanelClass} mt-4 p-4`}>
          <div className="mb-4 flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Refine results
              </p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">Narrow the market fast</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Use season, club, type, and search together to reduce the trade index to the exact
                slice you want to inspect.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              {selectedClub || selectedType || q
                ? 'Filters are active on this result set.'
                : 'Showing the full season index.'}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-6 md:items-end">
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

            <div className="form-control">
              <span className="label-text text-sm font-medium" id="draft-trades-club-filter-label">
                Club
              </span>
              <Listbox value={selectedClub} onChange={setClub}>
                <div className="relative">
                  <ListboxButton
                    aria-labelledby="draft-trades-club-filter-label"
                    className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-100 px-2.5 text-left text-sm shadow-sm transition hover:border-base-content/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 data-[open]:border-primary/60 data-[open]:ring-2 data-[open]:ring-primary/20"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {selectedClub ? (
                        <>
                          <DraftTeamLogo
                            team={selectedClubLabel}
                            size={20}
                            withCircle
                            decorative
                            className="shrink-0 bg-background"
                          />
                          <span className="truncate">{selectedClubLabel}</span>
                        </>
                      ) : (
                        <span className="truncate text-base-content/80">All clubs</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-base-content/50" aria-hidden>
                      ▾
                    </span>
                  </ListboxButton>
                  <ListboxOptions
                    portal
                    anchor="bottom start"
                    transition
                    className="z-[120] mt-2 max-h-72 w-[var(--button-width)] min-w-[16rem] origin-top overflow-auto rounded-xl border border-border bg-popover py-1 shadow-lg ring-1 ring-border transition duration-150 ease-out [--anchor-gap:0.5rem] data-closed:scale-95 data-closed:opacity-0 focus:outline-none"
                  >
                    <ListboxOption
                      value=""
                      className={({ focus, selected }) =>
                        `flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition ${
                          focus ? 'bg-accent text-accent-foreground' : ''
                        } ${selected ? 'bg-primary/10 text-foreground' : 'text-popover-foreground'}`
                      }
                    >
                      {({ selected }) => (
                        <>
                          <span
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-base-300 bg-base-200/50 text-[10px] font-semibold text-base-content/40"
                            aria-hidden
                          >
                            —
                          </span>
                          <span className="truncate">All clubs</span>
                          <span
                            className={`ml-auto text-xs font-semibold ${
                              selected ? 'text-primary' : 'text-transparent'
                            }`}
                            aria-hidden
                          >
                            Selected
                          </span>
                        </>
                      )}
                    </ListboxOption>
                    {clubOptions.map((club) => (
                      <ListboxOption
                        key={club.slug}
                        value={club.slug}
                        className={({ focus, selected }) =>
                          `flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition ${
                            focus ? 'bg-accent text-accent-foreground' : ''
                          } ${
                            selected
                              ? 'bg-primary/10 font-semibold text-foreground'
                              : 'text-popover-foreground'
                          }`
                        }
                      >
                        {({ selected }) => (
                          <>
                            <DraftTeamLogo
                              team={club.name}
                              size={20}
                              withCircle
                              decorative
                              className="shrink-0 bg-background"
                            />
                            <span className="truncate">{club.name}</span>
                            <span
                              className={`ml-auto text-xs font-semibold ${
                                selected ? 'text-primary' : 'text-transparent'
                              }`}
                              aria-hidden
                            >
                              Selected
                            </span>
                          </>
                        )}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>

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

            <div className="form-control">
              <span className="label-text text-sm font-medium max-md:hidden" aria-hidden="true">
                &nbsp;
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm w-full shrink-0"
                onClick={clearFilters}
                disabled={!hasClearableFilters}
                aria-label="Clear club, type, search, and open trade; keep current season"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
          <span
            className={`badge ${filterBadgeClass('meta')}`}
            suppressHydrationWarning
          >{`${filteredTrades.length} trades in view`}</span>
          <span className={`badge ${filterBadgeClass('meta')}`}>{`Season ${year}`}</span>
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

      <div className="space-y-3 lg:hidden">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Mobile trade index
            </p>
            <h3 className="text-lg font-semibold text-foreground">Browse and expand in place</h3>
          </div>
          <div className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
            {`${filteredTrades.length} visible`}
          </div>
        </div>
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
              className={`rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm transition motion-safe:duration-200 ${
                isExpanded ? 'ring-1 ring-primary/30' : ''
              } ${activeTradeId === trade.tradeId ? 'border-primary/50' : ''}`}
              onMouseEnter={() => setActiveTradeId(trade.tradeId)}
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
                      <DraftTeamLogo team={clubName} size={12} withCircle />
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
                <section
                  id={`mobile-trade-panel-${trade.tradeId}`}
                  className="mt-3"
                  aria-live="polite"
                >
                  {isLoadingDetail && (
                    <div className="space-y-2">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-base-300" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-base-300" />
                      <div className="h-24 animate-pulse rounded bg-base-300" />
                    </div>
                  )}
                  {!isLoadingDetail && detailError && (
                    <p className="text-sm text-error">
                      Could not load trade details: {detailError}
                    </p>
                  )}
                  {!isLoadingDetail && !detailError && expandedDetail?.trade && (
                    <div className="rounded-lg border border-base-300 bg-base-200/30 p-2 motion-safe:transition-all motion-safe:duration-200 motion-reduce:transition-none">
                      <DraftTradeDetail
                        detail={expandedDetail}
                        showOpenFullPageLink
                        mode="inline"
                      />
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Trade index
              </p>
              <h3 className="text-xl font-semibold text-foreground">
                Scan the market with context preserved
              </h3>
              <p className="text-sm text-muted-foreground">
                Open a trade in the detail rail, then keep the index visible while you continue
                comparing the season.
              </p>
            </div>
            <div
              className="rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm"
              suppressHydrationWarning
            >
              {`${filteredTrades.length} visible`}
            </div>
          </div>

          {filteredTrades.length === 0 ? (
            <div className="rounded-2xl border border-base-300 bg-base-100 py-14 text-center text-sm text-base-content/70 shadow-sm">
              <div className="space-y-2">
                <p>No trades match the selected filters.</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={clearFilters}>
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
                    className={`rounded-2xl border bg-card p-4 shadow-sm transition duration-200 ${
                      isExpanded
                        ? 'border-primary/60 ring-2 ring-primary/20'
                        : isActive
                          ? 'border-border bg-muted/70'
                          : 'border-border hover:border-primary/30 hover:bg-muted/60'
                    }`}
                    onMouseEnter={() => {
                      setActiveTradeId(trade.tradeId);
                      prefetchTradeDetail(trade.tradeId);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
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
                        <h4 className="text-lg font-semibold leading-tight text-foreground">
                          {trade.title}
                        </h4>
                        <p className="text-sm text-muted-foreground">{summarizeTrade(trade)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className={`btn btn-sm ${isExpanded ? 'btn-primary' : 'btn-outline bg-background'}`}
                          aria-label={`${isExpanded ? 'Close details for' : 'Open details for'} ${trade.title}`}
                          onClick={() =>
                            isExpanded ? toggleExpanded(trade.tradeId) : openTrade(trade.tradeId)
                          }
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
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                          >
                            <DraftTeamLogo team={clubName} size={14} withCircle />
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

                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="rounded-xl border border-border bg-muted/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Receive snapshot
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {renderReceiveSummary(receives, `desktop-receives-${trade.tradeId}`)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-xl border border-border bg-background px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Parties
                          </p>
                          <p className="text-lg font-semibold text-foreground">
                            {trade.partyCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border bg-background px-3 py-2">
                          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Assets
                          </p>
                          <p className="text-lg font-semibold text-foreground">
                            {trade.assetCount}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside
          className="min-w-0 lg:sticky lg:top-4 lg:z-10 lg:flex lg:max-h-[calc(100dvh-2rem)] lg:flex-col lg:overflow-hidden lg:self-start"
          aria-label="Trade detail panel"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-primary/10">
            {!selectedTrade ? (
              <div className="p-4 md:p-5">
                <div className="border-b border-border pb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Detail rail
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    Open a trade to load the full breakdown
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This panel stays pinned while you move through the trade index, so you can keep
                    the detail view loaded and compare nearby deals without resetting your place.
                  </p>
                </div>
                <div className="space-y-4 pt-6">
                  <div className="rounded-2xl border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                    After you open a trade, use Prev / Next in the rail header to step through the
                    filtered list without returning to the index.
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="rounded-xl border border-border bg-muted p-3">
                      <p className="text-xs font-semibold text-foreground">Filter fast</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Use season, club, type, and search together.
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted p-3">
                      <p className="text-xs font-semibold text-foreground">
                        Scroll inside the rail
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Long trades scroll inside this panel so the list stays in view.
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted p-3">
                      <p className="text-xs font-semibold text-foreground">Deep dive</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Open the full page or export CSV from the loaded detail.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-border px-4 pb-3 pt-4 md:px-5 md:pt-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Trade detail
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Trade #{selectedTrade.seqInYear} · {year}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <div className="join">
                          <button
                            type="button"
                            className="btn btn-xs join-item btn-outline"
                            disabled={!railNav.prev}
                            onClick={() => railNav.prev && openTrade(railNav.prev.tradeId)}
                            aria-label="Previous trade in list"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs join-item btn-outline"
                            disabled={!railNav.next}
                            onClick={() => railNav.next && openTrade(railNav.next.tradeId)}
                            aria-label="Next trade in list"
                          >
                            Next
                          </button>
                        </div>
                        {railNav.index >= 0 ? (
                          <span
                            className="text-xs tabular-nums text-muted-foreground"
                            aria-live="polite"
                          >
                            {railNav.index + 1} / {filteredTrades.length}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => toggleExpanded(selectedTrade.tradeId)}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    {loadingTradeId === selectedTrade.tradeId ? (
                      <>
                        <h3 className="line-clamp-3 text-base font-semibold leading-snug text-foreground">
                          {selectedTrade.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">Loading full breakdown…</p>
                      </>
                    ) : null}
                    {!loadingTradeId && detailError ? (
                      <h3 className="line-clamp-3 text-base font-semibold leading-snug text-foreground">
                        {selectedTrade.title}
                      </h3>
                    ) : null}
                  </div>
                </div>
                <div
                  ref={railBodyRef}
                  id={`trade-panel-${selectedTrade.tradeId}`}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 md:px-5 [scrollbar-gutter:stable]"
                  aria-live="polite"
                >
                  {loadingTradeId === selectedTrade.tradeId ? (
                    <div className="space-y-2 rounded-2xl border border-base-300 bg-base-100 p-4">
                      <div className="h-4 w-1/3 animate-pulse rounded bg-base-300" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-base-300" />
                      <div className="h-40 animate-pulse rounded bg-base-300" />
                    </div>
                  ) : null}

                  {loadingTradeId !== selectedTrade.tradeId && detailError ? (
                    <div className="rounded-2xl border border-error/30 bg-error/5 p-4 text-sm text-error">
                      Could not load trade details: {detailError}
                    </div>
                  ) : null}

                  {loadingTradeId !== selectedTrade.tradeId &&
                  !detailError &&
                  expandedDetail?.trade.tradeId === selectedTrade.tradeId ? (
                    <DraftTradeDetail detail={expandedDetail} showOpenFullPageLink mode="inline" />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
