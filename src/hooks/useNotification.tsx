'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

export interface NotificationState {
  show: boolean;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function useNotification() {
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    type: 'info',
    message: '',
  });

  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = (type: NotificationState['type'], message: string, duration = 5000) => {
    // Clear any existing timer to prevent memory leaks
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }

    setNotification({ show: true, type, message });

    // Store the new timer ID in the ref
    notificationTimerRef.current = setTimeout(() => {
      setNotification((prev) => ({ ...prev, show: false }));
      notificationTimerRef.current = null;
    }, duration);
  };

  const hideNotification = () => {
    // Clear any existing timer when manually hiding
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = null;
    }
    setNotification((prev) => ({ ...prev, show: false }));
  };

  // Cleanup timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  return {
    notification,
    showNotification,
    hideNotification,
  };
}

interface NotificationToastProps {
  notification: NotificationState;
  position?: 'top-right' | 'top-center' | 'top-left';
  className?: string;
}

export function NotificationToast({
  notification,
  position = 'top-right',
  className = '',
}: NotificationToastProps) {
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-center': 'top-4 left-1/2 transform -translate-x-1/2',
    'top-left': 'top-4 left-4',
  };

  return (
    <AnimatePresence>
      {notification.show && (
        <motion.div
          initial={{ opacity: 0, y: -50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -50, scale: 0.9 }}
          className={`fixed ${positionClasses[position]} z-50 ${className}`}
        >
          <div
            className={`max-w-sm rounded-md border bg-background px-4 py-3 text-foreground shadow-lg ${
              notification.type === 'success'
                ? 'border-result-win/40 [&_svg]:text-result-win'
                : notification.type === 'error'
                  ? 'border-result-loss/40 [&_svg]:text-result-loss'
                  : 'border-border [&_svg]:text-muted-foreground'
            }`}
            role={notification.type === 'error' ? 'alert' : 'status'}
            aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            <div className="flex items-center gap-2">
              {notification.type === 'success' && (
                <CheckCircleIcon aria-hidden="true" className="w-5 h-5" />
              )}
              {notification.type === 'error' && (
                <ExclamationTriangleIcon aria-hidden="true" className="w-5 h-5" />
              )}
              {notification.type === 'info' && (
                <InformationCircleIcon aria-hidden="true" className="w-5 h-5" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
