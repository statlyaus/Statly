'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';

import { floatingStyles } from '@/components/ui/controlStyles';
import { cn } from '@/lib/utils';

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

// Tooltip size
export type TooltipSize = 'sm' | 'md' | 'lg';

// Component props
interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
  trigger?: TooltipTrigger;
  size?: TooltipSize;
  delay?: number;
  offset?: number;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  interactive?: boolean;
  maxWidth?: string;
  zIndex?: number;
  portal?: boolean;
}

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

export default function Tooltip({
  content,
  children,
  placement = 'top',
  trigger = 'hover',
  size = 'md',
  delay = 0,
  offset = 8,
  disabled = false,
  className = '',
  contentClassName = '',
  interactive = false,
  maxWidth,
  zIndex = 9999,
  portal = true,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const tooltipId = React.useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

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

  // Escape is an immediate dismissal, even for interactive or delayed tooltips.
  const dismissTooltip = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    setIsVisible(false);
  }, []);

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
      handlers.onFocus = showTooltip;
      handlers.onBlur = hideTooltip;
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

  // Listen for Escape for the lifetime of the trigger so a key press cannot race
  // the effect that follows disclosure. This also cancels a pending delayed show.
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissTooltip();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [dismissTooltip]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Unmount the semantic tooltip immediately on dismissal. Retaining it for an
  // exit animation leaves assistive technology associated with stale content.
  const tooltipContent = isVisible ? (
    <motion.div
      id={tooltipId}
      ref={tooltipRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      // Ink with a cobalt shadow (style guide, "Elevation"). The design's caret is dropped on
      // purpose: the hand-cut edge has no straight side for it to sit on.
      className={cn(
        floatingStyles({ tone: 'ink' }),
        'absolute z-50 max-w-[260px]',
        sizeConfig,
        maxWidth,
        contentClassName
      )}
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
    >
      {content}
    </motion.div>
  ) : null;

  const hasElementTrigger = React.isValidElement<{ 'aria-describedby'?: string }>(children);
  const describedChildren = hasElementTrigger
    ? React.cloneElement(children, {
        'aria-describedby':
          [children.props['aria-describedby'], isVisible ? tooltipId : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
      })
    : children;

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-block ${className}`}
        {...eventHandlers}
        aria-describedby={!hasElementTrigger && isVisible ? tooltipId : undefined}
      >
        {describedChildren}
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
