'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Loader2, Search as MagnifyingGlassIcon } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  ScrollArea,
} from '@/components/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchApi } from '@/lib/api';
import { TeamLogo } from '@/components/TeamLogo';
import type { PlayerSearchResult } from '@/types/players';

interface PlayerSearchProps {
  placeholder?: string;
  onPlayerSelect?: (player: PlayerSearchResult) => void;
  className?: string;
  inputClassName?: string;
  showAvatar?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'minimal' | 'detailed';
  navigateToProfile?: boolean;
}

const MIN_QUERY_LENGTH = 2;

const getTeamColor = (team: string): string => {
  const teamColors: Record<string, string> = {
    Adelaide: 'bg-destructive',
    'Brisbane Lions': 'bg-warning',
    Carlton: 'bg-info',
    Collingwood: 'bg-foreground',
    Essendon: 'bg-destructive',
    Fremantle: 'bg-primary',
    Geelong: 'bg-info',
    'Gold Coast': 'bg-warning',
    GWS: 'bg-warning',
    Hawthorn: 'bg-warning',
    Melbourne: 'bg-destructive',
    'North Melbourne': 'bg-info',
    'Port Adelaide': 'bg-teal-600',
    Richmond: 'bg-warning',
    'St Kilda': 'bg-destructive',
    Sydney: 'bg-destructive',
    'West Coast': 'bg-info',
    'Western Bulldogs': 'bg-info',
  };
  return teamColors[team] || 'bg-muted';
};

export default function PlayerSearch({
  placeholder = 'Search players...',
  onPlayerSelect,
  className = '',
  inputClassName = '',
  showAvatar = true,
  size = 'md',
  variant = 'default',
  navigateToProfile = true,
}: PlayerSearchProps) {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const listboxId = useId();
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebounce(trimmedQuery, 300);
  const activeOptionId =
    selectedIndex >= 0 && selectedIndex < players.length && players[selectedIndex]
      ? `${listboxId}-option-${players[selectedIndex].id}`
      : undefined;

  const sizeClasses = {
    sm: 'text-sm py-2 px-3',
    md: 'text-base py-2.5 px-4',
    lg: 'text-lg py-3 px-5',
  };

  useEffect(() => {
    if (debouncedQuery.length >= MIN_QUERY_LENGTH) {
      setIsLoading(true);
    } else {
      abortControllerRef.current?.abort();
      setPlayers([]);
      setIsLoading(false);
      setSelectedIndex(-1);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_QUERY_LENGTH) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const searchPlayers = async () => {
      try {
        const data = (await fetchApi(`players/search?q=${encodeURIComponent(debouncedQuery)}`, {
          signal: controller.signal,
        })) as { players?: PlayerSearchResult[] };

        if (requestIdRef.current !== requestId) {
          return;
        }

        const nextPlayers = Array.isArray(data?.players) ? data.players : [];
        setPlayers(nextPlayers);
        setSelectedIndex(nextPlayers.length > 0 ? 0 : -1);
      } catch (error) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }
        setPlayers([]);
        setSelectedIndex(-1);
      } finally {
        if (!controller.signal.aborted && requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    };

    void searchPlayers();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        if (!isOpen) {
          setIsOpen(true);
        }
        if (players.length === 0) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % players.length);
        break;
      case 'ArrowUp':
        if (!isOpen || players.length === 0) return;
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? players.length - 1 : prev - 1));
        break;
      case 'Enter':
        if (!isOpen || players.length === 0) return;
        e.preventDefault();
        {
          const player = players[selectedIndex >= 0 ? selectedIndex : 0];
          if (player) {
            handlePlayerSelect(player);
          }
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handlePlayerSelect = (player: PlayerSearchResult) => {
    setQuery(player.name);
    setIsOpen(false);
    setSelectedIndex(-1);

    if (onPlayerSelect) {
      onPlayerSelect(player);
    }

    if (navigateToProfile) {
      router.push(`/players/${encodeURIComponent(player.id)}`);
    }
  };

  const handleOptionHover = (index: number) => {
    setSelectedIndex(index);
  };

  const renderPlayerItem = (player: PlayerSearchResult, index: number) => {
    const isSelected = index === selectedIndex;

    if (variant === 'minimal') {
      return (
        <div
          className={`flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-muted ${
            isSelected ? 'bg-info/10 text-info' : ''
          }`}
        >
          {player.team ? (
            <TeamLogo
              team={player.team}
              size={22}
              withCircle
              decorative
              className="mt-0.5 shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <div className="font-medium">{player.name}</div>
            <div className="text-sm text-muted-foreground">{player.team ?? '—'}</div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`w-full border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted ${
          isSelected ? 'bg-info/10 border-info/20' : ''
        }`}
      >
        <div className="flex items-center space-x-3">
          {showAvatar &&
            (player.team ? (
              <TeamLogo team={player.team} size={40} withCircle decorative className="shrink-0" />
            ) : (
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${getTeamColor(player.team ?? '')} text-sm font-semibold text-white`}
              >
                {player.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)}
              </div>
            ))}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-foreground truncate">{player.name}</h4>
              {variant === 'detailed' && (
                <span className="text-sm font-medium text-info">{player.averageScore} avg</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {player.team ? (
                showAvatar ? (
                  <span>{player.team}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <TeamLogo team={player.team} size={18} withCircle decorative />
                    <span>{player.team}</span>
                  </span>
                )
              ) : (
                <span>—</span>
              )}
              {player.position && (
                <>
                  <span>•</span>
                  <span>{player.position}</span>
                </>
              )}
              {variant === 'detailed' && (
                <>
                  <span>•</span>
                  <span>{player.totalGames} games</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <MagnifyingGlassIcon
          className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${variant === 'minimal' ? 'text-muted-foreground' : 'text-muted-foreground'}`}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          className={`
            w-full pl-10 pr-4 border rounded-lg focus:ring-2 focus:ring-info focus:border-transparent
            ${variant === 'minimal' ? 'bg-black/20 border-border text-white placeholder-gray-400' : 'border-border bg-white text-foreground'}
            ${sizeClasses[size]} ${inputClassName}
          `}
        />
      </div>

      {isOpen && (trimmedQuery.length >= MIN_QUERY_LENGTH || players.length > 0 || isLoading) && (
        <div className="absolute z-50 w-full mt-1 rounded-lg border border-border bg-white shadow-lg">
          <Command className="bg-white text-foreground">
            <ScrollArea className="max-h-96">
              <CommandList id={listboxId} role="listbox">
                {isLoading ? (
                  <div className="px-4 py-3 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-info" />
                    <span className="ml-2">Searching...</span>
                  </div>
                ) : players.length > 0 ? (
                  <CommandGroup className="p-0">
                    {players.map((player, index) => (
                      <CommandItem
                        key={player.id}
                        id={`${listboxId}-option-${player.id}`}
                        role="option"
                        aria-selected={index === selectedIndex}
                        className="block rounded-none px-0 py-0 hover:bg-transparent"
                        onMouseEnter={() => handleOptionHover(index)}
                        onClick={() => handlePlayerSelect(player)}
                      >
                        {renderPlayerItem(player, index)}
                      </CommandItem>
                    ))}
                    {players.length === 20 && (
                      <div className="border-t px-4 py-2 text-center text-sm text-muted-foreground">
                        Showing top 20 results. Refine your search for more specific results.
                      </div>
                    )}
                  </CommandGroup>
                ) : trimmedQuery.length >= MIN_QUERY_LENGTH ? (
                  <CommandEmpty>No players found for &ldquo;{query}&rdquo;</CommandEmpty>
                ) : null}
              </CommandList>
            </ScrollArea>
          </Command>
        </div>
      )}
    </div>
  );
}
