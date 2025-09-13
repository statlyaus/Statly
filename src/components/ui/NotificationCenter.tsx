'use client';

import React, { useState } from 'react';

import {
  BellIcon,
  CheckIcon,
  TrashIcon,
  EyeIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TrophyIcon,
  UserGroupIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

// Notification types
export type NotificationType =
  | 'trade_proposal'
  | 'trade_accepted'
  | 'trade_rejected'
  | 'draft_reminder'
  | 'lineup_reminder'
  | 'score_update'
  | 'league_update'
  | 'system'
  | 'achievement';

// Notification priority levels
export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

// Notification status
export type NotificationStatus = 'unread' | 'read' | 'archived';

// Base notification interface
export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  status: NotificationStatus;
  title: string;
  message: string;
  timestamp: Date;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

// Notification configuration for styling and icons
interface NotificationConfig {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
}

const NOTIFICATION_CONFIGS: Record<NotificationType, NotificationConfig> = {
  trade_proposal: {
    icon: ArrowPathIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  trade_accepted: {
    icon: CheckIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  trade_rejected: {
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  draft_reminder: {
    icon: UserGroupIcon,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
  },
  lineup_reminder: {
    icon: ExclamationTriangleIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  score_update: {
    icon: TrophyIcon,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
  league_update: {
    icon: InformationCircleIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  system: {
    icon: InformationCircleIcon,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
  achievement: {
    icon: TrophyIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
};

// Filter options
interface NotificationFilters {
  status?: NotificationStatus[];
  type?: NotificationType[];
  priority?: NotificationPriority[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// Component props
interface NotificationCenterProps {
  notifications: Notification[];
  onMarkAsRead?: (notificationId: string) => void;
  onMarkAllAsRead?: () => void;
  onDelete?: (notificationId: string) => void;
  onClearAll?: () => void;
  onAction?: (notification: Notification) => void;
  onRefresh?: () => void;
  loading?: boolean;
  className?: string;
}

// Individual notification item component
interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAction?: (notification: Notification) => void;
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onAction,
}: NotificationItemProps) {
  const config = NOTIFICATION_CONFIGS[notification.type];
  const IconComponent = config.icon;

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return timestamp.toLocaleDateString();
  };

  const isExpired = notification.expiresAt && new Date() > notification.expiresAt;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`relative p-4 border-l-4 ${config.borderColor} ${
        notification.status === 'unread' ? config.bgColor : 'bg-white'
      } hover:bg-gray-50 transition-colors ${isExpired ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start space-x-3">
        {/* Icon */}
        <div className={`flex-shrink-0 p-2 rounded-full ${config.bgColor}`}>
          <IconComponent className={`w-5 h-5 ${config.color}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4
                className={`text-sm font-medium ${
                  notification.status === 'unread' ? 'text-gray-900' : 'text-gray-700'
                }`}
              >
                {notification.title}
                {notification.priority === 'urgent' && (
                  <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Urgent
                  </span>
                )}
              </h4>
              <p className="mt-1 text-sm text-gray-600">{notification.message}</p>

              {/* Action button */}
              {notification.actionLabel && notification.actionUrl && (
                <button
                  onClick={() => onAction?.(notification)}
                  className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-500"
                >
                  {notification.actionLabel}
                </button>
              )}
            </div>

            {/* Timestamp and status indicator */}
            <div className="flex-shrink-0 ml-4 text-right">
              <p className="text-xs text-gray-500">{formatTimestamp(notification.timestamp)}</p>
              {notification.status === 'unread' && (
                <div className="mt-1 w-2 h-2 bg-blue-600 rounded-full ml-auto"></div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex items-center space-x-2">
            {notification.status === 'unread' && onMarkAsRead && (
              <button
                onClick={() => onMarkAsRead(notification.id)}
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900"
              >
                <EyeIcon className="w-3 h-3 mr-1" />
                Mark as read
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => onDelete(notification.id)}
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-red-600 hover:text-red-900"
              >
                <TrashIcon className="w-3 h-3 mr-1" />
                Delete
              </button>
            )}
          </div>

          {/* Expiration warning */}
          {isExpired && (
            <div className="mt-2 text-xs text-red-600 font-medium">
              This notification has expired
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Notification bell icon with counter
interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
  className?: string;
}

export function NotificationBell({ unreadCount, onClick, className = '' }: NotificationBellProps) {
  return (
    <button
      onClick={onClick}
      className={`relative p-2 text-gray-600 hover:text-gray-900 transition-colors ${className}`}
      aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
    >
      {unreadCount > 0 ? <BellIconSolid className="w-6 h-6" /> : <BellIcon className="w-6 h-6" />}

      {unreadCount > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-600 rounded-full min-w-[20px] h-5"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </motion.span>
      )}
    </button>
  );
}

// Main notification center component
export default function NotificationCenter({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onClearAll,
  onAction,
  onRefresh,
  loading = false,
  className = '',
}: NotificationCenterProps) {
  const [filters, _setFilters] = useState<NotificationFilters>({});
  const [_showFilters, _setShowFilters] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'unread' | 'read'>('all');

  // Filter notifications based on selected filters and tab
  const filteredNotifications = React.useMemo(() => {
    let result = notifications;

    // Apply tab filter
    if (selectedTab === 'unread') {
      result = result.filter((n) => n.status === 'unread');
    } else if (selectedTab === 'read') {
      result = result.filter((n) => n.status === 'read');
    }

    // Apply other filters
    if (filters.status?.length) {
      result = result.filter((n) => filters.status!.includes(n.status));
    }
    if (filters.type?.length) {
      result = result.filter((n) => filters.type!.includes(n.type));
    }
    if (filters.priority?.length) {
      result = result.filter((n) => filters.priority!.includes(n.priority));
    }
    if (filters.dateRange) {
      result = result.filter(
        (n) => n.timestamp >= filters.dateRange!.start && n.timestamp <= filters.dateRange!.end
      );
    }

    // Sort by timestamp (newest first)
    return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [notifications, filters, selectedTab]);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  // Tabs
  const tabs = [
    { id: 'all', label: 'All', count: notifications.length },
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'read', label: 'Read', count: notifications.length - unreadCount },
  ] as const;

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Notifications</h3>
          <div className="flex items-center space-x-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Refresh notifications"
              >
                <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}

            {unreadCount > 0 && onMarkAllAsRead && (
              <button
                onClick={onMarkAllAsRead}
                className="text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Mark all as read
              </button>
            )}

            {notifications.length > 0 && onClearAll && (
              <button
                onClick={onClearAll}
                className="text-sm font-medium text-red-600 hover:text-red-500"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex space-x-6 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-1 px-2 py-1 text-xs rounded-full ${
                    selectedTab === tab.id
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading notifications...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-8 text-center">
            <BellIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h4 className="text-sm font-medium text-gray-900 mb-1">No notifications</h4>
            <p className="text-sm text-gray-500">
              {selectedTab === 'unread' ? "You're all caught up!" : 'No notifications to display.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            <AnimatePresence>
              {filteredNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={onMarkAsRead}
                  onDelete={onDelete}
                  onAction={onAction}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook for managing notification state
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = React.useCallback(
    (notification: Omit<Notification, 'id' | 'timestamp' | 'status'>) => {
      const newNotification: Notification = {
        ...notification,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        status: 'unread',
      };
      setNotifications((prev) => [newNotification, ...prev]);
      return newNotification.id;
    },
    []
  );

  const markAsRead = React.useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, status: 'read' as const } : n))
    );
  }, []);

  const markAllAsRead = React.useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, status: 'read' as const })));
  }, []);

  const deleteNotification = React.useCallback((notificationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
  }, []);

  const clearAll = React.useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  return {
    notifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    unreadCount,
  };
}
