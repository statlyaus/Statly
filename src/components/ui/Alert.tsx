'use client';

import React from 'react';
import type { ReactNode } from 'react';

import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

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
      icon: CheckCircleIcon,
      baseClasses: 'bg-green-600 text-white border-green-600',
      iconClasses: 'text-white',
    },
    outlined: {
      type: 'success',
      variant: 'outlined',
      icon: CheckCircleIcon,
      baseClasses: 'bg-white text-green-800 border-green-300',
      iconClasses: 'text-green-500',
    },
    light: {
      type: 'success',
      variant: 'light',
      icon: CheckCircleIcon,
      baseClasses: 'bg-green-50 text-green-800 border-green-200',
      iconClasses: 'text-green-500',
    },
  },
  error: {
    filled: {
      type: 'error',
      variant: 'filled',
      icon: XCircleIcon,
      baseClasses: 'bg-red-600 text-white border-red-600',
      iconClasses: 'text-white',
    },
    outlined: {
      type: 'error',
      variant: 'outlined',
      icon: XCircleIcon,
      baseClasses: 'bg-white text-red-800 border-red-300',
      iconClasses: 'text-red-500',
    },
    light: {
      type: 'error',
      variant: 'light',
      icon: XCircleIcon,
      baseClasses: 'bg-red-50 text-red-800 border-red-200',
      iconClasses: 'text-red-500',
    },
  },
  warning: {
    filled: {
      type: 'warning',
      variant: 'filled',
      icon: ExclamationTriangleIcon,
      baseClasses: 'bg-yellow-600 text-white border-yellow-600',
      iconClasses: 'text-white',
    },
    outlined: {
      type: 'warning',
      variant: 'outlined',
      icon: ExclamationTriangleIcon,
      baseClasses: 'bg-white text-yellow-800 border-yellow-300',
      iconClasses: 'text-yellow-500',
    },
    light: {
      type: 'warning',
      variant: 'light',
      icon: ExclamationTriangleIcon,
      baseClasses: 'bg-yellow-50 text-yellow-800 border-yellow-200',
      iconClasses: 'text-yellow-500',
    },
  },
  info: {
    filled: {
      type: 'info',
      variant: 'filled',
      icon: InformationCircleIcon,
      baseClasses: 'bg-blue-600 text-white border-blue-600',
      iconClasses: 'text-white',
    },
    outlined: {
      type: 'info',
      variant: 'outlined',
      icon: InformationCircleIcon,
      baseClasses: 'bg-white text-blue-800 border-blue-300',
      iconClasses: 'text-blue-500',
    },
    light: {
      type: 'info',
      variant: 'light',
      icon: InformationCircleIcon,
      baseClasses: 'bg-blue-50 text-blue-800 border-blue-200',
      iconClasses: 'text-blue-500',
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
          className={`relative border rounded-lg p-4 ${config.baseClasses} ${className}`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start">
            {/* Icon */}
            {IconComponent && (
              <div className="flex-shrink-0">
                <IconComponent className={`w-5 h-5 ${config.iconClasses}`} />
              </div>
            )}

            {/* Content */}
            <div className={`${IconComponent ? 'ml-3' : ''} flex-1 min-w-0`}>
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
                  className={`inline-flex rounded-md p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    variant === 'filled'
                      ? 'text-white hover:bg-black hover:bg-opacity-10 focus:ring-white focus:ring-offset-transparent'
                      : `${config.iconClasses} hover:bg-black hover:bg-opacity-5 focus:ring-${type === 'warning' ? 'yellow' : type === 'error' ? 'red' : type === 'success' ? 'green' : 'blue'}-500 focus:ring-offset-white`
                  }`}
                  aria-label="Dismiss alert"
                >
                  <XMarkIcon className="w-4 h-4" />
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
