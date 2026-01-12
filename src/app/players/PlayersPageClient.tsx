'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { fetchApi } from '@/lib/api';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

type PlayerRow = Player & {
  ownershipStatus?: 'Owned' | 'Waiver' | 'Available';
  ownerTeam?: string;
};

type SortKey = 'name' | 'team' | 'position' | 'ownership' | 'goals' | 'kicks' | 'handballs' | 'marks' | 'tackles' | 'disposals' | 'hitouts' | 'clearances' | 'inside50s' | 'rebound50s' | 'contestedPossessions' | 'effectiveDisposals' | 'scoreInvolvements' | 'intercepts' | 'contestedMarks' | 'metresGained';

// Helper to safely extract numeric stat value
const getStatValue = (p: Player, key: string): number => {
  // Try direct property first
  const direct = (p as Record<string, unknown>)[key];
  if (typeof direct === 'number') return direct;
  
  // Try stats object
  const fromStats = p.stats?.[key];
  if (typeof fromStats === 'number') return fromStats;
  if (typeof fromStats === 'string') {
    const parsed = Number.parseFloat(fromStats);
    if (!Number.isNaN(parsed)) return parsed;
  }
  
  return 0;
};

const STAT_COLUMNS: Array<{ key: SortKey; label: string; accessor: (p: Player) => number }> = [
  { key: 'ownership', label: 'Own%', accessor: (p) => (typeof p.ownership === 'number' ? p.ownership : 0) },
  { key: 'goals', label: 'Goals', accessor: (p) => getStatValue(p, 'goals') },
  { key: 'kicks', label: 'Kicks', accessor: (p) => getStatValue(p, 'kicks') },
  { key: 'handballs', label: 'Handballs', accessor: (p) => getStatValue(p, 'handballs') },
  { key: 'disposals', label: 'Disposals', accessor: (p) => getStatValue(p, 'kicks') + getStatValue(p, 'handballs') },
  { key: 'marks', label: 'Marks', accessor: (p) => getStatValue(p, 'marks') },
  { key: 'tackles', label: 'Tackles', accessor: (p) => getStatValue(p, 'tackles') },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => getStatValue(p, 'hitouts') },
  { key: 'clearances', label: 'Clearances', accessor: (p) => getStatValue(p, 'clearances') },
  { key: 'inside50s', label: 'I50', accessor: (p) => getStatValue(p, 'inside50s') },
  { key: 'rebound50s', label: 'R50', accessor: (p) => getStatValue(p, 'rebound50s') },
  { key: 'contestedPossessions', label: 'CP', accessor: (p) => getStatValue(p, 'contestedPossessions') },
  { key: 'effectiveDisposals', label: 'ED', accessor: (p) => getStatValue(p, 'effectiveDisposals') },
  { key: 'scoreInvolvements', label: 'SI', accessor: (p) => getStatValue(p, 'scoreInvolvements') },
  { key: 'intercepts', label: 'Int', accessor: (p) => getStatValue(p, 'intercepts') },
  { key: 'contestedMarks', label: 'CM', accessor: (p) => getStatValue(p, 'contestedMarks') },
  { key: 'metresGained', label: 'MG', accessor: (p) => getStatValue(p, 'metresGained') },
];

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  const { user } = useAuth();
  const [leagueId, setLeagueId] = useLocalStorage<string>('ui.lastLeagueId', '');
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>(players as PlayerRow[]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [visibleColumns, setVisibleColumns] = useState<Set<SortKey>>(
    new Set(['ownership', 'goals', 'kicks', 'handballs', 'disposals', 'marks', 'tackles'])
  );

  // Get unique teams and positions for filters
  const teams = useMemo(() => {
    const teamSet = new Set<string>();
    playerRows.forEach((p) => {
      if (p.team) teamSet.add(p.team);
    });
    return Array.from(teamSet).sort();
  }, [playerRows]);

  const positions = useMemo(() => {
    const posSet = new Set<string>();
    playerRows.forEach((p) => {
      if (p.position) posSet.add(p.position);
    });
    return Array.from(posSet).sort();
  }, [playerRows]);

  const { leagues: userLeagues } = useUserLeagues(user?.uid);
  const selectedLeague = userLeagues.find((league) => league.id === leagueId);

  useEffect(() => {
    if (!leagueId && userLeagues.length > 0) {
      setLeagueId(userLeagues[0].id);
    }
  }, [leagueId, userLeagues, setLeagueId]);

  useEffect(() => {
    let mounted = true;
    if (!leagueId || !user) {
      setPlayerRows(players as PlayerRow[]);
      return;
    }
    (async () => {
      try {
        const response = await fetchApi(
          `players?leagueId=${encodeURIComponent(leagueId)}&limit=1000&page=1`
        );
        const list = Array.isArray(response?.players)
          ? response.players
          : Array.isArray(response?.data?.players)
            ? response.data.players
            : Array.isArray(response)
              ? response
              : [];
        if (mounted && list.length) {
          setPlayerRows(list as PlayerRow[]);
        }
      } catch {
        if (mounted) setPlayerRows(players as PlayerRow[]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [leagueId, user, players]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = playerRows.filter((p) => {
      // Search filter
      const matchesSearch =
        searchQuery === '' ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.team?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.position?.toLowerCase().includes(searchQuery.toLowerCase());

      // Team filter
      const matchesTeam = teamFilter === 'all' || p.team === teamFilter;

      // Position filter
      const matchesPosition = positionFilter === 'all' || p.position === positionFilter;

      return matchesSearch && matchesTeam && matchesPosition;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      if (sortKey === 'name') {
        aVal = a.name;
        bVal = b.name;
      } else if (sortKey === 'team') {
        aVal = a.team || '';
        bVal = b.team || '';
      } else if (sortKey === 'position') {
        aVal = a.position || '';
        bVal = b.position || '';
      } else {
        const column = STAT_COLUMNS.find((c) => c.key === sortKey);
        aVal = column ? (column.accessor(a) as number) : 0;
        bVal = column ? (column.accessor(b) as number) : 0;
      }

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDir === 'asc' ? 1 : -1;
      if (bVal == null) return sortDir === 'asc' ? -1 : 1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return filtered;
  }, [playerRows, searchQuery, teamFilter, positionFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleColumn = (key: SortKey) => {
    const newVisible = new Set(visibleColumns);
    if (newVisible.has(key)) {
      newVisible.delete(key);
    } else {
      newVisible.add(key);
    }
    setVisibleColumns(newVisible);
  };

  const renderStatus = (player: PlayerRow) => {
    const status = player.ownershipStatus
      ?? (typeof player.ownership === 'number' && player.ownership > 0 ? 'Owned' : 'Available');
    const owner = status === 'Owned' ? player.ownerTeam : undefined;
    const statusClasses =
      status === 'Owned'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : status === 'Waiver'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-slate-50 text-slate-600 border-slate-200';
    return (
      <div className="flex items-center justify-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusClasses}`}>
          {status}
        </span>
        {owner && (
          <span
            className="text-xs text-slate-500"
            title={owner}
          >
            {getTeamAbbreviation(owner)}
          </span>
        )}
      </div>
    );
  };

  const SortableHeader = ({
    columnKey,
    label,
    align = 'left',
  }: {
    columnKey: SortKey;
    label: string;
    align?: 'left' | 'center' | 'right';
  }) => {
    const isActive = sortKey === columnKey;
    const alignClass =
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
    return (
      <th
        className={`px-3 py-3 ${alignClass} text-xs font-medium text-slate-300 uppercase tracking-wider cursor-pointer hover:bg-white/10 select-none`}
        onClick={() => handleSort(columnKey)}
      >
        <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : ''}`}>
          {label}
          {isActive && (
            <span className="text-white">{sortDir === 'asc' ? '↑' : '↓'}</span>
          )}
        </div>
      </th>
    );
  };

  const totalTeams = teams.length;
  const totalPositions = positions.length;

  return (
    <main className="p-6 max-w-[1920px] mx-auto">
      <section className="rounded-2xl overflow-hidden bg-black text-white mb-6">
        <div className="px-6 py-6 border-b border-white/10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-white/60">Player Hub</p>
              <h1 className="text-3xl font-semibold mt-2 tracking-tight">All Players</h1>
              <p className="text-sm text-white/70 mt-2 max-w-xl">
                Compare form, spot injuries, and track every stat line.
              </p>
              {leagueId && (
                <p className="text-xs text-white/50 mt-2">
                  Ownership is shown for your last selected league.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                {players.length} Players
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                {totalTeams} Teams
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-wide">
                {totalPositions} Positions
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-3 bg-white/10 rounded-xl px-4 py-3 border border-white/10 backdrop-blur">
                <span className="text-white/70">🔍</span>
                <input
                  type="text"
                  placeholder="Search players, teams, positions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-white placeholder:text-white/40 focus:outline-none"
                />
              </div>
            </div>
            <div className="lg:col-span-3">
              <select
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select league</option>
                {userLeagues.map((league) => (
                  <option key={league.id} value={league.id} className="text-slate-900">
                    {league.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Teams</option>
                {teams.map((team) => (
                  <option key={team} value={team} className="text-slate-900">
                    {team}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Positions</option>
                {positions.map((pos) => (
                  <option key={pos} value={pos} className="text-slate-900">
                    {pos}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          Showing {filteredAndSortedPlayers.length} of {players.length} players
          {selectedLeague ? (
            <span className="ml-2 text-xs text-slate-400">• {selectedLeague.name}</span>
          ) : null}
        </div>
        <details className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <summary className="text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer">
            Toggle Columns
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setVisibleColumns(new Set(STAT_COLUMNS.map((col) => col.key)))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setVisibleColumns(new Set())}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Clear all
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {STAT_COLUMNS.map((col) => (
              <label key={col.key} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="rounded"
                />
                {col.label}
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-340px)] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-900/95 backdrop-blur sticky top-0 z-10">
              <tr>
                <SortableHeader columnKey="name" label="Player" />
                <SortableHeader columnKey="team" label="Team" />
                <SortableHeader columnKey="position" label="Pos" />
                <th className="px-3 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Status
                </th>
                {STAT_COLUMNS.filter((col) => visibleColumns.has(col.key)).map((col) => (
                  <SortableHeader key={col.key} columnKey={col.key} label={col.label} align="center" />
                ))}
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedPlayers.length === 0 ? (
                <tr>
                  <td colSpan={STAT_COLUMNS.filter((col) => visibleColumns.has(col.key)).length + 5} className="px-6 py-8 text-center text-gray-500">
                    No players found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredAndSortedPlayers.map((player) => (
                  <tr key={player.id} className="hover:bg-slate-50 transition-colors even:bg-slate-50/40">
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{player.name}</div>
                          {player.injury && (
                            <div className="text-xs text-red-600">⚠️ {player.injury}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-700">
                      {player.team ? (
                        <span title={player.team}>{getTeamAbbreviation(player.team)}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-700">
                      {player.position || '-'}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-700 text-center">
                      {renderStatus(player)}
                    </td>
                    {STAT_COLUMNS.filter((col) => visibleColumns.has(col.key)).map((col) => {
                      const value = col.accessor(player);
                      return (
                        <td key={col.key} className="px-3 py-4 whitespace-nowrap text-sm text-gray-700 text-center font-mono tabular-nums">
                          {value > 0 ? value.toLocaleString() : '-'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-4 whitespace-nowrap text-sm">
                      <Link
                        href={`/players/${player.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
