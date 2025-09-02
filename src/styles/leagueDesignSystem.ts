/**
 * League Component Style Guide & Design System
 * Centralized design tokens and patterns for consistency
 */

export const leagueDesignTokens = {
  // Color System
  colors: {
    // Primary brand colors
    primary: {
      50: 'bg-blue-50 text-blue-600',
      100: 'bg-blue-100 text-blue-800',
      500: 'bg-blue-500 text-white',
      600: 'bg-blue-600 text-white',
      700: 'bg-blue-700 text-white',
    },

    // Status colors
    success: {
      50: 'bg-green-50 text-green-600',
      100: 'bg-green-100 text-green-800',
      600: 'bg-green-600 text-white',
      700: 'bg-green-700 text-white',
    },

    warning: {
      50: 'bg-yellow-50 text-yellow-600',
      100: 'bg-yellow-100 text-yellow-800',
      600: 'bg-yellow-600 text-white',
    },

    error: {
      50: 'bg-red-50 text-red-600',
      100: 'bg-red-100 text-red-800',
      600: 'bg-red-600 text-white',
    },

    orange: {
      50: 'bg-orange-50 text-orange-600',
      100: 'bg-orange-100 text-orange-800',
      600: 'bg-orange-600 text-white',
    },

    purple: {
      50: 'bg-purple-50 text-purple-600',
      100: 'bg-purple-100 text-purple-800',
      600: 'bg-purple-600 text-white',
    },

    // Neutral grays
    gray: {
      50: 'bg-gray-50 text-gray-900',
      100: 'bg-gray-100 text-gray-900',
      200: 'bg-gray-200 text-gray-900',
      300: 'text-gray-300',
      400: 'text-gray-400',
      500: 'text-gray-500',
      600: 'text-gray-600',
      700: 'text-gray-700',
      800: 'text-gray-800',
      900: 'text-gray-900',
    },
  },

  // Spacing System (following 8px grid)
  spacing: {
    xs: 'p-2',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
    xl: 'p-8',
  },

  // Shadow System
  shadows: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl',
  },

  // Border Radius
  rounded: {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  },
} as const;

// Component Pattern Classes
export const componentPatterns = {
  // Cards
  card: `bg-white ${leagueDesignTokens.shadows.lg} ${leagueDesignTokens.rounded.xl} ${leagueDesignTokens.spacing.lg}`,
  cardHeader: 'flex items-center justify-between mb-6',
  cardTitle: 'text-xl font-semibold text-gray-900',

  // Status badges
  statusBadge: 'px-2 py-1 text-xs font-medium rounded-full',

  // Buttons
  button: {
    primary: `bg-blue-600 text-white hover:bg-blue-700 transition-colors`,
    secondary: `bg-gray-100 text-gray-900 hover:bg-gray-200 transition-colors`,
    success: `bg-green-600 text-white hover:bg-green-700 transition-colors`,
    danger: `bg-red-600 text-white hover:bg-red-700 transition-colors`,
  },

  // Forms
  input: `w-full px-3 py-2 border border-gray-300 ${leagueDesignTokens.rounded.lg} focus:ring-2 focus:ring-blue-500 focus:border-transparent`,
  label: 'block text-sm font-medium text-gray-700 mb-1',

  // Loading states
  spinner: 'animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600',

  // Error states
  errorAlert: `mb-4 p-4 ${leagueDesignTokens.colors.error[50]} border border-red-200 ${leagueDesignTokens.rounded.lg} flex items-center space-x-2`,

  // Success states
  successAlert: `mb-4 p-4 ${leagueDesignTokens.colors.success[50]} border border-green-200 ${leagueDesignTokens.rounded.lg}`,
} as const;

// League-specific status configurations
export const leagueStatusConfig = {
  league: {
    preseason: { color: leagueDesignTokens.colors.primary[100], label: 'Pre-season' },
    active: { color: leagueDesignTokens.colors.success[100], label: 'Active' },
    completed: { color: leagueDesignTokens.colors.gray[100], label: 'Completed' },
  },

  draft: {
    SCHEDULED: { color: leagueDesignTokens.colors.primary[100], label: 'Scheduled' },
    LOBBY: { color: leagueDesignTokens.colors.warning[100], label: 'Lobby' },
    COUNTDOWN: { color: leagueDesignTokens.colors.orange[100], label: 'Starting' },
    LIVE: { color: leagueDesignTokens.colors.success[100], label: 'Live' },
    PAUSED: { color: leagueDesignTokens.colors.gray[100], label: 'Paused' },
    COMPLETED: { color: leagueDesignTokens.colors.purple[100], label: 'Completed' },
  },

  member: {
    owner: { color: leagueDesignTokens.colors.warning[100], label: 'Owner' },
    manager: { color: leagueDesignTokens.colors.primary[100], label: 'Manager' },
    member: { color: leagueDesignTokens.colors.gray[100], label: 'Member' },
  },
} as const;

// Animation presets for Framer Motion
export const animationPresets = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3 },
  },

  fadeInDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3 },
  },

  fadeInLeft: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.3 },
  },

  staggerChildren: {
    animate: {
      transition: {
        staggerChildren: 0.1,
      },
    },
  },

  scaleIn: {
    initial: { scale: 0.95, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    transition: { duration: 0.2 },
  },
} as const;

// Component size configurations
export const componentSizes = {
  avatar: {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  },

  icon: {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8',
  },

  button: {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  },
} as const;

// Responsive breakpoint utilities
export const responsive = {
  mobile: 'block md:hidden',
  desktop: 'hidden md:block',
  gridCols: {
    responsive: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    autoFit: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  },
} as const;
