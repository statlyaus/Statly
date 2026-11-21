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

import { alertStyles, buttonStyles } from './controlStyles';

type AlertType = 'success' | 'error' | 'warning' | 'info';

// Each type is a ground from alertStyles (style guide, "Alerts"); a warning is a deadline on sun.
const ALERT_TONES: Record<
  AlertType,
  {
    icon: React.ComponentType<{ className?: string }>;
    tone: 'success' | 'error' | 'deadline' | 'info';
    iconClasses: string;
  }
> = {
  success: { icon: CheckCircleIcon, tone: 'success', iconClasses: 'text-success' },
  error: { icon: XCircleIcon, tone: 'error', iconClasses: 'text-destructive-text' },
  warning: { icon: ExclamationTriangleIcon, tone: 'deadline', iconClasses: 'text-foreground' },
  info: { icon: InformationCircleIcon, tone: 'info', iconClasses: 'text-foreground' },
};

interface AlertProps {
  type: AlertType;
  title?: string;
  children?: ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
  actions?: ReactNode;
  autoHideDuration?: number;
  /** Set by AlertContainer: a queued alert floats, so it takes the floating cut and hard . */
  floating?: boolean;
}

export default function Alert({
  type,
  title,
  children,
  dismissible = false,
  onDismiss,
  className = '',
  actions,
  autoHideDuration,
  floating = false,
}: AlertProps) {
  const [isVisible, setIsVisible] = React.useState(true);

  const handleDismiss = React.useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss?.();
    }, 150); // Wait for animation to complete
  }, [onDismiss]);

  React.useEffect(() => {
    if (autoHideDuration && autoHideDuration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, autoHideDuration);

      return () => clearTimeout(timer);
    }
  }, [autoHideDuration, handleDismiss]);

  const tone = ALERT_TONES[type];
  const Icon = tone.icon;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={`relative flex items-start gap-3 p-4 text-sm ${alertStyles({ tone: tone.tone })} ${
            floating ? 'rounded-cut-float shadow-hard' : ''
          } ${className}`}
          role="alert"
          aria-live="polite"
        >
          <div className="flex-shrink-0">
            <Icon className={`w-5 h-5 ${tone.iconClasses}`} />
          </div>

          <div className="flex-1 min-w-0">
            {title && <h3 className="text-sm font-semibold mb-1">{title}</h3>}

            {children && <div className="text-sm">{children}</div>}

            {actions && <div className="mt-4">{actions}</div>}
          </div>

          {dismissible && (
            <div className="flex-shrink-0">
              <button
                type="button"
                onClick={handleDismiss}
                className={buttonStyles({ variant: 'ghost', size: 'xs' })}
                aria-label="Dismiss alert"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface AlertOptions {
  dismissible?: boolean;
  autoHideDuration?: number;
}

interface QueuedAlert extends AlertOptions {
  id: string;
  type: AlertType;
  title?: string;
  message?: string;
}

// Holds the alerts an AlertContainer shows, with one helper per type.
export function useAlert() {
  const [alerts, setAlerts] = React.useState<QueuedAlert[]>([]);

  const addAlert = React.useCallback((alert: Omit<QueuedAlert, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 11);
    setAlerts((prev) => [...prev, { ...alert, id }]);
    return id;
  }, []);

  const removeAlert = React.useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  const success = React.useCallback(
    (title: string, message?: string, options?: AlertOptions) =>
      addAlert({
        type: 'success',
        title,
        message,
        dismissible: true,
        autoHideDuration: 5000,
        ...options,
      }),
    [addAlert]
  );

  const error = React.useCallback(
    (title: string, message?: string, options?: AlertOptions) =>
      addAlert({ type: 'error', title, message, dismissible: true, ...options }),
    [addAlert]
  );

  const warning = React.useCallback(
    (title: string, message?: string, options?: AlertOptions) =>
      addAlert({
        type: 'warning',
        title,
        message,
        dismissible: true,
        autoHideDuration: 7000,
        ...options,
      }),
    [addAlert]
  );

  const info = React.useCallback(
    (title: string, message?: string, options?: AlertOptions) =>
      addAlert({
        type: 'info',
        title,
        message,
        dismissible: true,
        autoHideDuration: 5000,
        ...options,
      }),
    [addAlert]
  );

  return { alerts, removeAlert, success, error, warning, info };
}

interface AlertContainerProps {
  alerts: QueuedAlert[];
  onRemove: (id: string) => void;
}

// Stacks queued alerts in the top-right corner.
export function AlertContainer({ alerts, onRemove }: AlertContainerProps) {
  return (
    <div className="fixed z-50 max-w-sm w-full space-y-2 top-4 right-4">
      <AnimatePresence>
        {alerts.map((alert) => (
          <motion.div
            key={alert.id}
            layout
            initial={{ opacity: 0, x: 50, y: -20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 50, y: -20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Alert
              type={alert.type}
              title={alert.title}
              dismissible={alert.dismissible}
              autoHideDuration={alert.autoHideDuration}
              floating
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
