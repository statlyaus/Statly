'use client';

import React from 'react';
import type { ReactNode } from 'react';

import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { cn } from '@/lib/utils';

// Alert types
export type AlertType = 'success' | 'error' | 'warning' | 'info';

// Alert variant styles
export type AlertVariant = 'filled' | 'outlined' | 'light';

// Alert configuration
interface AlertConfig {
  type: AlertType;
  variant: AlertVariant;
  icon: React.ComponentType<{ className?: string }>;
  baseClasses: string;
  iconClasses: string;
}

// Alert configurations
const ALERT_CONFIGS: Record<AlertType, Record<AlertVariant, AlertConfig>> = {
  success: {
    filled: {
      type: 'success',
      variant: 'filled',
      icon: CheckCircle,
      baseClasses: 'border-primary bg-primary text-primary-foreground',
      iconClasses: 'text-primary-foreground',
    },
    outlined: {
      type: 'success',
      variant: 'outlined',
      icon: CheckCircle,
      baseClasses: 'border-primary/30 bg-background text-foreground',
      iconClasses: 'text-primary',
    },
    light: {
      type: 'success',
      variant: 'light',
      icon: CheckCircle,
      baseClasses: 'border-primary/20 bg-primary/10 text-foreground',
      iconClasses: 'text-primary',
    },
  },
  error: {
    filled: {
      type: 'error',
      variant: 'filled',
      icon: XCircle,
      baseClasses: 'border-destructive bg-destructive text-destructive-foreground',
      iconClasses: 'text-destructive-foreground',
    },
    outlined: {
      type: 'error',
      variant: 'outlined',
      icon: XCircle,
      baseClasses: 'border-destructive/30 bg-background text-foreground',
      iconClasses: 'text-destructive',
    },
    light: {
      type: 'error',
      variant: 'light',
      icon: XCircle,
      baseClasses: 'border-destructive/20 bg-destructive/10 text-foreground',
      iconClasses: 'text-destructive',
    },
  },
  warning: {
    filled: {
      type: 'warning',
      variant: 'filled',
      icon: AlertTriangle,
      baseClasses: 'border-warning bg-warning text-warning-foreground',
      iconClasses: 'text-warning-foreground',
    },
    outlined: {
      type: 'warning',
      variant: 'outlined',
      icon: AlertTriangle,
      baseClasses: 'border-warning/40 bg-background text-foreground',
      iconClasses: 'text-warning',
    },
    light: {
      type: 'warning',
      variant: 'light',
      icon: AlertTriangle,
      baseClasses: 'border-warning/30 bg-warning/15 text-foreground',
      iconClasses: 'text-warning',
    },
  },
  info: {
    filled: {
      type: 'info',
      variant: 'filled',
      icon: Info,
      baseClasses: 'border-secondary bg-secondary text-secondary-foreground',
      iconClasses: 'text-secondary-foreground',
    },
    outlined: {
      type: 'info',
      variant: 'outlined',
      icon: Info,
      baseClasses: 'border-border bg-background text-foreground',
      iconClasses: 'text-muted-foreground',
    },
    light: {
      type: 'info',
      variant: 'light',
      icon: Info,
      baseClasses: 'border-border bg-muted text-foreground',
      iconClasses: 'text-muted-foreground',
    },
  },
};

// Component props
interface AlertProps {
  type: AlertType;
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  icon?: boolean | React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
  autoHideDuration?: number;
}

export default function Alert({
  type,
  variant = 'light',
  title,
  children,
  dismissible = false,
  onDismiss,
  className = '',
  icon = true,
  actions,
  autoHideDuration,
}: AlertProps) {
  const [isVisible, setIsVisible] = React.useState(true);

  const handleDismiss = React.useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss?.();
    }, 150); // Wait for animation to complete
  }, [onDismiss]);

  // Auto-hide functionality
  React.useEffect(() => {
    if (autoHideDuration && autoHideDuration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, autoHideDuration);

      return () => clearTimeout(timer);
    }
  }, [autoHideDuration, handleDismiss]);

  // Get configuration
  const config = ALERT_CONFIGS[type][variant];

  // Determine icon to show
  const IconComponent = React.useMemo(() => {
    if (icon === false) return null;
    if (typeof icon === 'function') return icon;
    return config.icon;
  }, [icon, config.icon]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('relative rounded-lg border p-4', config.baseClasses, className)}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start">
            {/* Icon */}
            {IconComponent && (
              <div className="flex-shrink-0">
                <IconComponent className={cn('h-5 w-5', config.iconClasses)} aria-hidden="true" />
              </div>
            )}

            {/* Content */}
            <div className={cn('min-w-0 flex-1', IconComponent && 'ml-3')}>
              {/* Title */}
              {title && <h3 className="text-sm font-medium mb-1">{title}</h3>}

              {/* Message */}
              {children && <div className="text-sm">{children}</div>}

              {/* Actions */}
              {actions && <div className="mt-4">{actions}</div>}
            </div>

            {/* Dismiss Button */}
            {dismissible && (
              <div className="flex-shrink-0 ml-4">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className={cn(
                    'inline-flex rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    variant === 'filled'
                      ? 'text-current hover:bg-background/10 focus-visible:ring-offset-transparent'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-offset-background'
                  )}
                  aria-label="Dismiss alert"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Helper hook for managing alert state
export function useAlert() {
  const [alerts, setAlerts] = React.useState<
    Array<{
      id: string;
      type: AlertType;
      title?: string;
      message?: string;
      variant?: AlertVariant;
      dismissible?: boolean;
      autoHideDuration?: number;
    }>
  >([]);

  const addAlert = React.useCallback(
    (alert: {
      type: AlertType;
      title?: string;
      message?: string;
      variant?: AlertVariant;
      dismissible?: boolean;
      autoHideDuration?: number;
    }) => {
      const id = Math.random().toString(36).substr(2, 9);
      setAlerts((prev) => [...prev, { ...alert, id }]);
      return id;
    },
    []
  );

  const removeAlert = React.useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  const clearAlerts = React.useCallback(() => {
    setAlerts([]);
  }, []);

  // Convenience methods
  const success = React.useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<{
        variant: AlertVariant;
        dismissible: boolean;
        autoHideDuration: number;
      }>
    ) => {
      return addAlert({
        type: 'success',
        title,
        message,
        dismissible: true,
        autoHideDuration: 5000,
        ...options,
      });
    },
    [addAlert]
  );

  const error = React.useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<{
        variant: AlertVariant;
        dismissible: boolean;
        autoHideDuration: number;
      }>
    ) => {
      return addAlert({
        type: 'error',
        title,
        message,
        dismissible: true,
        ...options,
      });
    },
    [addAlert]
  );

  const warning = React.useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<{
        variant: AlertVariant;
        dismissible: boolean;
        autoHideDuration: number;
      }>
    ) => {
      return addAlert({
        type: 'warning',
        title,
        message,
        dismissible: true,
        autoHideDuration: 7000,
        ...options,
      });
    },
    [addAlert]
  );

  const info = React.useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<{
        variant: AlertVariant;
        dismissible: boolean;
        autoHideDuration: number;
      }>
    ) => {
      return addAlert({
        type: 'info',
        title,
        message,
        dismissible: true,
        autoHideDuration: 5000,
        ...options,
      });
    },
    [addAlert]
  );

  return {
    alerts,
    addAlert,
    removeAlert,
    clearAlerts,
    success,
    error,
    warning,
    info,
  };
}

// Alert container component for displaying multiple alerts
interface AlertContainerProps {
  alerts: ReturnType<typeof useAlert>['alerts'];
  onRemove: (id: string) => void;
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center';
  className?: string;
}

export function AlertContainer({
  alerts,
  onRemove,
  position = 'top-right',
  className = '',
}: AlertContainerProps) {
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 transform -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 transform -translate-x-1/2',
  };

  return (
    <div
      className={`fixed z-50 max-w-sm w-full space-y-2 ${positionClasses[position]} ${className}`}
    >
      <AnimatePresence>
        {alerts.map((alert) => (
          <motion.div
            key={alert.id}
            layout
            initial={{
              opacity: 0,
              x: position.includes('right') ? 50 : position.includes('left') ? -50 : 0,
              y: position.includes('top') ? -20 : 20,
            }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{
              opacity: 0,
              x: position.includes('right') ? 50 : position.includes('left') ? -50 : 0,
              y: position.includes('top') ? -20 : 20,
            }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Alert
              type={alert.type}
              variant={alert.variant}
              title={alert.title}
              dismissible={alert.dismissible}
              autoHideDuration={alert.autoHideDuration}
              onDismiss={() => onRemove(alert.id)}
            >
              {alert.message}
            </Alert>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
