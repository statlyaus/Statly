'use client';

import { useState, useMemo, useCallback } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import type { Player, Team } from '../types/players';

import {
  ArrowUpDown,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Flame,
  Info,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useRankings } from '@/app/tradecentre/RankingsContext';
import { getTeamAbbreviation } from '@/lib/teamLogos';

import TeamLogo from './TeamLogo';
import { ValueChip } from './ValueChip';

/**
 * Clip rect (%) over the hero — aligned to the CSS grass oval in `LineupStadiumBackdrop`.
 */
const FIELD_PLAY_REGION = {
  topPct: 14,
  leftPct: 4,
  widthPct: 92,
  heightPct: 58,
} as const;

function fieldPlayRegionStyle(): CSSProperties {
  return {
    top: `${FIELD_PLAY_REGION.topPct}%`,
    left: `${FIELD_PLAY_REGION.leftPct}%`,
    width: `${FIELD_PLAY_REGION.widthPct}%`,
    height: `${FIELD_PLAY_REGION.heightPct}%`,
  };
}

function fieldSlotAccentClass(position?: string): string {
  const p = position?.toUpperCase();
  if (p === 'DEF') return 'bg-[color:var(--lineup-board-def-accent)]';
  if (p === 'MID') return 'bg-[color:var(--lineup-board-mid-accent)]';
  if (p === 'RUC') return 'bg-[color:var(--lineup-board-ruc-accent)]';
  if (p === 'FWD') return 'bg-[color:var(--lineup-board-fwd-accent)]';
  return 'bg-muted-foreground';
}

const liveBoardThemeStyle = {
  '--lineup-board-page': 'rgb(2 6 23)',
  '--lineup-board-surface': 'rgb(15 23 42)',
  '--lineup-board-surface-strong': 'rgb(17 24 39)',
  '--lineup-board-surface-soft': 'rgb(15 23 42 / 0.4)',
  '--lineup-board-slot': 'rgb(2 6 23 / 0.85)',
  '--lineup-board-slot-overlay': 'rgb(2 6 23 / 0.7)',
  '--lineup-board-slot-empty': 'rgb(2 6 23 / 0.5)',
  '--lineup-board-border': 'rgb(51 65 85 / 0.8)',
  '--lineup-board-border-soft': 'rgb(51 65 85 / 0.7)',
  '--lineup-board-hover': 'rgb(15 23 42 / 0.9)',
  '--lineup-board-text': 'rgb(241 245 249)',
  '--lineup-board-text-soft': 'rgb(203 213 225)',
  '--lineup-board-text-muted': 'rgb(148 163 184)',
  '--lineup-board-text-subtle': 'rgb(100 116 139)',
  '--lineup-board-glow': 'rgb(226 232 240 / 0.1)',
  '--lineup-board-warm-glow': 'rgb(253 230 138 / 0.1)',
  '--lineup-board-def-accent': 'rgb(56 189 248)',
  '--lineup-board-mid-accent': 'rgb(52 211 153)',
  '--lineup-board-ruc-accent': 'rgb(250 204 21)',
  '--lineup-board-fwd-accent': 'rgb(248 113 113)',
  '--lineup-board-def-ring': 'rgb(56 189 248 / 0.35)',
  '--lineup-board-mid-ring': 'rgb(52 211 153 / 0.35)',
  '--lineup-board-ruc-ring': 'rgb(250 204 21 / 0.35)',
  '--lineup-board-fwd-ring': 'rgb(248 113 113 / 0.35)',
} as CSSProperties;

/**
 * Pure CSS stadium hero (Sherrin-in-clouds vibe). Avoids `next/image` + SVG quirks and never 404s.
 */
function LineupStadiumBackdrop(): ReactElement {
  const ovalTilt = { transform: 'translate(-50%, -50%) rotate(-6deg)' } satisfies CSSProperties;

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl bg-[color:var(--lineup-board-page)]"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[color:var(--lineup-board-page)]" />

      <div className="absolute left-[6%] top-[5%] h-[90px] w-[min(36%,400px)] rounded-full bg-[color:var(--lineup-board-warm-glow)] blur-[56px]" />
      <div className="absolute right-[5%] top-[4%] h-[95px] w-[min(38%,420px)] rounded-full bg-[color:var(--lineup-board-glow)] blur-[60px]" />

      <div className="absolute inset-x-[-6%] bottom-0 top-[50%] bg-white/15 blur-md" />
      <div className="absolute inset-x-0 bottom-0 h-[40%] bg-white/10 blur-3xl" />

      <div
        className="pointer-events-none absolute left-1/2 top-[44%] w-[min(92%,56rem)]"
        style={ovalTilt}
      >
        <div className="relative mx-auto w-full pb-[50%]">
          <div className="absolute inset-0 rounded-[50%] border-[clamp(9px,1.2vw,14px)] border-ring shadow-[inset_0_4px_20px_rgba(0,0,0,0.35)]" />
          <div
            className="absolute inset-[clamp(7px,1vw,11px)] rounded-[50%]"
            style={{
              background: `
                radial-gradient(ellipse 85% 75% at 50% 48%, rgba(45,143,90,0.35) 0%, transparent 55%),
                linear-gradient(165deg, rgb(26,107,69) 0%, rgb(22,101,52) 28%, rgb(20,83,45) 55%, rgb(15,61,38) 100%)
              `,
              boxShadow: 'inset 0 0 100px rgba(0,0,0,0.2)',
            }}
          />
          <div className="absolute inset-[32%] rounded-[50%] border border-white/18 opacity-30" />
          <div className="absolute inset-x-[40%] top-[10%] bottom-[10%] border-x border-white/15 opacity-20" />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(ellipse 78% 72% at 50% 40%, transparent 48%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </div>
  );
}

/** AFL-style starting 18 split (6 / 6 / 2 / 4). */
type LineupGroup = 'DEF' | 'MID' | 'RUC' | 'FWD';

const LINEUP_GROUP_CAPS: Record<LineupGroup, number> = {
  DEF: 6,
  MID: 6,
  RUC: 2,
  FWD: 4,
};

const OVERFLOW_FILL_ORDER: LineupGroup[] = ['MID', 'FWD', 'DEF', 'RUC'];

function normaliseLineupGroup(player: Player): LineupGroup {
  const pos = player.position?.toUpperCase();
  if (pos === 'DEF' || pos === 'MID' || pos === 'RUC' || pos === 'FWD') {
    return pos;
  }
  return 'MID';
}

type PlacedByGroup = Record<LineupGroup, (Player | undefined)[]>;

function assignStartersToAflGrid(starters: Player[]): PlacedByGroup {
  const out: PlacedByGroup = {
    DEF: Array.from({ length: LINEUP_GROUP_CAPS.DEF }, () => undefined),
    MID: Array.from({ length: LINEUP_GROUP_CAPS.MID }, () => undefined),
    RUC: Array.from({ length: LINEUP_GROUP_CAPS.RUC }, () => undefined),
    FWD: Array.from({ length: LINEUP_GROUP_CAPS.FWD }, () => undefined),
  };
  const counts: Record<LineupGroup, number> = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };

  const tryPlace = (player: Player, group: LineupGroup): boolean => {
    const cap = LINEUP_GROUP_CAPS[group];
    if (counts[group] >= cap) return false;
    out[group][counts[group]] = player;
    counts[group]++;
    return true;
  };

  for (const player of starters.slice(0, 18)) {
    const preferred = normaliseLineupGroup(player);
    if (!tryPlace(player, preferred)) {
      for (const group of OVERFLOW_FILL_ORDER) {
        if (tryPlace(player, group)) break;
      }
    }
  }

  return out;
}

type FieldRowSpec = {
  id: string;
  sectionLabel: string | null;
  group: LineupGroup;
  slotOffset: number;
  columns: number;
};

const LINEUP_FIELD_ROW_SPECS: FieldRowSpec[] = [
  { id: 'def-a', sectionLabel: 'Defenders', group: 'DEF', slotOffset: 0, columns: 3 },
  { id: 'def-b', sectionLabel: null, group: 'DEF', slotOffset: 3, columns: 3 },
  { id: 'mid-a', sectionLabel: 'Midfielders', group: 'MID', slotOffset: 0, columns: 3 },
  { id: 'mid-b', sectionLabel: null, group: 'MID', slotOffset: 3, columns: 3 },
  { id: 'ruc', sectionLabel: 'Rucks', group: 'RUC', slotOffset: 0, columns: 2 },
  { id: 'fwd-a', sectionLabel: 'Forwards', group: 'FWD', slotOffset: 0, columns: 2 },
  { id: 'fwd-b', sectionLabel: null, group: 'FWD', slotOffset: 2, columns: 2 },
];

const LINEUP_GROUP_SECTION_RING: Record<LineupGroup, string> = {
  DEF: 'ring-[color:var(--lineup-board-def-ring)]',
  MID: 'ring-[color:var(--lineup-board-mid-ring)]',
  RUC: 'ring-[color:var(--lineup-board-ruc-ring)]',
  FWD: 'ring-[color:var(--lineup-board-fwd-ring)]',
};

function gridColsClass(columns: number): string {
  return columns === 3 ? 'grid-cols-3' : 'grid-cols-2';
}

function LineupFieldRows({
  placed,
  renderSlot,
  density = 'comfortable',
}: {
  placed: PlacedByGroup;
  renderSlot: (player: Player | undefined) => ReactElement;
  /** `field` = desktop hero: balanced rhythm + section rings. */
  density?: 'comfortable' | 'field';
}): ReactElement {
  const blockGap = density === 'field' ? 'space-y-2.5 sm:space-y-3' : 'space-y-2 sm:space-y-3';
  const gridGap = density === 'field' ? 'gap-2 sm:gap-2.5' : 'gap-2';
  const labelMb = density === 'field' ? 'mb-1.5' : 'mb-1.5';

  return (
    <div className={blockGap}>
      {LINEUP_FIELD_ROW_SPECS.map((row) => {
        const slice = placed[row.group].slice(row.slotOffset, row.slotOffset + row.columns);
        const narrowRow = row.columns === 2;
        return (
          <div key={row.id}>
            {row.sectionLabel ? (
              <div className={`${labelMb} flex justify-center`}>
                <span
                  className={
                    density === 'field'
                      ? `rounded-md bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/95 shadow-sm ring-1 backdrop-blur-sm ${LINEUP_GROUP_SECTION_RING[row.group]}`
                      : 'rounded-full bg-[color:var(--lineup-board-page)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--lineup-board-text)] shadow-[0_2px_10px_rgba(0,0,0,0.65)] ring-1 ring-white/20 sm:text-xs'
                  }
                >
                  {row.sectionLabel}
                </span>
              </div>
            ) : null}
            <div
              className={`grid ${gridGap} ${gridColsClass(row.columns)} ${narrowRow ? 'mx-auto w-full max-w-sm sm:max-w-md' : ''}`}
            >
              {slice.map((player, cellIdx) => (
                <div key={`${row.id}-cell-${cellIdx}`} className="min-w-0">
                  {renderSlot(player)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type MyTeamPanelProps = {
  team: Team | undefined;
  players: Player[];
  /** Optional: sort drafted players by highest totalValue */
  sortByValue?: boolean;
  /** Optional: callback when player is selected */
  onPlayerSelect?: (player: Player) => void;
  /** Optional: callback when team action is triggered */
  onTeamAction?: (action: string, player?: Player) => void;
  /** Optional: show advanced stats and actions */
  showAdvancedFeatures?: boolean;
  /** Optional: read-only view (hide action buttons) */
  readOnly?: boolean;
  /** When true, lineup tab uses a grid only (no stadium field), for narrow or embedded panels */
  compact?: boolean;
  /** Optional: maximum height for scrollable area */
  maxHeight?: string;
  /** Optional: refresh callback */
  onRefresh?: () => void;
  /** Optional: loading state */
  isLoading?: boolean;
  className?: string;
};

type SortField = 'name' | 'position' | 'team' | 'totalValue' | 'recent' | 'ownership';
type FilterType = 'all' | 'starters' | 'bench' | 'captain' | 'injury';
type LineupSlotState = 'empty' | 'active' | 'bench' | 'emergency' | 'locked';

interface TeamStats {
  totalPlayers: number;
  totalValue: number;
  avgValue: number;
  positionBreakdown: Record<string, number>;
  captainSet: boolean;
  viceCaptainSet: boolean;
  rosterComplete: boolean;
}

type StatColumn = {
  key: string;
  label: string;
  accessor: (player: Player) => number;
};

const getStatValue = (player: Player, key: string): number => {
  const direct = (player as unknown as Record<string, unknown>)[key];
  if (typeof direct === 'number') return direct;
  const fromStats = player.stats?.[key];
  if (typeof fromStats === 'number') return fromStats;
  if (typeof fromStats === 'string') {
    const parsed = Number.parseFloat(fromStats);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const STAT_COLUMNS: StatColumn[] = [
  { key: 'goals', label: 'Goals', accessor: (p) => getStatValue(p, 'goals') },
  { key: 'kicks', label: 'Kicks', accessor: (p) => getStatValue(p, 'kicks') },
  { key: 'handballs', label: 'HB', accessor: (p) => getStatValue(p, 'handballs') },
  {
    key: 'disposals',
    label: 'Disp',
    accessor: (p) => getStatValue(p, 'kicks') + getStatValue(p, 'handballs'),
  },
  { key: 'marks', label: 'Marks', accessor: (p) => getStatValue(p, 'marks') },
  { key: 'tackles', label: 'Tackles', accessor: (p) => getStatValue(p, 'tackles') },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => getStatValue(p, 'hitouts') },
  { key: 'clearances', label: 'Clr', accessor: (p) => getStatValue(p, 'clearances') },
  { key: 'inside50s', label: 'I50', accessor: (p) => getStatValue(p, 'inside50s') },
  { key: 'rebound50s', label: 'R50', accessor: (p) => getStatValue(p, 'rebound50s') },
  {
    key: 'contestedPossessions',
    label: 'CP',
    accessor: (p) => getStatValue(p, 'contestedPossessions'),
  },
  {
    key: 'effectiveDisposals',
    label: 'ED',
    accessor: (p) => getStatValue(p, 'effectiveDisposals'),
  },
  {
    key: 'scoreInvolvements',
    label: 'SI',
    accessor: (p) => getStatValue(p, 'scoreInvolvements'),
  },
  { key: 'intercepts', label: 'Int', accessor: (p) => getStatValue(p, 'intercepts') },
  {
    key: 'contestedMarks',
    label: 'CM',
    accessor: (p) => getStatValue(p, 'contestedMarks'),
  },
  { key: 'metresGained', label: 'MG', accessor: (p) => getStatValue(p, 'metresGained') },
];

const LINEUP_CONFIG = {
  starters: 18,
  interchange: 4,
  emergency: 2,
};

const liveBoardClassName =
  'rounded-md border border-[color:var(--lineup-board-border-soft)] bg-[color:var(--lineup-board-page)] text-[color:var(--lineup-board-text)]';
const liveBoardMutedTextClassName = 'text-[color:var(--lineup-board-text-muted)]';
const liveBoardSubtleTextClassName = 'text-[color:var(--lineup-board-text-subtle)]';
const liveBoardPanelClassName =
  'rounded-2xl border border-[color:var(--lineup-board-border)] bg-[color:var(--lineup-board-surface-soft)]';
const liveBoardDividerClassName = 'h-px flex-1 bg-[color:var(--lineup-board-border)]';
const liveBoardActionButtonClassName =
  'rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80 hover:border-white/40';

// Extend Player type for captain functionality
interface ExtendedPlayer extends Player {
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  recentForm?: number;
}

function capWords(str = '') {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function capFirst(str = '') {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
}

function formatTeam(team?: string) {
  return team ? getTeamAbbreviation(team) : '—';
}

function getLeadershipState(player?: Player): 'captain' | 'vice' | null {
  if (!player) return null;
  const extPlayer = player as ExtendedPlayer;
  if (extPlayer.isCaptain) return 'captain';
  if (extPlayer.isViceCaptain) return 'vice';
  return null;
}

const MyTeamPanel = ({
  team,
  players,
  sortByValue = true,
  onPlayerSelect,
  onTeamAction,
  showAdvancedFeatures = false,
  readOnly = false,
  compact = false,
  maxHeight = '600px',
  onRefresh,
  isLoading = false,
  className = '',
}: MyTeamPanelProps): ReactElement => {
  const showPerspectiveField = !compact;
  const rankings = useRankings();
  const [sortField, setSortField] = useState<SortField>(sortByValue ? 'totalValue' : 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [viewMode, setViewMode] = useState<'lineup' | 'roster' | 'stats'>('roster');
  const [statSortKey, setStatSortKey] = useState<string>('goals');
  const [statSortDir, setStatSortDir] = useState<'asc' | 'desc'>('desc');
  const statsGridCols =
    'grid-cols-[minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_repeat(16,minmax(0,0.9fr))_minmax(0,0.9fr)_minmax(0,1.6fr)]';

  const draftedPlayers = useMemo(() => {
    if (!team) return [];
    return players.filter((p) => (team.players ?? []).map(String).includes(String(p.id)));
  }, [team, players]);

  const formatStatNumber = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(2));
  };

  const lineupPlayers = useMemo(() => draftedPlayers, [draftedPlayers]);
  const lineupSections = useMemo(() => {
    const starters = lineupPlayers.slice(0, LINEUP_CONFIG.starters);
    const interchange = lineupPlayers.slice(
      LINEUP_CONFIG.starters,
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange
    );
    const emergency = lineupPlayers.slice(
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange,
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange + LINEUP_CONFIG.emergency
    );
    return { starters, interchange, emergency };
  }, [lineupPlayers]);

  const placedFieldStarters = useMemo(
    () => assignStartersToAflGrid(lineupSections.starters),
    [lineupSections.starters]
  );

  // Calculate team statistics
  const teamStats = useMemo<TeamStats>(() => {
    const positionBreakdown: Record<string, number> = {};
    let totalValue = 0;
    let captainSet = false;
    let viceCaptainSet = false;

    draftedPlayers.forEach((player) => {
      const extPlayer = player as ExtendedPlayer;
      const position = player.position || 'UNK';
      positionBreakdown[position] = (positionBreakdown[position] || 0) + 1;

      const playerValue = rankings.get(String(player.id))?.totalValue || 0;
      totalValue += playerValue;

      if (extPlayer.isCaptain) captainSet = true;
      if (extPlayer.isViceCaptain) viceCaptainSet = true;
    });

    return {
      totalPlayers: draftedPlayers.length,
      totalValue,
      avgValue: draftedPlayers.length > 0 ? totalValue / draftedPlayers.length : 0,
      positionBreakdown,
      captainSet,
      viceCaptainSet,
      rosterComplete: draftedPlayers.length >= 22, // Standard AFL Fantasy roster
    };
  }, [draftedPlayers, rankings]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = [...draftedPlayers];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (player) =>
          player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (player.team && player.team.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (player.position && player.position.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply type filter
    switch (filterType) {
      case 'starters':
        // Assuming first 18 are starters (you'd implement proper logic)
        filtered = filtered.slice(0, 18);
        break;
      case 'bench':
        filtered = filtered.slice(18);
        break;
      case 'captain':
        filtered = filtered.filter((p) => {
          const extP = p as ExtendedPlayer;
          return extP.isCaptain || extP.isViceCaptain;
        });
        break;
      case 'injury':
        filtered = filtered.filter((p) => p.injury);
        break;
    }

    // Apply sorting
    filtered.sort((a, b) => {
      if (viewMode === 'stats') {
        const col = STAT_COLUMNS.find((c) => c.key === statSortKey);
        const aVal = col ? col.accessor(a) : 0;
        const bVal = col ? col.accessor(b) : 0;
        return statSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      let aVal: string | number, bVal: string | number;

      switch (sortField) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'position':
          aVal = a.position || 'ZZZ';
          bVal = b.position || 'ZZZ';
          break;
        case 'team':
          aVal = a.team || 'ZZZ';
          bVal = b.team || 'ZZZ';
          break;
        case 'totalValue':
          aVal = rankings.get(String(a.id))?.totalValue ?? -Infinity;
          bVal = rankings.get(String(b.id))?.totalValue ?? -Infinity;
          break;
        case 'recent':
          // Sort by recent performance (you'd implement based on your data)
          aVal = (a as ExtendedPlayer).recentForm || 0;
          bVal = (b as ExtendedPlayer).recentForm || 0;
          break;
        case 'ownership':
          aVal = typeof a.ownership === 'number' ? a.ownership : -Infinity;
          bVal = typeof b.ownership === 'number' ? b.ownership : -Infinity;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    draftedPlayers,
    searchTerm,
    filterType,
    sortField,
    sortDirection,
    rankings,
    viewMode,
    statSortKey,
    statSortDir,
  ]);

  const handleStatSort = (key: string) => {
    if (statSortKey === key) {
      setStatSortDir(statSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setStatSortKey(key);
      setStatSortDir('desc');
    }
  };

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field);
        setSortDirection('desc');
      }
    },
    [sortField, sortDirection]
  );

  const handlePlayerClick = useCallback(
    (player: Player) => {
      setSelectedPlayer(player);
      onPlayerSelect?.(player);
    },
    [onPlayerSelect]
  );

  const handlePlayerRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, player: Player) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      event.preventDefault();
      handlePlayerClick(player);
    },
    [handlePlayerClick]
  );

  const getPositionColor = (position: string) => {
    const colors = {
      DEF: 'border border-border bg-muted/40 text-muted-foreground',
      MID: 'border border-border bg-muted/40 text-muted-foreground',
      FWD: 'border border-border bg-muted/40 text-muted-foreground',
      RUC: 'border border-border bg-muted/40 text-muted-foreground',
    };
    return (
      colors[position as keyof typeof colors] ||
      'border border-border bg-muted/40 text-muted-foreground'
    );
  };

  const getPerformanceIcon = (player: Player) => {
    const value = rankings.get(String(player.id))?.totalValue || 0;
    const avgValue = teamStats.avgValue;

    if (value > avgValue * 1.2) {
      return <Star className="h-4 w-4 fill-current text-foreground" />;
    } else if (value < avgValue * 0.8) {
      return <Info className="h-4 w-4 text-muted-foreground" />;
    }
    return null;
  };

  if (!team) {
    return (
      <section aria-labelledby="team-heading" className={className}>
        <div className="rounded-md border border-border bg-card p-8 text-center text-card-foreground shadow-sm">
          <User className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <h2 id="team-heading" className="text-lg font-semibold mb-2">
            No Team Selected
          </h2>
          <p className="mb-4 text-muted-foreground">
            Join a league or create a team to get started
          </p>
          <button
            onClick={() => onTeamAction?.('create')}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            Create Team
          </button>
        </div>
      </section>
    );
  }

  const slotClasses: Record<LineupSlotState, string> = {
    empty:
      'border border-dashed border-[color:var(--lineup-board-border-soft)] bg-[color:var(--lineup-board-page)] text-[color:var(--lineup-board-text-subtle)]',
    active:
      'border border-[color:var(--lineup-board-border-soft)] bg-[color:var(--lineup-board-surface)] text-[color:var(--lineup-board-text)]',
    bench:
      'border border-[color:var(--lineup-board-border)] bg-[color:var(--lineup-board-page)] text-[color:var(--lineup-board-text-soft)]',
    emergency:
      'border border-[color:var(--lineup-board-border)] bg-[color:var(--lineup-board-page)] text-[color:var(--lineup-board-text-muted)]',
    locked:
      'border border-[color:var(--lineup-board-page)] bg-[color:var(--lineup-board-page)] text-[color:var(--lineup-board-text-subtle)]',
  };

  const renderPlayerSlot = (player: Player | undefined, state: LineupSlotState) => {
    const leadershipState = getLeadershipState(player);
    return (
      <button
        type="button"
        onClick={() => {
          if (readOnly) return;
          if (player) {
            onPlayerSelect?.(player);
          } else {
            onTeamAction?.('select');
          }
        }}
        disabled={readOnly}
        className={`flex h-[80px] w-full flex-col justify-center rounded-[10px] px-4 text-left transition ${
          slotClasses[state]
        } ${readOnly ? 'cursor-default' : 'hover:border-[color:var(--lineup-board-text-muted)]'}`}
      >
        {player ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-semibold">{player.name}</div>
              {leadershipState ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    leadershipState === 'captain'
                      ? 'bg-primary/20 text-primary-foreground ring-1 ring-ring/30'
                      : 'bg-muted/30 text-muted-foreground ring-1 ring-ring/30'
                  }`}
                >
                  {leadershipState === 'captain' ? (
                    <Trophy className="h-3 w-3" />
                  ) : (
                    <ShieldCheck className="h-3 w-3" />
                  )}
                  {leadershipState === 'captain' ? 'C' : 'VC'}
                </span>
              ) : null}
            </div>
            <div
              className={`flex min-w-0 items-center gap-1 text-[11px] font-medium uppercase tracking-[0.18em] ${liveBoardMutedTextClassName}`}
            >
              <span className="shrink-0">
                {player.position ? capFirst(player.position) : 'UNK'}
              </span>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <TeamLogo team={player.team} size={14} withCircle decorative className="shrink-0" />
              <span className="min-w-0 truncate">{formatTeam(player.team)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold">Select Player</div>
            <div
              className={`text-[11px] uppercase tracking-[0.18em] ${liveBoardSubtleTextClassName}`}
            >
              Empty Slot
            </div>
          </>
        )}
      </button>
    );
  };

  const renderLineupFieldSlot = (player: Player | undefined, opts?: { fieldPlane?: boolean }) => {
    const leadershipState = getLeadershipState(player);
    const name = player?.name ? capWords(player.name) : 'Select Player';
    const accent = fieldSlotAccentClass(player?.position);
    const isField = opts?.fieldPlane;

    return (
      <button
        type="button"
        onClick={() => {
          if (readOnly) return;
          if (player) onPlayerSelect?.(player);
          else onTeamAction?.('select');
        }}
        disabled={readOnly}
        className={[
          'group relative flex w-full flex-col justify-center overflow-hidden text-left transition',
          isField
            ? 'min-h-[4.25rem] rounded-xl border border-white/12 bg-[color:var(--lineup-board-slot)] px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md supports-[backdrop-filter]:bg-[color:var(--lineup-board-slot-overlay)]'
            : 'min-h-[4.5rem] rounded-lg border border-white/20 bg-black/55 px-2.5 py-2 shadow-[0_6px_20px_rgba(0,0,0,0.55)] backdrop-blur-[3px]',
          player
            ? 'hover:border-white/22 hover:bg-[color:var(--lineup-board-hover)]'
            : 'border-dashed border-white/18 bg-[color:var(--lineup-board-slot-empty)] hover:border-[color:var(--lineup-board-text-muted)] hover:bg-[color:var(--lineup-board-surface)]',
          readOnly ? 'cursor-default' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          className={`absolute left-0 right-0 top-0 h-[3px] ${player ? accent : 'bg-[color:var(--lineup-board-text-subtle)]'}`}
          aria-hidden
        />
        {leadershipState ? (
          <div className="mb-1 flex justify-end">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                leadershipState === 'captain'
                  ? 'bg-primary/20 text-primary-foreground ring-1 ring-ring/35'
                  : 'bg-muted/30 text-muted-foreground ring-1 ring-ring/30'
              }`}
            >
              {leadershipState === 'captain' ? (
                <Trophy className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {leadershipState === 'captain' ? 'C' : 'VC'}
            </span>
          </div>
        ) : null}
        <div
          className={`line-clamp-2 break-words font-semibold tracking-tight text-white ${
            isField ? 'text-[13px] leading-snug sm:text-sm' : 'text-xs leading-snug'
          }`}
        >
          {name}
        </div>
        <div
          className={`flex min-w-0 items-center gap-1 font-medium tabular-nums tracking-wide ${liveBoardMutedTextClassName} ${
            isField
              ? 'mt-1 text-[11px]'
              : 'mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/65'
          }`}
        >
          {player ? (
            <>
              <span className="shrink-0">
                {player.position ? capFirst(player.position) : 'UNK'}
              </span>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <TeamLogo
                team={player.team}
                size={isField ? 14 : 12}
                withCircle
                decorative
                className="shrink-0"
              />
              <span className="min-w-0 truncate">{formatTeam(player.team)}</span>
            </>
          ) : (
            'Tap to add'
          )}
        </div>
      </button>
    );
  };

  return (
    <section aria-labelledby="team-heading" className={['w-full', className].join(' ').trim()}>
      <div className="mb-16 flex h-full flex-col overflow-visible rounded-none border-0 bg-transparent shadow-none">
        {/* Header */}
        {viewMode !== 'lineup' && (
          <div className="border-b border-border bg-card px-6 py-5 text-card-foreground">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Trophy className="h-5 w-5 text-foreground" />
                <h2
                  id="team-heading"
                  className={`font-semibold ${compact ? 'text-sm' : 'text-lg'}`}
                >
                  {team.name || 'My Team'}
                </h2>
                {isLoading && (
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-muted-foreground" />
                )}
              </div>

              <div className="flex items-center gap-2">
                {onRefresh && (
                  <button
                    onClick={onRefresh}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Refresh team data"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}

                {showAdvancedFeatures && (
                  <button
                    onClick={() => setShowStats(!showStats)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Toggle team statistics"
                  >
                    <BarChart3 className="h-4 w-4" />
                    {showStats ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Team Stats Summary */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Players
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {teamStats.totalPlayers}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Value
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  ${(teamStats.totalValue / 1000000).toFixed(1)}M
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Status
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {teamStats.rosterComplete ? 'Complete' : 'Incomplete'}
                </div>
              </div>
            </div>

            {/* Expanded Stats */}
            <AnimatePresence>
              {showStats && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 border-t border-border pt-4"
                >
                  <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                    <div>
                      <h4 className="mb-2 font-medium text-foreground">Position Breakdown</h4>
                      {Object.entries(teamStats.positionBreakdown).map(([pos, count]) => (
                        <div key={pos} className="flex justify-between">
                          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {pos}
                          </span>
                          <span className="text-foreground">{count}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium text-foreground">Team Status</h4>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {teamStats.captainSet ? (
                            <Star className="h-3 w-3 fill-current text-foreground" />
                          ) : (
                            <Star className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className="text-muted-foreground">Captain</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {teamStats.viceCaptainSet ? (
                            <ShieldCheck className="h-3 w-3 text-foreground" />
                          ) : (
                            <ShieldCheck className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className="text-muted-foreground">Vice Captain</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Filters and Search */}
        {showAdvancedFeatures && draftedPlayers.length > 0 && viewMode !== 'lineup' && (
          <div className="mt-4 space-y-4 divide-y divide-border rounded-md border border-border bg-card px-6 py-5 text-card-foreground shadow-sm">
            {/* Search */}
            <div className="relative pb-2">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search players..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-full border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground shadow-sm transition focus:border-ring focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Search players"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] pt-2">
              {/* View + Filters */}
              <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2 text-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    View
                  </span>
                  {(['lineup', 'roster', 'stats'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      title={
                        mode === 'lineup'
                          ? 'Show field layout'
                          : mode === 'roster'
                            ? 'Show roster list'
                            : 'Show all stats'
                      }
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        viewMode === mode
                          ? 'bg-primary text-primary-foreground shadow'
                          : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      {mode === 'roster' ? 'Roster' : mode === 'stats' ? 'All Stats' : 'Lineup'}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Filter
                  </span>
                  {(['all', 'starters', 'bench', 'captain', 'injury'] as FilterType[]).map(
                    (filter) => (
                      <button
                        key={filter}
                        onClick={() => setFilterType(filter)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          filterType === filter
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                      >
                        {capFirst(filter)}
                      </button>
                    )
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {filteredAndSortedPlayers.length} players shown
                  </span>
                </div>
              </div>

              {/* Sort Options */}
              <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
                <div className="grid grid-cols-2 sm:grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-2 items-center text-xs">
                  <span className="col-span-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:col-span-1">
                    Sort by
                  </span>
                  {(['name', 'position', 'totalValue', 'recent'] as SortField[]).map((field) => {
                    const isActive = sortField === field;
                    const dirSymbol = isActive ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';
                    const tooltip = `Sort by ${capFirst(field)}: ${isActive ? (sortDirection === 'asc' ? 'Ascending' : 'Descending') : 'Not active'}`;
                    return (
                      <button
                        key={field}
                        onClick={() => handleSort(field)}
                        title={tooltip}
                        aria-pressed={isActive}
                        className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[11px] font-semibold shadow-sm transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isActive
                            ? 'border border-primary bg-primary text-primary-foreground shadow-md'
                            : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:shadow'
                        }`}
                      >
                        <span
                          className={`transition-transform duration-150 ${isActive && sortDirection === 'desc' ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        >
                          {dirSymbol}
                        </span>
                        <span>{capFirst(field)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Sorted by {capFirst(sortField)} (
                  {sortDirection === 'asc' ? 'Ascending' : 'Descending'}). Tap to toggle direction.
                </p>
              </div>
            </div>
          </div>
        )}
        {/* Players List */}
        <div className="flex-1 overflow-visible">
          {viewMode === 'lineup' ? (
            <div
              className={`space-y-8 overflow-visible px-6 py-6 ${liveBoardClassName}`}
              style={{ ...liveBoardThemeStyle, maxHeight }}
            >
              <div className="mx-auto w-full">
                <div className="sticky top-0 z-10 rounded-2xl border border-white/10 bg-[color:var(--lineup-board-page)] px-5 py-3 text-white shadow-[0_20px_40px_rgba(2,6,23,0.6)] backdrop-blur">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.35em] text-white/50">
                        Team Lineup
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">{team.name || 'My Team'}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/60">
                      <span>Round 1</span>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">
                        Value ${(teamStats.totalValue / 1000000).toFixed(1)}M
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <section className="space-y-3">
                <div className={`w-full px-0 py-4 ${liveBoardPanelClassName}`}>
                  <div className="flex flex-wrap items-center gap-3 px-5">
                    <h4 className="text-lg font-semibold text-white">
                      Starting {LINEUP_CONFIG.starters}
                    </h4>
                    <div className={liveBoardDividerClassName} />
                    <p className={`text-sm ${liveBoardMutedTextClassName}`}>
                      Players currently scoring
                    </p>
                  </div>
                  <div className="mt-5 px-0">
                    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                      <div className="order-2 space-y-4 lg:order-1">
                        <div
                          className={`${liveBoardPanelClassName} bg-[color:var(--lineup-board-surface)] p-4`}
                        >
                          <div className="flex items-center gap-3">
                            <h4 className="text-sm font-semibold text-white">Interchange</h4>
                            <div className={liveBoardDividerClassName} />
                            <p className={`text-xs ${liveBoardMutedTextClassName}`}>
                              Bench rotation
                            </p>
                          </div>
                          <div className="mt-4 space-y-3">
                            {Array.from({ length: LINEUP_CONFIG.interchange }).map((_, index) => {
                              const player = lineupSections.interchange[index];
                              return (
                                <div key={`bench-inline-${index}`} className="w-full">
                                  {renderPlayerSlot(player, player ? 'bench' : 'empty')}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className={`${liveBoardPanelClassName} p-4`}>
                          <div className="flex items-center gap-3">
                            <h4 className="text-sm font-semibold text-white">Emergency</h4>
                            <div className={liveBoardDividerClassName} />
                            <p className={`text-xs ${liveBoardMutedTextClassName}`}>
                              Lowest priority
                            </p>
                          </div>
                          <div className="mt-4 space-y-3">
                            {Array.from({ length: LINEUP_CONFIG.emergency }).map((_, index) => {
                              const player = lineupSections.emergency[index];
                              return (
                                <div key={`emergency-inline-${index}`} className="w-full">
                                  {renderPlayerSlot(player, player ? 'emergency' : 'empty')}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="order-1 lg:order-2">
                        <section
                          className={showPerspectiveField ? 'lg:hidden' : 'block'}
                          aria-label={`Starting lineup, ${LINEUP_CONFIG.starters} players`}
                        >
                          {showPerspectiveField ? (
                            <p
                              className={`mb-3 px-1 text-xs uppercase tracking-[0.2em] ${liveBoardSubtleTextClassName}`}
                            >
                              Field view on larger screens
                            </p>
                          ) : (
                            <p
                              className={`mb-3 px-1 text-xs uppercase tracking-[0.2em] ${liveBoardSubtleTextClassName}`}
                            >
                              Lineup grid
                            </p>
                          )}
                          <div className="rounded-xl border border-[color:var(--lineup-board-border)] bg-[color:var(--lineup-board-surface-soft)] p-3 sm:p-4">
                            <LineupFieldRows
                              placed={placedFieldStarters}
                              renderSlot={(p) => renderLineupFieldSlot(p)}
                            />
                          </div>
                        </section>

                        {showPerspectiveField ? (
                          <div className="relative hidden min-h-[920px] w-full overflow-visible rounded-2xl lg:block xl:min-h-[1000px]">
                            <LineupStadiumBackdrop />

                            <div className="pointer-events-none absolute inset-0 z-[1] bg-linear-to-b from-black/15 via-transparent to-black/32" />

                            <div
                              className="pointer-events-auto absolute z-[2] overflow-visible"
                              style={fieldPlayRegionStyle()}
                            >
                              <div className="flex h-full min-h-0 w-full items-center justify-center px-3 py-4 sm:px-4 sm:py-5">
                                <div className="w-full max-w-2xl">
                                  <LineupFieldRows
                                    density="field"
                                    placed={placedFieldStarters}
                                    renderSlot={(p) =>
                                      renderLineupFieldSlot(p, { fieldPlane: true })
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {!readOnly && (
                <div className="mt-6 border-t border-[color:var(--lineup-board-border)] bg-[color:var(--lineup-board-page)] px-6 py-4">
                  <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-white/50">Actions</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => onTeamAction?.('resetLineup')}
                        className={liveBoardActionButtonClassName}
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => onTeamAction?.('autoFillLineup')}
                        className={liveBoardActionButtonClassName}
                      >
                        Auto Fill
                      </button>
                      <button
                        onClick={() => onTeamAction?.('saveLineup')}
                        className={liveBoardActionButtonClassName}
                      >
                        Save Team
                      </button>
                      <button
                        onClick={() => onTeamAction?.('confirmLineup')}
                        className="rounded-full bg-primary px-5 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.35)] hover:bg-primary/90"
                      >
                        Confirm Lineup
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : filteredAndSortedPlayers.length === 0 ? (
            <div className="p-6 text-center">
              {draftedPlayers.length === 0 ? (
                <>
                  <UserPlus className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                  <p className="mb-4 text-muted-foreground">No players drafted yet.</p>
                  <button
                    onClick={() => onTeamAction?.('draft')}
                    className="btn btn-primary btn-sm"
                  >
                    Start Drafting
                  </button>
                </>
              ) : (
                <>
                  <Info className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-muted-foreground">No players match your filters</p>
                  <button
                    onClick={() => {
                      setSearchTerm('');
                      setFilterType('all');
                    }}
                    className="btn btn-sm btn-outline mt-2"
                  >
                    Clear Filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight }}>
              <div className="px-5 pb-1">
                <div
                  className={`grid ${
                    viewMode === 'stats'
                      ? statsGridCols
                      : 'grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.4fr)]'
                  } sticky top-0 z-10 gap-3 divide-x divide-border border-y border-border bg-muted/40 px-3 py-2 font-semibold uppercase text-muted-foreground shadow-sm ${
                    viewMode === 'stats'
                      ? 'text-[11px] tracking-[0.12em]'
                      : 'text-[12px] tracking-[0.16em]'
                  }`}
                >
                  <button
                    onClick={() => setSortField('name')}
                    className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                  >
                    Player
                  </button>
                  {viewMode === 'stats' ? (
                    <>
                      <button
                        onClick={() => setSortField('team')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Team
                      </button>
                      <button
                        onClick={() => setSortField('position')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Pos
                      </button>
                      {STAT_COLUMNS.map((col) => (
                        <button
                          key={col.key}
                          onClick={() => handleStatSort(col.key)}
                          className={`whitespace-nowrap text-left hover:text-foreground ${
                            statSortKey === col.key ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {col.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setSortField('ownership')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Own
                      </button>
                      <span className="whitespace-nowrap text-right text-muted-foreground">
                        Actions
                      </span>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setSortField('totalValue')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Value
                      </button>
                      <button
                        onClick={() => setSortField('team')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Team
                      </button>
                      <button
                        onClick={() => setSortField('position')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Pos
                      </button>
                      <button
                        onClick={() => setSortField('ownership')}
                        className="whitespace-nowrap text-left text-muted-foreground hover:text-foreground"
                      >
                        Own
                      </button>
                      <span className="whitespace-nowrap text-right text-muted-foreground">
                        Actions
                      </span>
                    </>
                  )}
                </div>
              </div>
              <ul className={`space-y-1 px-5 pb-5 ${compact ? 'text-xs' : 'text-sm'}`}>
                <AnimatePresence>
                  {filteredAndSortedPlayers.map((player, index) =>
                    (() => {
                      const leadershipState = getLeadershipState(player);
                      return (
                        <motion.li
                          key={player.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ delay: index * 0.05 }}
                          className={`rounded-md border bg-card px-4 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${
                            leadershipState === 'captain'
                              ? 'border-primary/40 bg-primary/10'
                              : leadershipState === 'vice'
                                ? 'border-border bg-muted/30'
                                : 'border-border'
                          } ${selectedPlayer?.id === player.id ? 'border-ring bg-accent/40' : ''}`}
                          onClick={() => handlePlayerClick(player)}
                          onKeyDown={(event) => handlePlayerRowKeyDown(event, player)}
                          role="button"
                          tabIndex={0}
                        >
                          <div
                            className={`grid ${
                              viewMode === 'stats'
                                ? statsGridCols
                                : 'grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.4fr)]'
                            } items-center gap-3`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <TeamLogo
                                team={player.team}
                                size={22}
                                withCircle
                                decorative
                                className="bg-background"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium">
                                    {capWords(player.name)}
                                  </span>
                                  {leadershipState ? (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                        leadershipState === 'captain'
                                          ? 'border border-primary/40 bg-primary/10 text-foreground'
                                          : 'border border-border bg-muted/40 text-muted-foreground'
                                      }`}
                                    >
                                      {leadershipState === 'captain' ? (
                                        <Trophy className="h-3 w-3" />
                                      ) : (
                                        <ShieldCheck className="h-3 w-3" />
                                      )}
                                      {leadershipState === 'captain' ? 'Captain' : 'Vice'}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              {getPerformanceIcon(player)}
                              {player.injury && (
                                <div className="tooltip tooltip-error" data-tip={player.injury}>
                                  <Info className="h-4 w-4 text-destructive" />
                                </div>
                              )}
                            </div>

                            {viewMode === 'stats' ? (
                              <>
                                <div className="flex items-center gap-1 truncate text-muted-foreground">
                                  <span title={player.team ? capWords(player.team) : undefined}>
                                    {formatTeam(player.team)}
                                  </span>
                                </div>
                                <div>
                                  {player.position ? (
                                    <span
                                      className={`badge badge-xs ${getPositionColor(player.position)}`}
                                    >
                                      {capFirst(player.position)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                                {STAT_COLUMNS.map((col) => (
                                  <div key={col.key} className="tabular-nums text-muted-foreground">
                                    {formatStatNumber(col.accessor(player))}
                                  </div>
                                ))}
                                <div className="text-muted-foreground">
                                  {typeof player.ownership === 'number'
                                    ? `${player.ownership}%`
                                    : '—'}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-xs">
                                  <ValueChip playerId={String(player.id)} compact={compact} />
                                </div>
                                <div className="truncate text-muted-foreground">
                                  <span title={player.team ? capWords(player.team) : undefined}>
                                    {formatTeam(player.team)}
                                  </span>
                                </div>
                                <div>
                                  {player.position ? (
                                    <span
                                      className={`badge badge-xs ${getPositionColor(player.position)}`}
                                    >
                                      {capFirst(player.position)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                                <div className="text-muted-foreground">
                                  {typeof player.ownership === 'number'
                                    ? `${player.ownership}%`
                                    : '—'}
                                </div>
                              </>
                            )}

                            {showAdvancedFeatures && !readOnly && (
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTeamAction?.('view', player);
                                  }}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  View
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTeamAction?.('captain', player);
                                  }}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {leadershipState === 'captain' ? 'Captain ✓' : 'Captain'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTeamAction?.('bench', player);
                                  }}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  Bench
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTeamAction?.('trade', player);
                                  }}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  Trade
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTeamAction?.('drop', player);
                                  }}
                                  className="rounded-full border border-destructive/30 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  Drop
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.li>
                      );
                    })()
                  )}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {showAdvancedFeatures && !readOnly && draftedPlayers.length > 0 && (
          <div className="border-t border-border bg-card px-6 py-4">
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => onTeamAction?.('optimize')}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Flame className="h-4 w-4" />
                Optimize
              </button>
              <button
                onClick={() => onTeamAction?.('trade')}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowUpDown className="h-4 w-4" />
                Trade
              </button>
              <button
                onClick={() => onTeamAction?.('analyze')}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BarChart3 className="h-4 w-4" />
                Analyze
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default MyTeamPanel;
