'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { useLeagueStatColumns } from '@/hooks/useLeagueStatColumns';
import { fetchApi } from '@/lib/api';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import {
  CANONICAL_STAT_KEYS,
  STAT_COLUMNS,
} from '@/lib/stats/statColumns';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

type PlayerRow = Player & {
  ownershipStatus?: 'Owned' | 'Waiver' | 'Available';
  ownerTeam?: string;
};

type SortKey = 'name' | 'team' | 'position' | 'ownership' | CanonicalStatKey;

const getStatValue = (p: Player, key: CanonicalStatKey): number => {
  const fromStats = p.stats?.[key];
  if (typeof fromStats === 'number') return fromStats;
  if (typeof fromStats === 'string') {
    const parsed = Number.parseFloat(fromStats);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const getGamesPlayed = (p: Player): number =>
  (typeof p.games === 'number' ? p.games : undefined) ?? 0;

const STAT_ACCESSORS: Record<
  CanonicalStatKey,
  (p: Player) => number
> = CANONICAL_STAT_KEYS.reduce((acc, key) => {
  acc[key] = (player: Player) => getStatValue(player, key);
  return acc;
}, {} as Record<CanonicalStatKey, (p: Player) => number>);

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  const { user } = useAuth();
  const [leagueId, setLeagueId] = useLocalStorage<string>('ui.lastLeagueId', '');
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>(players as PlayerRow[]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');

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
  const { visibleKeys, allKeys, toggleKey, defaultKeys } = useLeagueStatColumns(leagueId);

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
      } else if (sortKey === 'ownership') {
        aVal = typeof a.ownership === 'number' ? a.ownership : 0;
        bVal = typeof b.ownership === 'number' ? b.ownership : 0;
      } else {
        // player.stats should already be per-game averages - use directly
        const accessor = STAT_ACCESSORS[sortKey as CanonicalStatKey];
        aVal = accessor ? accessor(a) : 0;
        bVal = accessor ? accessor(b) : 0;
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
        <div className="text-xs text-slate-500">
          League defaults: {defaultKeys.length} columns
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {allKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleKey(key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              visibleKeys.includes(key)
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {STAT_COLUMNS[key]?.short ?? STAT_COLUMNS[key]?.label ?? key}
          </button>
        ))}
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
                <SortableHeader columnKey="ownership" label="Own%" align="center" />
                {visibleKeys.map((key) => (
                  <SortableHeader
                    key={key}
                    columnKey={key as SortKey}
                    label={STAT_COLUMNS[key]?.label ?? key}
                    align="center"
                  />
                ))}
                <th className="px-3 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedPlayers.length === 0 ? (
                <tr>
                  <td colSpan={visibleKeys.length + 6} className="px-6 py-8 text-center text-gray-500">
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
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-700 text-center font-semibold">
                      {typeof player.ownership === 'number' && Number.isFinite(player.ownership)
                        ? `${player.ownership}%`
                        : '-'}
                    </td>
                    {visibleKeys.map((key) => {
                      const statKey = key as CanonicalStatKey;
                      // player.stats should already be per-game averages (from roster aggregation)
                      // Don't divide again - use stats directly
                      const value = getStatValue(player, statKey);
                      return (
                        <td
                          key={key}
                          className="px-3 py-4 whitespace-nowrap text-sm text-gray-700 text-center font-mono tabular-nums"
                        >
                          {Number.isFinite(value) && value > 0
                            ? value.toFixed(1)
                            : '-'}
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
