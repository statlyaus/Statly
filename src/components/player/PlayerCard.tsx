'use client';

import React, { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import Image from 'next/image';

import {
  Star as StarIcon,
  Star as StarIconSolid,
  TrendingUp as ArrowTrendingUpIcon,
  TrendingDown as ArrowTrendingDownIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import { logger } from '@/lib/logger';
import { animationPresets } from '@/styles/leagueDesignSystem';

import {
  STATUS_CONFIG,
  SIZE_CONFIG,
  CARD_STYLES,
  PRICE_CHANGE_STYLES,
  TREND_STYLES,
} from './playerCardConfig';

// Player status types
export type PlayerStatus = 'available' | 'injured' | 'suspended' | 'bye' | 'doubtful' | 'out';

// Player performance trend
export type PerformanceTrend = 'up' | 'down' | 'stable';

// Base player interface for the card
export interface PlayerCardData {
  id: string;
  name: string;
  team: string;
  position: string;
  jerseyNumber?: number;
  avatar?: string;
  status: PlayerStatus;
  isStarred?: boolean;

  // Stats
  currentPrice?: number;
  averageScore?: number;
  totalPoints?: number;
  gamesPlayed?: number;
  trend?: PerformanceTrend;

  // Recent performance
  lastGameScore?: number;
  seasonHigh?: number;
  projectedScore?: number;

  // Availability
  nextGame?: {
    opponent: string;
    date: Date;
    isHome: boolean;
  };

  // Fantasy specific
  ownership?: number; // percentage
  selectedByOpponents?: number;
  priceChange?: number;

  // Metadata
  metadata?: Record<string, unknown>;
}

// Card variant styles
export type PlayerCardVariant = 'default' | 'compact' | 'detailed' | 'selection';

// Card size options
export type PlayerCardSize = 'sm' | 'md' | 'lg';

// Component props
interface PlayerCardProps {
  player: PlayerCardData;
  variant?: PlayerCardVariant;
  size?: PlayerCardSize;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (player: PlayerCardData) => void;
  onStar?: (player: PlayerCardData) => void;
  onClick?: (player: PlayerCardData) => void;
  showStats?: boolean;
  showNextGame?: boolean;
  showOwnership?: boolean;
  className?: string;
  actions?: ReactNode;
  disabled?: boolean;
}

function PlayerCard({
  player,
  variant = 'default',
  size = 'md',
  selectable = false,
  selected = false,
  onSelect,
  onStar,
  onClick,
  showStats = true,
  showNextGame = true,
  showOwnership = false,
  className = '',
  actions,
  disabled = false,
}: PlayerCardProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const statusConfig = STATUS_CONFIG[player.status];
  const [imageError, setImageError] = useState(false);

  // Handle image error with logging and telemetry
  const handleImageError = useCallback(
    (e?: React.SyntheticEvent<HTMLImageElement> | Error) => {
      try {
        // Always mark that the image failed so UI falls back to initials
        setImageError(true);

        // Determine the image src if available
        const src =
          e && 'currentTarget' in e && e.currentTarget && (e.currentTarget as HTMLImageElement).src
            ? (e.currentTarget as HTMLImageElement).src
            : player.avatar || 'unknown';

        // Derive a concise error message when possible
        const errorMessage = e instanceof Error ? e.message : 'Image load failed';

        // Log structured error for server-side collection
        logger.error('Player avatar failed to load', e instanceof Error ? e : undefined, {
          playerId: player.id,
          playerName: player.name,
          src,
          component: 'PlayerCard',
          action: 'avatar_load_error',
          message: errorMessage,
        });
      } catch (err) {
        // Fallback: ensure we still set image error and do not crash the component
        console.error('Unexpected error in handleImageError', err);
        setImageError(true);
      }
    },
    [player.id, player.name, player.avatar]
  );

  // Handle card click with useCallback for performance
  const handleCardClick = useCallback(() => {
    if (disabled) return;

    if (selectable && onSelect) {
      onSelect(player);
    } else if (onClick) {
      onClick(player);
    }
  }, [disabled, selectable, onSelect, onClick, player]);

  // Handle star toggle with useCallback
  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!disabled && onStar) {
        onStar(player);
      }
    },
    [disabled, onStar, player]
  );

  // Format price change
  const formatPriceChange = useCallback((change: number) => {
    const sign = change > 0 ? '+' : '';
    return `${sign}$${change.toLocaleString()}`;
  }, []);

  // Format percentage
  const formatPercentage = useCallback((value: number) => `${value.toFixed(1)}%`, []);

  // Get trend icon with styling from config
  const getTrendIcon = useCallback(() => {
    switch (player.trend) {
      case 'up':
        return <ArrowTrendingUpIcon className={TREND_STYLES.up} />;
      case 'down':
        return <ArrowTrendingDownIcon className={TREND_STYLES.down} />;
      default:
        return null;
    }
  }, [player.trend]);

  // Render compact variant
  if (variant === 'compact') {
    return (
      <motion.div
        {...animationPresets.scaleIn}
        whileHover={{ scale: disabled ? 1 : 1.02 }}
        whileTap={{ scale: disabled ? 1 : 0.98 }}
        className={`
          ${CARD_STYLES.compact.base}
          ${selectable || onClick ? CARD_STYLES.compact.interactive : ''}
          ${selected ? CARD_STYLES.selected : ''}
          ${disabled ? CARD_STYLES.disabled : ''}
          ${className}
        `}
        onClick={handleCardClick}
      >
        <div className={`flex items-center space-x-3 ${sizeConfig.container}`}>
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {player.avatar && !imageError ? (
              <Image
                src={player.avatar}
                alt={player.name}
                width={48}
                height={48}
                className={`${sizeConfig.avatar} rounded-full object-cover`}
                onError={handleImageError}
              />
            ) : (
              <div
                className={`${sizeConfig.avatar} rounded-full bg-muted flex items-center justify-center`}
              >
                <span className="text-muted-foreground font-medium">
                  {player.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .substring(0, 2)}
                </span>
              </div>
            )}

            {/* Status indicator */}
            {player.status !== 'available' && (
              <div
                className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${statusConfig.bgColor} border-2 border-white`}
              >
                {statusConfig.icon && <statusConfig.icon className="w-2 h-2 text-current" />}
              </div>
            )}
          </div>

          {/* Player info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h4 className={`${sizeConfig.name} text-foreground truncate`}>{player.name}</h4>
                <p
                  className={`${sizeConfig.position} flex flex-wrap items-center gap-1.5 text-muted-foreground`}
                >
                  <span>{player.position}</span>
                  <span aria-hidden="true">•</span>
                  {player.team ? (
                    <>
                      <TeamLogo
                        team={player.team}
                        size={16}
                        withCircle
                        decorative
                        className="shrink-0"
                      />
                      <span>{player.team}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                  {player.jerseyNumber ? ` #${player.jerseyNumber}` : ''}
                </p>
              </div>

              {/* Star button */}
              {onStar && (
                <button
                  onClick={handleStarClick}
                  className="p-1 text-muted-foreground hover:text-warning transition-colors"
                  aria-label={player.isStarred ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {player.isStarred ? (
                    <StarIconSolid className="w-4 h-4 text-warning" />
                  ) : (
                    <StarIcon className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>

            {/* Quick stats */}
            {showStats && player.averageScore && (
              <div className="mt-1 flex items-center space-x-3">
                <span className={`${sizeConfig.stats} text-foreground`}>
                  Avg: {player.averageScore.toFixed(1)}
                </span>
                {player.trend && getTrendIcon()}
                {player.currentPrice && (
                  <span className={`${sizeConfig.stats} text-muted-foreground`}>
                    ${player.currentPrice.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Render default/detailed variant
  return (
    <motion.div
      {...animationPresets.scaleIn}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={`
        ${CARD_STYLES.detailed.base}
        ${selectable || onClick ? CARD_STYLES.detailed.interactive : ''}
        ${selected ? CARD_STYLES.selected : ''}
        ${disabled ? CARD_STYLES.disabled : ''}
        ${className}
      `}
      onClick={handleCardClick}
    >
      <div className={sizeConfig.container}>
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            {/* Avatar */}
            <div className="relative">
              {player.avatar && !imageError ? (
                <Image
                  src={player.avatar}
                  alt={player.name}
                  width={64}
                  height={64}
                  className={`${sizeConfig.avatar} rounded-full object-cover`}
                  onError={handleImageError}
                />
              ) : (
                <div
                  className={`${sizeConfig.avatar} rounded-full bg-muted flex items-center justify-center`}
                >
                  <span className="text-muted-foreground font-medium text-lg">
                    {player.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .substring(0, 2)}
                  </span>
                </div>
              )}
            </div>

            {/* Player details */}
            <div>
              <h3 className={`${sizeConfig.name} text-foreground`}>{player.name}</h3>
              <p
                className={`${sizeConfig.position} flex flex-wrap items-center gap-1.5 text-muted-foreground`}
              >
                <span>{player.position}</span>
                <span aria-hidden="true">•</span>
                {player.team ? (
                  <>
                    <TeamLogo
                      team={player.team}
                      size={18}
                      withCircle
                      decorative
                      className="shrink-0"
                    />
                    <span>{player.team}</span>
                  </>
                ) : (
                  <span>—</span>
                )}
                {player.jerseyNumber ? ` #${player.jerseyNumber}` : ''}
              </p>

              {/* Status badge */}
              <div className="mt-1 flex items-center space-x-2">
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
                >
                  {statusConfig.icon && <statusConfig.icon className="w-3 h-3 mr-1" />}
                  {statusConfig.label}
                </span>

                {player.trend && <div className="flex items-center">{getTrendIcon()}</div>}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-2">
            {onStar && (
              <button
                onClick={handleStarClick}
                className="p-2 text-muted-foreground hover:text-warning transition-colors"
                aria-label={player.isStarred ? 'Remove from favorites' : 'Add to favorites'}
              >
                {player.isStarred ? (
                  <StarIconSolid className="w-5 h-5 text-warning" />
                ) : (
                  <StarIcon className="w-5 h-5" />
                )}
              </button>
            )}
            {actions}
          </div>
        </div>

        {/* Stats Grid */}
        {showStats && variant === 'detailed' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {player.averageScore && (
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">
                  {player.averageScore.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Average</p>
              </div>
            )}

            {player.totalPoints && (
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{player.totalPoints}</p>
                <p className="text-xs text-muted-foreground">Total Points</p>
              </div>
            )}

            {player.seasonHigh && (
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{player.seasonHigh}</p>
                <p className="text-xs text-muted-foreground">Season High</p>
              </div>
            )}

            {player.currentPrice && (
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">
                  ${player.currentPrice.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Price</p>
              </div>
            )}
          </div>
        )}

        {/* Price change */}
        {player.priceChange && (
          <div className="mb-4">
            <div
              className={`inline-flex items-center px-2 py-1 rounded-full text-sm font-medium ${
                player.priceChange > 0 ? PRICE_CHANGE_STYLES.positive : PRICE_CHANGE_STYLES.negative
              }`}
            >
              {player.priceChange > 0 ? '↗' : '↘'} {formatPriceChange(player.priceChange)}
            </div>
          </div>
        )}

        {/* Next game */}
        {showNextGame && player.nextGame && (
          <div className="mb-4 p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {player.nextGame.isHome ? 'vs' : '@'} {player.nextGame.opponent}
                </p>
                <p className="text-xs text-muted-foreground">
                  {player.nextGame.date.toLocaleDateString()}
                </p>
              </div>
              {player.projectedScore && (
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{player.projectedScore}</p>
                  <p className="text-xs text-muted-foreground">Projected</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ownership */}
        {showOwnership && (player.ownership || player.selectedByOpponents) && (
          <div className="grid grid-cols-2 gap-4">
            {player.ownership && (
              <div>
                <p className="text-xs text-muted-foreground">Ownership</p>
                <p className="text-sm font-medium text-foreground">
                  {formatPercentage(player.ownership)}
                </p>
              </div>
            )}
            {player.selectedByOpponents && (
              <div>
                <p className="text-xs text-muted-foreground">Selected by Opponents</p>
                <p className="text-sm font-medium text-foreground">{player.selectedByOpponents}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection indicator */}
      {selectable && selected && (
        <div className="absolute top-2 right-2">
          <div className="w-6 h-6 bg-info rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Memoized PlayerCard for performance optimization
export default React.memo(
  PlayerCard,
  (prevProps: Readonly<PlayerCardProps>, nextProps: Readonly<PlayerCardProps>) => {
    // Custom comparison for optimal re-rendering
    return (
      prevProps.player.id === nextProps.player.id &&
      prevProps.selected === nextProps.selected &&
      prevProps.variant === nextProps.variant &&
      prevProps.size === nextProps.size &&
      prevProps.disabled === nextProps.disabled &&
      prevProps.showStats === nextProps.showStats &&
      prevProps.showNextGame === nextProps.showNextGame &&
      prevProps.showOwnership === nextProps.showOwnership &&
      prevProps.player.status === nextProps.player.status &&
      prevProps.player.isStarred === nextProps.player.isStarred &&
      prevProps.onSelect === nextProps.onSelect &&
      prevProps.onStar === nextProps.onStar &&
      prevProps.onClick === nextProps.onClick
    );
  }
);
