'use client';

import React from 'react';
import type { ReactNode } from 'react';

import { X } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

// Badge variants
export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'outline'
  | 'ghost';

// Badge sizes
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

// Badge shapes
export type BadgeShape = 'rounded' | 'pill' | 'square';

// Component props
interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  shape?: BadgeShape;
  icon?: React.ComponentType<{ className?: string }>;
  dot?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  animate?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

// Variant configurations
const VARIANT_CONFIG: Record<BadgeVariant, { base: string; hover: string }> = {
  default: {
    base: 'border border-border bg-muted text-muted-foreground',
    hover: 'hover:bg-muted/80',
  },
  secondary: {
    base: 'border border-transparent bg-secondary text-secondary-foreground',
    hover: 'hover:bg-secondary/80',
  },
  success: {
    base: 'border border-primary/20 bg-primary/10 text-primary',
    hover: 'hover:bg-primary/15',
  },
  danger: {
    base: 'border border-destructive/20 bg-destructive/10 text-destructive',
    hover: 'hover:bg-destructive/15',
  },
  warning: {
    base: 'border border-warning/30 bg-warning/15 text-warning',
    hover: 'hover:bg-warning/25',
  },
  info: {
    base: 'border border-primary/20 bg-primary/10 text-primary',
    hover: 'hover:bg-primary/15',
  },
  outline: {
    base: 'border border-border bg-background text-foreground',
    hover: 'hover:bg-accent hover:text-accent-foreground',
  },
  ghost: {
    base: 'border border-transparent bg-transparent text-muted-foreground',
    hover: 'hover:bg-accent hover:text-accent-foreground',
  },
};

// Size configurations
const SIZE_CONFIG = {
  xs: {
    padding: 'px-2 py-0.5',
    text: 'text-xs',
    icon: 'w-3 h-3',
    dot: 'w-1.5 h-1.5',
    remove: 'w-3 h-3 ml-1',
  },
  sm: {
    padding: 'px-2.5 py-0.5',
    text: 'text-sm',
    icon: 'w-4 h-4',
    dot: 'w-2 h-2',
    remove: 'w-3 h-3 ml-1.5',
  },
  md: {
    padding: 'px-3 py-1',
    text: 'text-sm',
    icon: 'w-4 h-4',
    dot: 'w-2.5 h-2.5',
    remove: 'w-4 h-4 ml-2',
  },
  lg: {
    padding: 'px-4 py-1.5',
    text: 'text-base',
    icon: 'w-5 h-5',
    dot: 'w-3 h-3',
    remove: 'w-4 h-4 ml-2',
  },
};

// Shape configurations
const SHAPE_CONFIG = {
  rounded: 'rounded-md',
  pill: 'rounded-full',
  square: 'rounded-none',
};

export default function Badge({
  children,
  variant = 'default',
  size = 'sm',
  shape = 'rounded',
  icon: IconComponent,
  dot = false,
  removable = false,
  onRemove,
  className = '',
  animate = false,
  href,
  onClick,
  disabled = false,
  style,
}: BadgeProps) {
  const variantConfig = VARIANT_CONFIG[variant];
  const sizeConfig = SIZE_CONFIG[size];
  const shapeConfig = SHAPE_CONFIG[shape];

  const isInteractive = href || onClick;
  const isClickable = !disabled && isInteractive;

  const baseClasses = cn(
    'inline-flex items-center font-medium',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    sizeConfig.padding,
    sizeConfig.text,
    shapeConfig,
    variantConfig.base,
    isClickable && 'cursor-pointer transition-colors',
    isClickable && variantConfig.hover,
    disabled && 'cursor-not-allowed opacity-50',
    className
  );

  // Handle click
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  // Handle remove
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove();
    }
  };

  // Content
  const content = (
    <>
      {/* Dot indicator */}
      {dot && <span className={cn(sizeConfig.dot, 'mr-1.5 rounded-full bg-current opacity-75')} />}

      {/* Icon */}
      {IconComponent && (
        <IconComponent className={cn(sizeConfig.icon, children && 'mr-1')} aria-hidden="true" />
      )}

      {/* Text content */}
      {children && <span>{children}</span>}

      {/* Remove button */}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className={cn(
            sizeConfig.remove,
            'rounded-sm text-current opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          )}
          aria-label="Remove"
        >
          <X className="h-full w-full" aria-hidden="true" />
        </button>
      )}
    </>
  );

  // Render as link
  if (href && !disabled) {
    const BadgeElement = (
      <a href={href} className={baseClasses} style={style}>
        {content}
      </a>
    );

    return animate ? (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        {BadgeElement}
      </motion.div>
    ) : (
      BadgeElement
    );
  }

  // Render as button or div
  const BadgeElement = isClickable ? (
    <button type="button" onClick={handleClick} className={baseClasses} style={style}>
      {content}
    </button>
  ) : (
    <span className={baseClasses} style={style}>
      {content}
    </span>
  );

  return animate ? (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      whileHover={isClickable ? { scale: 1.05 } : undefined}
      whileTap={isClickable ? { scale: 0.95 } : undefined}
    >
      {BadgeElement}
    </motion.div>
  ) : (
    BadgeElement
  );
}

// Status badge component
interface StatusBadgeProps {
  status: 'online' | 'offline' | 'away' | 'busy';
  size?: BadgeSize;
  showText?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = 'sm',
  showText = false,
  className = '',
}: StatusBadgeProps) {
  const statusConfig = {
    online: { variant: 'success' as const, text: 'Online', dot: 'bg-primary' },
    offline: { variant: 'default' as const, text: 'Offline', dot: 'bg-muted-foreground' },
    away: { variant: 'warning' as const, text: 'Away', dot: 'bg-accent-foreground' },
    busy: { variant: 'danger' as const, text: 'Busy', dot: 'bg-destructive' },
  };

  const config = statusConfig[status];

  if (showText) {
    return (
      <Badge variant={config.variant} size={size} shape="pill" dot className={className}>
        {config.text}
      </Badge>
    );
  }

  return (
    <span className={cn('inline-block rounded-full', className)}>
      <span
        className={cn(
          'block rounded-full',
          config.dot,
          size === 'xs'
            ? 'w-2 h-2'
            : size === 'sm'
              ? 'w-2.5 h-2.5'
              : size === 'md'
                ? 'w-3 h-3'
                : 'w-4 h-4'
        )}
      />
    </span>
  );
}

// Number badge component (for notifications, counts, etc.)
interface NumberBadgeProps {
  count: number;
  max?: number;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  showZero?: boolean;
}

export function NumberBadge({
  count,
  max = 99,
  variant = 'danger',
  size = 'sm',
  className = '',
  showZero = false,
}: NumberBadgeProps) {
  if (count === 0 && !showZero) {
    return null;
  }

  const displayCount = count > max ? `${max}+` : count.toString();

  return (
    <Badge variant={variant} size={size} shape="pill" className={className} animate>
      {displayCount}
    </Badge>
  );
}

// Team badge component (for sports teams)
interface TeamBadgeProps {
  teamName: string;
  teamCode?: string;
  logo?: string;
  color?: string;
  size?: BadgeSize;
  showLogo?: boolean;
  className?: string;
}

export function TeamBadge({
  teamName,
  teamCode,
  logo,
  color,
  size = 'md',
  showLogo = true,
  className = '',
}: TeamBadgeProps) {
  const displayText = teamCode || teamName;

  return (
    <Badge
      variant="outline"
      size={size}
      shape="rounded"
      className={className}
      style={color ? { borderColor: color, color } : undefined}
    >
      {showLogo && logo && (
        <img
          src={logo}
          alt={`${teamName} logo`}
          className={`${SIZE_CONFIG[size].icon} mr-1 rounded-full`}
        />
      )}
      {displayText}
    </Badge>
  );
}

// Position badge component (for player positions)
interface PositionBadgeProps {
  position: string;
  variant?: 'default' | 'colored';
  size?: BadgeSize;
  className?: string;
}

export function PositionBadge({
  position,
  variant = 'default',
  size = 'xs',
  className = '',
}: PositionBadgeProps) {
  // Position color mapping for AFL
  const positionColors: Record<string, BadgeVariant> = {
    DEF: 'info',
    MID: 'success',
    RUC: 'warning',
    FWD: 'danger',
    BENCH: 'default',
    EMG: 'secondary',
  };

  const badgeVariant =
    variant === 'colored' && positionColors[position] ? positionColors[position] : 'default';

  return (
    <Badge
      variant={badgeVariant}
      size={size}
      shape="rounded"
      className={cn('font-mono', className)}
    >
      {position}
    </Badge>
  );
}

// Price change badge component
interface PriceChangeBadgeProps {
  change: number;
  format?: 'currency' | 'percentage';
  size?: BadgeSize;
  className?: string;
}

export function PriceChangeBadge({
  change,
  format = 'currency',
  size = 'sm',
  className = '',
}: PriceChangeBadgeProps) {
  const isPositive = change > 0;
  const isNeutral = change === 0;

  const variant = isNeutral ? 'default' : isPositive ? 'success' : 'danger';
  const icon = isNeutral ? '' : isPositive ? '↗' : '↘';

  const formatValue = (value: number) => {
    if (format === 'percentage') {
      return `${value.toFixed(1)}%`;
    }
    return `$${Math.abs(value).toLocaleString()}`;
  };

  return (
    <Badge variant={variant} size={size} shape="rounded" className={className}>
      {icon} {formatValue(change)}
    </Badge>
  );
}

// Badge group component for organizing multiple badges
interface BadgeGroupProps {
  children: ReactNode;
  spacing?: 'tight' | 'normal' | 'loose';
  wrap?: boolean;
  className?: string;
}

export function BadgeGroup({
  children,
  spacing = 'normal',
  wrap = true,
  className = '',
}: BadgeGroupProps) {
  const spacingClasses = {
    tight: 'gap-1',
    normal: 'gap-2',
    loose: 'gap-3',
  };

  return (
    <div
      className={cn('flex items-center', spacingClasses[spacing], wrap && 'flex-wrap', className)}
    >
      {children}
    </div>
  );
}
