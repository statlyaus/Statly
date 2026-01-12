'use client';

import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { ElementType, CSSProperties } from 'react';

import dynamic from 'next/dynamic';

import { motion, useReducedMotion } from 'framer-motion';

import type { ListChildComponentProps } from 'react-window';

// Lazy-load react-window only when needed on the client
const FixedSizeList = dynamic(() => import('react-window').then((m) => m.FixedSizeList), {
  ssr: false,
  loading: () => null,
});
const VariableSizeList = dynamic(() => import('react-window').then((m) => m.VariableSizeList), {
  ssr: false,
  loading: () => null,
});

export interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

interface TeamInjuries {
  team: string;
  players: InjuryData[];
}

export interface InjuryListDisplayProps {
  injuries: InjuryData[];
  groupByTeam?: boolean;
  // Optional override for virtualization threshold
  virtualizeThreshold?: number;
}

const INITIAL_VISIBLE_PER_TEAM = 6;
const parsedThreshold = parseInt(process.env.NEXT_PUBLIC_INJURY_VIRTUALIZE_THRESHOLD || '100');
const DEFAULT_VIRTUALIZE_THRESHOLD =
  Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : 100;
const GROUPED_VIRTUALIZE_THRESHOLD = Math.max(150, DEFAULT_VIRTUALIZE_THRESHOLD);
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 72;

// Memoized row component (outside render) for flat virtualization
type RowItemData = { items: InjuryData[]; disableMotion: boolean };
const Row = memo(({ index, style, data }: ListChildComponentProps<RowItemData>) => {
  const { items, disableMotion } = data as RowItemData;
  const injury = items[index];
  const ItemContainer: ElementType = disableMotion ? 'div' : motion.div;
  return (
    <ItemContainer
      {...(!disableMotion && {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { delay: index * 0.01 },
      })}
      style={style}
      className="p-4 border-b border-slate-200 hover:bg-slate-50 transition-colors"
      key={injury.id}
      role="listitem"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h5 className="font-medium text-slate-900">{injury.name}</h5>
            <span className="text-sm text-slate-500">({injury.team})</span>
            <div className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
              <span className="text-sm text-red-700 font-medium">{injury.injury}</span>
            </div>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Return: {injury.expectedReturn || injury.status || 'Unknown'}
            {injury.position && injury.position !== 'Unknown' && (
              <span className="ml-2 text-slate-500">• {injury.position}</span>
            )}
          </div>
        </div>
      </div>
    </ItemContainer>
  );
});
Row.displayName = 'InjuryRow';

function GroupedVirtualized({ teamGroups }: { teamGroups: TeamInjuries[] }) {
  type FlatItem =
    | { type: 'header'; team: string; count: number }
    | { type: 'row'; team: string; player: InjuryData };

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (const g of teamGroups) {
      items.push({ type: 'header', team: g.team, count: g.players.length });
      for (const p of g.players) items.push({ type: 'row', team: g.team, player: p });
    }
    return items;
  }, [teamGroups]);

  const getItemSize = useCallback(
    (index: number) => {
      return flatItems[index].type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
    },
    [flatItems]
  );

  const teamByIndex = useMemo(() => flatItems.map((it) => it.team), [flatItems]);
  const [currentTeam, setCurrentTeam] = useState<string>(teamByIndex[0] || '');
  const lastVisibleTeamRef = useRef<string>(teamByIndex[0] || '');

  const onItemsRendered = useCallback(
    (args: {
      overscanStartIndex: number;
      overscanStopIndex: number;
      visibleStartIndex: number;
      visibleStopIndex: number;
    }) => {
      const nextTeam = teamByIndex[args.visibleStartIndex];
      if (nextTeam && nextTeam !== lastVisibleTeamRef.current) {
        lastVisibleTeamRef.current = nextTeam;
        setCurrentTeam(nextTeam);
      }
    },
    [teamByIndex]
  );

  const RowVirtual = useCallback(
    ({ index, style }: { index: number; style: CSSProperties }) => {
      const item = flatItems[index];
      if (item.type === 'header') {
        return (
          <div style={style} className="bg-slate-50 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-900">{item.team}</h4>
              <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full">
                {item.count} {item.count === 1 ? 'player' : 'players'}
              </span>
            </div>
          </div>
        );
      }
      const injury = item.player;
      return (
        <div
          style={style}
          className="p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h5 className="font-medium text-slate-900">{injury.name}</h5>
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
                  <span className="text-sm text-red-700 font-medium">{injury.injury}</span>
                </div>
              </div>
              <div className="mt-1 flex items-center space-x-4 text-sm text-slate-600">
                <span className="flex items-center space-x-1">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Return: {injury.expectedReturn || injury.status || 'Unknown'}</span>
                </span>
                {injury.position && injury.position !== 'Unknown' && (
                  <span className="text-slate-500">• {injury.position}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    },
    [flatItems]
  );

  return (
    <div className="relative">
      {/* Sticky header overlay */}
      <div className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur border-b border-slate-200 px-4 py-3">
        <h4 className="font-semibold text-slate-900">{currentTeam}</h4>
      </div>
      <VariableSizeList
        height={600}
        width={'100%'}
        itemCount={flatItems.length}
        itemSize={getItemSize}
        onItemsRendered={onItemsRendered}
        overscanCount={10}
      >
        {({ index, style }: { index: number; style: CSSProperties }) => <RowVirtual index={index} style={style as CSSProperties} />}
      </VariableSizeList>
    </div>
  );
}

function GroupedNonVirtualized({
  teamGroups,
  disableMotion,
}: {
  teamGroups: TeamInjuries[];
  disableMotion: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleTeam = (team: string) => setExpanded((e) => ({ ...e, [team]: !e[team] }));

  return (
    <div className="space-y-4">
      {teamGroups.map((teamGroup, teamIndex) => {
        const players = teamGroup.players;
        const isExpanded = !!expanded[teamGroup.team];
        const visiblePlayers = isExpanded ? players : players.slice(0, INITIAL_VISIBLE_PER_TEAM);

        const Container: ElementType = disableMotion ? 'div' : motion.div;
        return (
          <Container
            key={teamGroup.team}
            {...(!disableMotion && {
              initial: { opacity: 0, y: 10 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: teamIndex * 0.05 },
            })}
            className="border border-slate-200 rounded-lg overflow-hidden"
          >
            {/* Team header */}
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-900" id={`injury-team-${teamGroup.team}`}>
                  {teamGroup.team}
                </h4>
                <div className="flex items-center gap-2">
                  <span
                    className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full"
                    aria-label={`${players.length} injured ${players.length === 1 ? 'player' : 'players'}`}
                  >
                    {players.length} {players.length === 1 ? 'player' : 'players'}
                  </span>
                  {players.length > INITIAL_VISIBLE_PER_TEAM && (
                    <button
                      type="button"
                      onClick={() => toggleTeam(teamGroup.team)}
                      className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                      aria-expanded={isExpanded}
                      aria-controls={`injury-team-list-${teamGroup.team}`}
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Players list */}
            <ul id={`injury-team-list-${teamGroup.team}`} className="divide-y divide-slate-100">
              {visiblePlayers.map((injury, playerIndex) => {
                const ItemContainer: ElementType = disableMotion ? 'li' : motion.li;
                return (
                  <ItemContainer
                    key={injury.id}
                    {...(!disableMotion && {
                      initial: { opacity: 0, x: -10 },
                      animate: { opacity: 1, x: 0 },
                      transition: { delay: teamIndex * 0.05 + playerIndex * 0.02 },
                    })}
                    className="p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h5 className="font-medium text-slate-900">{injury.name}</h5>
                          <div className="flex items-center space-x-1">
                            <span className="w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
                            <span className="text-sm text-red-700 font-medium">
                              {injury.injury}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-slate-600">
                          <span className="flex items-center space-x-1">
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <span>
                              Return: {injury.expectedReturn || injury.status || 'Unknown'}
                            </span>
                          </span>
                          {injury.position && injury.position !== 'Unknown' && (
                            <span className="text-slate-500">• {injury.position}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </ItemContainer>
                );
              })}
            </ul>
          </Container>
        );
      })}
    </div>
  );
}

function InjuryListDisplay({
  injuries,
  groupByTeam = true,
  virtualizeThreshold,
}: InjuryListDisplayProps) {
  const reduceMotion = useReducedMotion();
  const threshold = Number.isFinite(virtualizeThreshold as number)
    ? (virtualizeThreshold as number)
    : DEFAULT_VIRTUALIZE_THRESHOLD;
  const isLarge = injuries.length > threshold;
  const disableMotion = reduceMotion || isLarge;


  // Compute team groups unconditionally to satisfy Hooks rules
  const teamGroups = useMemo<TeamInjuries[]>(() => {
    if (!groupByTeam) return [];
    const t0 = performance.now?.();
    const map = new Map<string, InjuryData[]>();
    for (const injury of injuries) {
      const list = map.get(injury.team) || [];
      list.push(injury);
      map.set(injury.team, list);
    }
    const groups: TeamInjuries[] = Array.from(map.entries()).map(([team, players]) => ({
      team,
      players,
    }));
    groups.sort((a, b) => a.team.localeCompare(b.team));
    const t1 = performance.now?.();
    if (t0 && t1) console.debug('[Perf] group_by_team ms=', Math.round(t1 - t0));
    return groups;
  }, [groupByTeam, injuries]);

  if (injuries.length === 0) {
    return (
      <div className="text-center py-8">
        <div
          className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3"
          aria-hidden
        >
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h4 className="font-medium text-slate-900 mb-1">No Injuries Reported</h4>
        <p className="text-sm text-slate-600">All players are currently healthy</p>
      </div>
    );
  }

  // Grouped by team view
  if (groupByTeam) {
    const shouldVirtualizeGrouped = injuries.length > GROUPED_VIRTUALIZE_THRESHOLD;
    return shouldVirtualizeGrouped ? (
      <GroupedVirtualized teamGroups={teamGroups} />
    ) : (
      <GroupedNonVirtualized teamGroups={teamGroups} disableMotion={disableMotion} />
    );
  }

  // Flat list view (not grouped by team)
  // Virtualize when list is large
  if (isLarge) {
    const t0 = performance.now?.();
    const itemData: RowItemData = { items: injuries, disableMotion };
    const itemCount = itemData.items.length;
    const itemSize = ROW_HEIGHT; // px height per row
    const t1 = performance.now?.();
    if (t0 && t1) console.debug('[Perf] flat_virtual_setup ms=', Math.round(t1 - t0));

    const RenderRow = ({ index, style, data }: ListChildComponentProps<unknown>) => (
      <Row index={index} style={style} data={data as RowItemData} />
    );

    return (
      <div role="list" className="border border-slate-200 rounded-lg overflow-hidden">
        <FixedSizeList
          height={Math.min(600, itemCount * itemSize)}
          width={'100%'}
          itemCount={itemCount}
          itemSize={itemSize}
          itemData={itemData}
          overscanCount={10}
        >
          {RenderRow}
        </FixedSizeList>
      </div>
    );
  }

  return (
    <div className="space-y-3" role="list">
      {injuries.map((injury, index) => {
        const ItemContainer: ElementType = disableMotion ? 'div' : motion.div;
        return (
          <ItemContainer
            key={injury.id}
            {...(!disableMotion && {
              initial: { opacity: 0, y: 10 },
              animate: { opacity: 1, y: 0 },
              transition: { delay: index * 0.01 },
            })}
            className="p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            role="listitem"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h5 className="font-medium text-slate-900">{injury.name}</h5>
                  <span className="text-sm text-slate-500">({injury.team})</span>
                  <div className="flex items-center space-x-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full" aria-hidden="true" />
                    <span className="text-sm text-red-700 font-medium">{injury.injury}</span>
                  </div>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Return: {injury.expectedReturn || injury.status || 'Unknown'}
                  {injury.position && injury.position !== 'Unknown' && (
                    <span className="ml-2 text-slate-500">• {injury.position}</span>
                  )}
                </div>
              </div>
            </div>
          </ItemContainer>
        );
      })}
    </div>
  );
}

// Centralized comparator for InjuryData to avoid brittle per-field checks inline
function compareInjury(a: InjuryData, b: InjuryData): boolean {
  return (
    a.id === b.id &&
    a.team === b.team &&
    a.name === b.name &&
    a.position === b.position &&
    a.injury === b.injury &&
    a.status === b.status &&
    (a.expectedReturn || '') === (b.expectedReturn || '') &&
    (a.details || '') === (b.details || '')
  );
}

function propsAreEqual(prev: InjuryListDisplayProps, next: InjuryListDisplayProps) {
  if (prev.groupByTeam !== next.groupByTeam) return false;
  if (
    (prev.virtualizeThreshold ?? DEFAULT_VIRTUALIZE_THRESHOLD) !==
    (next.virtualizeThreshold ?? DEFAULT_VIRTUALIZE_THRESHOLD)
  )
    return false;
  const a = prev.injuries;
  const b = next.injuries;
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!compareInjury(a[i], b[i])) return false;
  }
  return true;
}

export default memo(InjuryListDisplay, propsAreEqual);
