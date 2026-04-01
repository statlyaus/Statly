/**
 * PlayerCard Configuration
 * Centralized configuration using design system tokens
 */

import type React from 'react';

import { ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/24/outline';

import { leagueDesignTokens, componentSizes } from '@/styles/leagueDesignSystem';

import type { PlayerStatus, PlayerCardSize, PlayerCardVariant } from './PlayerCard';

// Player Card Defaults
export const PLAYER_CARD_DEFAULTS = {
  variant: 'default' as PlayerCardVariant,
  size: 'md' as PlayerCardSize,
  selectable: false,
  selected: false,
  showStats: true,
  showNextGame: true,
  showOwnership: false,
  disabled: false,
};

// Status configuration using design system tokens
export const STATUS_CONFIG: Record<
  PlayerStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon?: React.ComponentType<{ className?: string }>;
  }
> = {
  available: {
    label: 'Available',
    color: leagueDesignTokens.colors.success[100],
    bgColor: leagueDesignTokens.colors.success[100],
  },
  injured: {
    label: 'Injured',
    color: leagueDesignTokens.colors.error[100],
    bgColor: leagueDesignTokens.colors.error[100],
    icon: ExclamationTriangleIcon,
  },
  suspended: {
    label: 'Suspended',
    color: leagueDesignTokens.colors.error[100],
    bgColor: leagueDesignTokens.colors.error[100],
    icon: ExclamationTriangleIcon,
  },
  bye: {
    label: 'Bye',
    color: leagueDesignTokens.colors.gray[100],
    bgColor: leagueDesignTokens.colors.gray[100],
    icon: ClockIcon,
  },
  doubtful: {
    label: 'Doubtful',
    color: leagueDesignTokens.colors.warning[100],
    bgColor: leagueDesignTokens.colors.warning[100],
    icon: ExclamationTriangleIcon,
  },
  out: {
    label: 'Out',
    color: leagueDesignTokens.colors.error[100],
    bgColor: leagueDesignTokens.colors.error[100],
    icon: ExclamationTriangleIcon,
  },
};

// Size configurations using design system
export const SIZE_CONFIG = {
  sm: {
    container: leagueDesignTokens.spacing.sm,
    avatar: componentSizes.avatar.sm,
    name: 'text-sm font-medium',
    position: 'text-xs',
    stats: 'text-xs',
  },
  md: {
    container: leagueDesignTokens.spacing.md,
    avatar: componentSizes.avatar.md,
    name: 'text-base font-medium',
    position: 'text-sm',
    stats: 'text-sm',
  },
  lg: {
    container: leagueDesignTokens.spacing.lg,
    avatar: componentSizes.avatar.lg,
    name: 'text-lg font-semibold',
    position: 'text-base',
    stats: 'text-base',
  },
};

/**
 * Card styles using design system
 * Structured for better readability and variant-specific styling
 */
export const CARD_STYLES = {
  // Base style components for better readability
  foundation: 'relative bg-white border border-gray-200',
  shape: leagueDesignTokens.rounded.lg,
  animation: 'transition-all duration-200',

  /**
   * Composed base style using getter for dynamic composition
   * Combines foundation, shape, and animation tokens
   */
  get base() {
    return [this.foundation, this.shape, this.animation].join(' ');
  },

  // Legacy interaction states (kept for backward compatibility)
  interactive: 'cursor-pointer hover:border-blue-300 hover:shadow-sm group',
  interactiveDetailed:
    'cursor-pointer hover:border-blue-300 hover:shadow-md group-hover:scale-[1.01] group',

  // State styles
  selected: 'ring-2 ring-blue-500 border-blue-500',
  disabled: 'opacity-50 cursor-not-allowed',

  // Shadow variations
  shadow: leagueDesignTokens.shadows.sm,
  shadowDetailed: leagueDesignTokens.shadows.md,

  /**
   * Compact variant styles
   * Optimized for space-efficient display with subtle hover effects
   */
  compact: {
    get interactive() {
      return 'cursor-pointer hover:border-blue-300 hover:shadow-sm hover:bg-gray-50 group';
    },
    get base() {
      return [
        CARD_STYLES.foundation,
        CARD_STYLES.shape,
        CARD_STYLES.animation,
        CARD_STYLES.shadow,
      ].join(' ');
    },
  },

  /**
   * Detailed variant styles
   * Enhanced hover effects with transform and shadow for rich display
   */
  detailed: {
    get interactive() {
      return 'cursor-pointer hover:border-blue-300 hover:shadow-lg hover:transform hover:scale-[1.02] group';
    },
    get base() {
      return [
        CARD_STYLES.foundation,
        CARD_STYLES.shape,
        CARD_STYLES.animation,
        CARD_STYLES.shadowDetailed,
      ].join(' ');
    },
  },
};

// Price change styles
export const PRICE_CHANGE_STYLES = {
  positive: leagueDesignTokens.colors.success[100],
  negative: leagueDesignTokens.colors.error[100],
};

// Trend icon styles
export const TREND_STYLES = {
  up: `w-4 h-4 ${leagueDesignTokens.colors.success[600]}`,
  down: `w-4 h-4 ${leagueDesignTokens.colors.error[600]}`,
};
