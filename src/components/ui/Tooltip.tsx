'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

// Tooltip placement options
export type TooltipPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end';

// Tooltip triggers
export type TooltipTrigger = 'hover' | 'click' | 'focus' | 'manual';

// Tooltip variants
export type TooltipVariant =
  | 'default'
  | 'dark'
  | 'light'
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

// Tooltip size
export type TooltipSize = 'sm' | 'md' | 'lg';

// Component props
interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
  trigger?: TooltipTrigger;
  variant?: TooltipVariant;
  size?: TooltipSize;
  delay?: number;
  offset?: number;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  arrow?: boolean;
  interactive?: boolean;
  maxWidth?: string;
  zIndex?: number;
  portal?: boolean;
}

// Variant configurations
const VARIANT_CONFIG = {
  default: {
    background: 'bg-gray-900',
    text: 'text-white',
    border: 'border-gray-900',
  },
  dark: {
    background: 'bg-black',
    text: 'text-white',
    border: 'border-black',
  },
  light: {
    background: 'bg-white',
    text: 'text-gray-900',
    border: 'border-gray-200',
  },
  info: {
    background: 'bg-blue-600',
    text: 'text-white',
    border: 'border-blue-600',
  },
  success: {
    background: 'bg-green-600',
    text: 'text-white',
    border: 'border-green-600',
  },
  warning: {
    background: 'bg-yellow-600',
    text: 'text-white',
    border: 'border-yellow-600',
  },
  error: {
    background: 'bg-red-600',
    text: 'text-white',
    border: 'border-red-600',
  },
};

// Size configurations
const SIZE_CONFIG = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

// Calculate tooltip position
function calculatePosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  placement: TooltipPlacement,
  offset: number
) {
  const positions: Record<string, { top: number; left: number }> = {};

  // Top placements
  positions.top = {
    top: triggerRect.top - tooltipRect.height - offset,
    left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
  };
  positions['top-start'] = {
    top: triggerRect.top - tooltipRect.height - offset,
    left: triggerRect.left,
  };
  positions['top-end'] = {
    top: triggerRect.top - tooltipRect.height - offset,
    left: triggerRect.right - tooltipRect.width,
  };

  // Bottom placements
  positions.bottom = {
    top: triggerRect.bottom + offset,
    left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
  };
  positions['bottom-start'] = {
    top: triggerRect.bottom + offset,
    left: triggerRect.left,
  };
  positions['bottom-end'] = {
    top: triggerRect.bottom + offset,
    left: triggerRect.right - tooltipRect.width,
  };

  // Left placements
  positions.left = {
    top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
    left: triggerRect.left - tooltipRect.width - offset,
  };
  positions['left-start'] = {
    top: triggerRect.top,
    left: triggerRect.left - tooltipRect.width - offset,
  };
  positions['left-end'] = {
    top: triggerRect.bottom - tooltipRect.height,
    left: triggerRect.left - tooltipRect.width - offset,
  };

  // Right placements
  positions.right = {
    top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
    left: triggerRect.right + offset,
  };
  positions['right-start'] = {
    top: triggerRect.top,
    left: triggerRect.right + offset,
  };
  positions['right-end'] = {
    top: triggerRect.bottom - tooltipRect.height,
    left: triggerRect.right + offset,
  };

  return positions[placement] || positions.top;
}

// Arrow component
function TooltipArrow({
  placement,
  variant,
}: {
  placement: TooltipPlacement;
  variant: TooltipVariant;
}) {
  const variantConfig = VARIANT_CONFIG[variant];
  const isVertical = placement.startsWith('top') || placement.startsWith('bottom');
  const isTop = placement.startsWith('top');
  const isLeft = placement.startsWith('left');

  const arrowClasses = `absolute w-0 h-0 ${
    isVertical
      ? isTop
        ? 'border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent'
        : 'border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent'
      : isLeft
        ? 'border-t-4 border-b-4 border-l-4 border-t-transparent border-b-transparent'
        : 'border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent'
  }`;

  const positionClasses = placement.startsWith('top')
    ? 'bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full'
    : placement.startsWith('bottom')
      ? 'top-0 left-1/2 transform -translate-x-1/2 -translate-y-full'
      : placement.startsWith('left')
        ? 'right-0 top-1/2 transform translate-x-full -translate-y-1/2'
        : 'left-0 top-1/2 transform -translate-x-full -translate-y-1/2';

  const borderColor = variantConfig.border.replace('border-', 'border-t-') || 'border-t-gray-900';

  return <div className={`${arrowClasses} ${positionClasses} ${borderColor}`} />;
}

export default function Tooltip({
  content,
  children,
  placement = 'top',
  trigger = 'hover',
  variant = 'default',
  size = 'md',
  delay = 0,
  offset = 8,
  disabled = false,
  className = '',
  contentClassName = '',
  arrow = true,
  interactive = false,
  maxWidth = 'max-w-xs',
  zIndex = 9999,
  portal = true,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const variantConfig = VARIANT_CONFIG[variant];
  const sizeConfig = SIZE_CONFIG[size];

  // Show tooltip
  const showTooltip = React.useCallback(() => {
    if (disabled) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (delay > 0) {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, delay);
    } else {
      setIsVisible(true);
    }
  }, [disabled, delay]);

  // Hide tooltip
  const hideTooltip = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (interactive) {
      // Add small delay for interactive tooltips
      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 100);
    } else {
      setIsVisible(false);
    }
  }, [interactive]);

  // Update position when visible
  useEffect(() => {
    if (isVisible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const newPosition = calculatePosition(triggerRect, tooltipRect, placement, offset);

      // Adjust for viewport boundaries
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      // Adjust horizontal position
      if (newPosition.left < 0) {
        newPosition.left = 8;
      } else if (newPosition.left + tooltipRect.width > viewport.width) {
        newPosition.left = viewport.width - tooltipRect.width - 8;
      }

      // Adjust vertical position
      if (newPosition.top < 0) {
        newPosition.top = 8;
      } else if (newPosition.top + tooltipRect.height > viewport.height) {
        newPosition.top = viewport.height - tooltipRect.height - 8;
      }

      setPosition(newPosition);
    }
  }, [isVisible, placement, offset]);

  // Event handlers based on trigger type
  const eventHandlers = React.useMemo(() => {
    const handlers: Record<string, () => void> = {};

    if (trigger === 'hover') {
      handlers.onMouseEnter = showTooltip;
      handlers.onMouseLeave = hideTooltip;
    } else if (trigger === 'click') {
      handlers.onClick = () => {
        if (isVisible) {
          hideTooltip();
        } else {
          showTooltip();
        }
      };
    } else if (trigger === 'focus') {
      handlers.onFocus = showTooltip;
      handlers.onBlur = hideTooltip;
    }

    return handlers;
  }, [trigger, isVisible, hideTooltip, showTooltip]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isVisible) {
        hideTooltip();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isVisible, hideTooltip]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const tooltipContent = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={`
            absolute z-50 rounded-lg shadow-lg border
            ${variantConfig.background} ${variantConfig.text} ${variantConfig.border}
            ${sizeConfig} ${maxWidth} ${contentClassName}
          `}
          style={{
            top: position.top,
            left: position.left,
            zIndex,
          }}
          onMouseEnter={
            interactive
              ? () => {
                  if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                  }
                }
              : undefined
          }
          onMouseLeave={interactive ? hideTooltip : undefined}
          role="tooltip"
          aria-hidden={!isVisible}
        >
          {content}
          {arrow && <TooltipArrow placement={placement} variant={variant} />}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-block ${className}`}
        {...eventHandlers}
        aria-describedby={isVisible ? 'tooltip' : undefined}
      >
        {children}
      </div>

      {portal && typeof window !== 'undefined'
        ? createPortal(tooltipContent, document.body)
        : tooltipContent}
    </>
  );
}

// Simple tooltip hook for manual control
export function useTooltip() {
  const [isVisible, setIsVisible] = useState(false);

  const show = React.useCallback(() => setIsVisible(true), []);
  const hide = React.useCallback(() => setIsVisible(false), []);
  const toggle = React.useCallback(() => setIsVisible((prev) => !prev), []);

  return {
    isVisible,
    show,
    hide,
    toggle,
    setIsVisible,
  };
}

// Info tooltip component - specialized for help text
interface InfoTooltipProps {
  content: ReactNode;
  size?: TooltipSize;
  placement?: TooltipPlacement;
  className?: string;
}

export function InfoTooltip({
  content,
  size = 'sm',
  placement = 'top',
  className = '',
}: InfoTooltipProps) {
  return (
    <Tooltip
      content={content}
      variant="info"
      size={size}
      placement={placement}
      className={className}
    >
      <button
        type="button"
        className="inline-flex items-center justify-center w-4 h-4 text-blue-500 hover:text-blue-600 transition-colors"
        aria-label="More information"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </Tooltip>
  );
}

// Player stat tooltip - specialized for sports stats
interface PlayerStatTooltipProps {
  playerName: string;
  stats: Record<string, string | number>;
  children: ReactNode;
  placement?: TooltipPlacement;
}

export function PlayerStatTooltip({
  playerName,
  stats,
  children,
  placement = 'top',
}: PlayerStatTooltipProps) {
  const content = (
    <div className="p-1">
      <h4 className="font-semibold text-sm mb-2">{playerName}</h4>
      <div className="space-y-1">
        {Object.entries(stats).map(([key, value]) => (
          <div key={key} className="flex justify-between text-xs">
            <span className="text-gray-300">{key}:</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Tooltip
      content={content}
      variant="dark"
      size="md"
      placement={placement}
      delay={300}
      maxWidth="max-w-sm"
    >
      {children}
    </Tooltip>
  );
}
