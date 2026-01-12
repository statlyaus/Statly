'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';

import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface Player {
  name: string;
  team: string;
  position: string;
  totalGames: number;
  averageScore: number;
  latestRound: number;
}

interface PlayerSearchProps {
  placeholder?: string;
  onPlayerSelect?: (player: Player) => void;
  className?: string;
  showAvatar?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'minimal' | 'detailed';
  navigateToProfile?: boolean;
}

const getTeamColor = (team: string): string => {
  const teamColors: Record<string, string> = {
    Adelaide: 'bg-red-500',
    'Brisbane Lions': 'bg-amber-600',
    Carlton: 'bg-blue-700',
    Collingwood: 'bg-gray-900',
    Essendon: 'bg-red-600',
    Fremantle: 'bg-purple-600',
    Geelong: 'bg-blue-800',
    'Gold Coast': 'bg-yellow-500',
    GWS: 'bg-orange-500',
    Hawthorn: 'bg-amber-700',
    Melbourne: 'bg-red-700',
    'North Melbourne': 'bg-blue-600',
    'Port Adelaide': 'bg-teal-600',
    Richmond: 'bg-yellow-600',
    'St Kilda': 'bg-red-500',
    Sydney: 'bg-red-600',
    'West Coast': 'bg-blue-500',
    'Western Bulldogs': 'bg-blue-600',
  };
  return teamColors[team] || 'bg-gray-500';
};

export default function PlayerSearch({
  placeholder = 'Search players...',
  onPlayerSelect,
  className = '',
  showAvatar = true,
  size = 'md',
  variant = 'default',
  navigateToProfile = true,
}: PlayerSearchProps) {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const sizeClasses = {
    sm: 'text-sm py-2 px-3',
    md: 'text-base py-2.5 px-4',
    lg: 'text-lg py-3 px-5',
  };

  const searchPlayers = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setPlayers([]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/players/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setPlayers(data.players || []);
    } catch (error) {
      console.error('Error searching players:', error);
      setPlayers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim()) {
      setIsLoading(true);
      // Debounce the search
      searchTimeoutRef.current = setTimeout(() => {
        searchPlayers(query);
      }, 300);
    } else {
      setPlayers([]);
      setIsLoading(false);
    }

    // Cleanup function
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, searchPlayers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || players.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % players.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? players.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < players.length) {
          handlePlayerSelect(players[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handlePlayerSelect = (player: Player) => {
    setQuery(player.name);
    setIsOpen(false);
    setSelectedIndex(-1);

    if (onPlayerSelect) {
      onPlayerSelect(player);
    }

    if (navigateToProfile) {
      router.push(`/players/${encodeURIComponent(player.name)}`);
    }
  };

  const renderPlayerItem = (player: Player, index: number) => {
    const isSelected = index === selectedIndex;

    if (variant === 'minimal') {
      return (
        <button
          key={player.name}
          className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
            isSelected ? 'bg-blue-50 text-blue-700' : ''
          }`}
          onClick={() => handlePlayerSelect(player)}
        >
          <div className="font-medium">{player.name}</div>
          <div className="text-sm text-gray-600">{player.team}</div>
        </button>
      );
    }

    return (
      <button
        key={player.name}
        className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors ${
          isSelected ? 'bg-blue-50 border-blue-200' : ''
        }`}
        onClick={() => handlePlayerSelect(player)}
      >
        <div className="flex items-center space-x-3">
          {showAvatar && (
            <div
              className={`w-10 h-10 rounded-full ${getTeamColor(player.team)} flex items-center justify-center text-white font-semibold text-sm`}
            >
              {player.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-900 truncate">{player.name}</h4>
              {variant === 'detailed' && (
                <span className="text-sm font-medium text-blue-600">{player.averageScore} avg</span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <span>{player.team}</span>
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
      </button>
    );
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <MagnifyingGlassIcon className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 ${variant === 'minimal' ? 'text-gray-300' : 'text-gray-400'}`} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={`
            w-full pl-10 pr-4 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent
            ${variant === 'minimal' ? 'bg-black/20 border-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white text-gray-900'}
            ${sizeClasses[size]} ${className}
          `}
        />
      </div>

      {isOpen && (query.length >= 2 || players.length > 0) && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto"
        >
          {isLoading ? (
            <div className="px-4 py-3 text-center text-gray-500">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto"></div>
              <span className="ml-2">Searching...</span>
            </div>
          ) : players.length > 0 ? (
            <>
              {players.map((player, index) => renderPlayerItem(player, index))}
              {players.length === 20 && (
                <div className="px-4 py-2 text-sm text-gray-500 text-center border-t">
                  Showing top 20 results. Refine your search for more specific results.
                </div>
              )}
            </>
          ) : query.length >= 2 ? (
            <div className="px-4 py-3 text-center text-gray-500">
              No players found for &ldquo;{query}&rdquo;
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
