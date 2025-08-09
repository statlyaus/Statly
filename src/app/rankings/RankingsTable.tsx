'use client';

import * as React from 'react';
import type { RankingsResponse } from '@/types/players';

type Props = {
  initialData: RankingsResponse;
  defaultIncludeDE: boolean;
  defaultPerGame: boolean;
  defaultWinsorP: number;
};

type SortKey = 'rank' | 'name' | 'team' | 'games' | 'totalValue';

export default function RankingsTable({
  initialData,
  defaultIncludeDE,
  defaultPerGame,
  defaultWinsorP,
}: Props) {
  const [includeDE, setIncludeDE] = React.useState<boolean>(defaultIncludeDE);
  const [perGame, setPerGame] = React.useState<boolean>(defaultPerGame);
  const [winsorP, setWinsorP] = React.useState<number>(defaultWinsorP);
  const [data, setData] = React.useState<RankingsResponse>(initialData);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // Sorting state
  const [sortKey, setSortKey] = React.useState<SortKey>('rank');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  // Column visibility for category z-scores (start with all visible)
  const categoryKeys = React.useMemo(
    () => data.categoriesUsed ?? [],
    [data.categoriesUsed]
  );
  const [visibleCats, setVisibleCats] = React.useState<Record<string, boolean>>(
    () =>
      (data.categoriesUsed ?? []).reduce<Record<string, boolean>>((acc, c) => {
        acc[c] = true;
        return acc;
      }, {})
  );

  // Helpers
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'rank' ? 'asc' : 'desc');
    }
  };

  const sortedPlayers = React.useMemo(() => {
    const arr = [...data.players];
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'rank':
          return (a.rank - b.rank) * dir;
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'team':
          return (a.team ?? '').localeCompare(b.team ?? '') * dir;
        case 'games':
          return ((a.games ?? 0) - (b.games ?? 0)) * dir;
        case 'totalValue':
        default:
          return (a.totalValue - b.totalValue) * dir;
      }
    });
    return arr;
  }, [data.players, sortKey, sortDir]);

  // Fetch with current options
  const fetchWithOptions = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/rankings?includeDE=${includeDE ? '1' : '0'}&perGame=${
        perGame ? '1' : '0'
      }&winsorP=${winsorP}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || res.statusText);
      }
      const json = (await res.json()) as RankingsResponse;
      setData(json);

      // Reset category visibility if the set changes
      setVisibleCats((prev) => {
        const next: Record<string, boolean> = {};
        for (const c of json.categoriesUsed ?? []) {
          next[c] = prev[c] ?? true;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rankings');
    } finally {
      setLoading(false);
    }
  }, [includeDE, perGame, winsorP]);

  // CSV export of current view
  const handleDownloadCsv = React.useCallback(() => {
    const rows: string[] = [];
    const headers = [
      'Rank',
      'Player',
      'Team',
      'Games',
      'Total Value',
      ...categoryKeys.filter((c) => visibleCats[c]),
    ];
    rows.push(headers.join(','));

    for (const p of sortedPlayers) {
      const base = [
        String(p.rank),
        csvEscape(p.name),
        csvEscape(p.team ?? ''),
        String(p.games ?? ''),
        p.totalValue.toFixed(4),
      ];
      const cats = categoryKeys
        .filter((c) => visibleCats[c])
        .map((c) => formatNum(p.categoryScores[c]));
      rows.push([...base, ...cats].join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `statly-rankings-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [sortedPlayers, categoryKeys, visibleCats]);

  // Small utils
  function csvEscape(s: string): string {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
  function formatNum(n: number | undefined): string {
    return Number.isFinite(n as number) ? (n as number).toFixed(4) : '';
  }

  // UI handlers
  function onWinsorChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v >= 0 && v <= 0.05) setWinsorP(v);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <form
        className="grid gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-2 lg:grid-cols-4"
        aria-describedby="controls-help"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchWithOptions();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            id="perGame"
            type="checkbox"
            className="h-4 w-4"
            checked={perGame}
            onChange={(e) => setPerGame(e.target.checked)}
          />
        <label htmlFor="perGame" className="text-sm font-medium">
            Per‑game averages
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="includeDE"
            type="checkbox"
            className="h-4 w-4"
            checked={includeDE}
            onChange={(e) => setIncludeDE(e.target.checked)}
          />
          <label htmlFor="includeDE" className="text-sm font-medium">
            Include Disposal Efficiency %
          </label>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="winsor" className="text-sm font-medium">
            Winsor p (0–0.05)
          </label>
          <input
            id="winsor"
            type="number"
            step={0.005}
            min={0}
            max={0.05}
            value={winsorP}
            onChange={onWinsorChange}
            className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
            aria-describedby="winsor-help"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            aria-label="Refresh rankings with current options"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Download CSV
          </button>
        </div>

        <p id="controls-help" className="col-span-full text-xs text-gray-500">
          Changes are applied when you click <strong>Refresh</strong>. CSV downloads the current view.
        </p>
      </form>

      {/* Category visibility toggles */}
      {categoryKeys.length > 0 && (
        <fieldset className="rounded-xl border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium">Category columns</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {categoryKeys.map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={!!visibleCats[c]}
                  onChange={(e) =>
                    setVisibleCats((prev) => ({ ...prev, [c]: e.target.checked }))
                  }
                />
                <span className="select-none">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Status line */}
      <div role="status" aria-live="polite" className="text-xs text-gray-500">
        {loading
          ? 'Loading rankings…'
          : error
          ? `Error: ${error}`
          : `Showing ${data.players.length} players • Generated ${new Date(
              data.generatedAt
            ).toLocaleString()}`}
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-gray-200">
        <table className="min-w-[900px] w-full border-collapse">
          <caption className="sr-only">Standardised player rankings</caption>
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
            <tr>
              <ThButton
                label="Rank"
                active={sortKey === 'rank'}
                dir={sortKey === 'rank' ? sortDir : undefined}
                onClick={() => toggleSort('rank')}
              />
              <ThButton
                label="Player"
                active={sortKey === 'name'}
                dir={sortKey === 'name' ? sortDir : undefined}
                onClick={() => toggleSort('name')}
              />
              <ThButton
                label="Team"
                active={sortKey === 'team'}
                dir={sortKey === 'team' ? sortDir : undefined}
                onClick={() => toggleSort('team')}
              />
              <ThButton
                label="Games"
                active={sortKey === 'games'}
                dir={sortKey === 'games' ? sortDir : undefined}
                onClick={() => toggleSort('games')}
              />
              <ThButton
                label="Total Value"
                active={sortKey === 'totalValue'}
                dir={sortKey === 'totalValue' ? sortDir : undefined}
                onClick={() => toggleSort('totalValue')}
              />
              {categoryKeys
                .filter((c) => visibleCats[c])
                .map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-left text-xs font-semibold">
                    {c}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p) => (
              <tr key={p.id} className="odd:bg-gray-50">
                <td className="px-3 py-2 text-sm">{p.rank}</td>
                <td className="px-3 py-2 text-sm">{p.name}</td>
                <td className="px-3 py-2 text-sm">{p.team ?? ''}</td>
                <td className="px-3 py-2 text-sm">{p.games ?? ''}</td>
                <td className="px-3 py-2 text-sm">{p.totalValue.toFixed(4)}</td>
                {categoryKeys
                  .filter((c) => visibleCats[c])
                  .map((c) => (
                    <td key={c} className="px-3 py-2 text-sm">
                      {formatNum(p.categoryScores[c])}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Small header button component to keep markup tidy */
function ThButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active?: boolean;
  dir?: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-left text-xs font-semibold"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded"
        aria-label={`Sort by ${label}${active ? `, currently ${dir}` : ''}`}
      >
        <span>{label}</span>
        {active ? <SortChevron dir={dir!} /> : null}
      </button>
    </th>
  );
}

function SortChevron({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" className="inline-block">
      {dir === 'asc' ? <path d="M7 14l5-5 5 5H7z" /> : <path d="M7 10l5 5 5-5H7z" />}
    </svg>
  );
}