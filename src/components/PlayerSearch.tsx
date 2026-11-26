'use client';

import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

import { floatingStyles, menuItemStyles } from '@/components/ui/controlStyles';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchApi } from '@/lib/api';
import { ClubSquare } from '@/components/ui/ClubSquare';
import { cn } from '@/lib/utils';
import type { PlayerSearchResult } from '@/types/players';
import { Spinner } from '@/components/ui/Spinner';

interface PlayerSearchProps {
  placeholder?: string;
  onPlayerSelect?: (player: PlayerSearchResult) => void;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  showAvatar?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'minimal' | 'detailed';
  navigateToProfile?: boolean;
}

const MIN_QUERY_LENGTH = 2;

export default function PlayerSearch({
  placeholder = 'Search players...',
  onPlayerSelect,
  className = '',
  inputClassName = '',
  ariaLabel = 'Search players',
  showAvatar = true,
  size = 'md',
  variant = 'default',
  navigateToProfile = true,
}: PlayerSearchProps): ReactElement {
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
      } catch {
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

  const renderPlayerItem = (player: PlayerSearchResult) => {
    if (variant === 'minimal') {
      return (
        <div className="w-full py-2">
          <div className="font-medium">{player.name}</div>
          <div className="text-sm font-normal text-muted-foreground">{player.team}</div>
        </div>
      );
    }

    return (
      <div className="w-full py-2">
        <div className="flex items-center space-x-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-foreground truncate">{player.name}</h4>
              {variant === 'detailed' && (
                <span className="text-sm font-medium text-primary">{player.averageScore} avg</span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-sm font-normal text-muted-foreground">
              {/* The club is its 13px square and abbreviation; text never sits on club colour. */}
              {showAvatar && player.team ? (
                <ClubSquare club={player.team} />
              ) : (
                <span>{player.team}</span>
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
          className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-field-placeholder`}
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
          aria-label={ariaLabel}
          className={`
            w-full pl-10 pr-4 border rounded-cut focus:ring-2 focus:ring-ring focus:border-transparent
            border-border bg-field text-field-foreground placeholder-field-placeholder
            ${sizeClasses[size]} ${inputClassName}
          `}
        />
      </div>

      {isOpen && (trimmedQuery.length >= MIN_QUERY_LENGTH || players.length > 0 || isLoading) && (
        <div className={cn(floatingStyles(), 'absolute z-50 mt-1 w-full')}>
          {/* The padding keeps square rows off the cut corners and their focus outline inside the
              scroll area. */}
          <div className="max-h-96 overflow-y-auto p-2">
            <div id={listboxId} role="listbox">
              {isLoading ? (
                <div className="px-4 py-3 text-center text-muted-foreground" role="status">
                  <Spinner size="sm" />
                  <span className="ml-2">Searching...</span>
                </div>
              ) : players.length > 0 ? (
                <div>
                  {players.map((player, index) => (
                    <button
                      key={player.id}
                      id={`${listboxId}-option-${player.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === selectedIndex}
                      className={menuItemStyles({ position: 'aria-selected' })}
                      onMouseEnter={() => handleOptionHover(index)}
                      onClick={() => handlePlayerSelect(player)}
                    >
                      {renderPlayerItem(player)}
                    </button>
                  ))}
                  {players.length === 20 && (
                    <div className="border-t px-4 py-2 text-center text-sm text-muted-foreground">
                      Showing top 20 results. Refine your search for more specific results.
                    </div>
                  )}
                </div>
              ) : trimmedQuery.length >= MIN_QUERY_LENGTH ? (
                <div className="px-4 py-3 text-sm text-muted-foreground" role="status">
                  No players found for &ldquo;{query}&rdquo;
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
