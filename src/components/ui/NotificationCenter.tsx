'use client';

import React, { useState } from 'react';

import {
  AlertTriangle,
  Bell,
  Check,
  Eye,
  Info,
  RefreshCw,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
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
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: true }>;
  color: string;
  bgColor: string;
  borderColor: string;
}

const NOTIFICATION_CONFIGS: Record<NotificationType, NotificationConfig> = {
  trade_proposal: {
    icon: RefreshCw,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
  },
  trade_accepted: {
    icon: Check,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
  },
  trade_rejected: {
    icon: AlertTriangle,
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
  },
  draft_reminder: {
    icon: Users,
    color: 'text-accent-foreground',
    bgColor: 'bg-accent',
    borderColor: 'border-border',
  },
  lineup_reminder: {
    icon: AlertTriangle,
    color: 'text-accent-foreground',
    bgColor: 'bg-accent',
    borderColor: 'border-border',
  },
  score_update: {
    icon: Trophy,
    color: 'text-secondary-foreground',
    bgColor: 'bg-secondary',
    borderColor: 'border-border',
  },
  league_update: {
    icon: Info,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
  },
  system: {
    icon: Info,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border',
  },
  achievement: {
    icon: Trophy,
    color: 'text-accent-foreground',
    bgColor: 'bg-accent',
    borderColor: 'border-border',
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
        notification.status === 'unread' ? config.bgColor : 'bg-background'
      } transition-colors hover:bg-muted/50 ${isExpired ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start space-x-3">
        {/* Icon */}
        <div className={`flex-shrink-0 p-2 rounded-full ${config.bgColor}`}>
          <IconComponent className={`h-5 w-5 ${config.color}`} aria-hidden />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4
                className={`text-sm font-medium ${
                  notification.status === 'unread' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {notification.title}
                {notification.priority === 'urgent' && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                    Urgent
                  </span>
                )}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>

              {/* Action button */}
              {notification.actionLabel && notification.actionUrl && (
                <button
                  onClick={() => onAction?.(notification)}
                  className="mt-2 text-sm font-medium text-primary hover:text-primary/80"
                >
                  {notification.actionLabel}
                </button>
              )}
            </div>

            {/* Timestamp and status indicator */}
            <div className="flex-shrink-0 ml-4 text-right">
              <p className="text-xs text-muted-foreground">
                {formatTimestamp(notification.timestamp)}
              </p>
              {notification.status === 'unread' && (
                <div className="ml-auto mt-1 h-2 w-2 rounded-full bg-primary"></div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex items-center space-x-2">
            {notification.status === 'unread' && onMarkAsRead && (
              <button
                onClick={() => onMarkAsRead(notification.id)}
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Eye className="mr-1 h-3 w-3" aria-hidden />
                Mark as read
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => onDelete(notification.id)}
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-destructive hover:text-destructive/80"
              >
                <Trash2 className="mr-1 h-3 w-3" aria-hidden />
                Delete
              </button>
            )}
          </div>

          {/* Expiration warning */}
          {isExpired && (
            <div className="mt-2 text-xs font-medium text-destructive">
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
      className={`relative p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
      aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
    >
      <Bell className={`h-6 w-6 ${unreadCount > 0 ? 'fill-current' : ''}`} aria-hidden />

      {unreadCount > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-2 py-1 text-xs font-bold leading-none text-destructive-foreground"
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
    <div className={`rounded-lg border border-border bg-card shadow-lg ${className}`}>
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-foreground">Notifications</h3>
          <div className="flex items-center space-x-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Refresh notifications"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              </button>
            )}

            {unreadCount > 0 && onMarkAllAsRead && (
              <button
                onClick={onMarkAllAsRead}
                className="text-sm font-medium text-primary hover:text-primary/80"
              >
                Mark all as read
              </button>
            )}

            {notifications.length > 0 && onClearAll && (
              <button
                onClick={onClearAll}
                className="text-sm font-medium text-destructive hover:text-destructive/80"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex space-x-6 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                selectedTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={`ml-1 px-2 py-1 text-xs rounded-full ${
                    selectedTab === tab.id
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
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
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p className="mt-2 text-muted-foreground">Loading notifications...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-8 text-center">
            <Bell className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden />
            <h4 className="mb-1 text-sm font-medium text-foreground">No notifications</h4>
            <p className="text-sm text-muted-foreground">
              {selectedTab === 'unread' ? "You're all caught up!" : 'No notifications to display.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
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
