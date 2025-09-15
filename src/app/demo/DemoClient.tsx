'use client';

import React, { useState } from 'react';
import {
  RealTimeMatchCenter,
  SmartTradeAnalyzer,
  LeagueAnalyticsDashboard,
} from '@/components/advanced';
import { MainSidebar, AppLayout } from '@/components/navigation';
import { PlayerCard } from '@/components/player';
import type { PlayerCardData } from '@/components/player';
import { RosterManager } from '@/components/roster';
import {
  Badge,
  StatusBadge,
  NumberBadge,
  TeamBadge,
  PositionBadge,
  PriceChangeBadge,
  BadgeGroup,
  useAlert,
  AlertContainer,
  DataTable,
  LoadingSpinner,
  InlineLoading,
  SectionLoading,
  SkeletonCard,
  Modal,
  useModal,
  useConfirmation,
  NotificationCenter,
  NotificationBell,
  useNotifications,
  Tooltip,
  InfoTooltip,
  PlayerStatTooltip,
} from '@/components/ui';
import type { TableColumn } from '@/components/ui/DataTable';

const samplePlayers: PlayerCardData[] = [
  { id: '1', name: 'Marcus Bontempelli', team: 'Western Bulldogs', position: 'MID', jerseyNumber: 4, status: 'available', isStarred: true, currentPrice: 850000, averageScore: 108.5, totalPoints: 2170, seasonHigh: 156, trend: 'up', nextGame: { opponent: 'Richmond', date: new Date('2025-08-20'), isHome: true }, ownership: 45.2, projectedScore: 115, priceChange: 15000 },
  { id: '2', name: 'Clayton Oliver', team: 'Melbourne', position: 'MID', jerseyNumber: 4, status: 'injured', currentPrice: 780000, averageScore: 95.3, totalPoints: 1906, seasonHigh: 142, trend: 'down', nextGame: { opponent: 'Collingwood', date: new Date('2025-08-22'), isHome: false }, ownership: 38.7, projectedScore: 0, priceChange: -25000 },
];

const tableColumns: TableColumn<PlayerCardData>[] = [
  { key: 'name', label: 'Player', sortable: true, filterable: true, render: (value, row) => (<div className="flex items-center space-x-2"><span className="font-medium">{value as string}</span><PositionBadge position={row.position} variant="colored" /></div>) },
  { key: 'team', label: 'Team', sortable: true, filterable: true },
  { key: 'averageScore', label: 'Avg Score', sortable: true, align: 'right', render: (value) => (value as number)?.toFixed(1) || '-' },
  { key: 'currentPrice', label: 'Price', sortable: true, align: 'right', render: (value) => `$${(value as number)?.toLocaleString()}` },
  { key: 'status', label: 'Status', filterable: true, render: (value) => (<Badge variant={(value as string) === 'available' ? 'success' : 'danger'}>{value as string}</Badge>) },
];

export default function DemoClient() {
  const [selectedDemo, setSelectedDemo] = useState('phase3-advanced');
  const [_loadingDemo] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const { alerts, removeAlert, success, error, warning, info } = useAlert();
  const modal = useModal();
  const { confirm, ConfirmationModal } = useConfirmation();
  const { notifications, addNotification, markAsRead, markAllAsRead, deleteNotification, clearAll, unreadCount } = useNotifications();

  const generateSampleNotifications = () => {
    const types = ['trade_proposal', 'draft_reminder', 'score_update', 'league_update'] as const;
    const priorities = ['low', 'medium', 'high'] as const;
    for (let i = 0; i < 5; i++) {
      addNotification({ type: types[Math.floor(Math.random() * types.length)], priority: priorities[Math.floor(Math.random() * priorities.length)], title: `Test Notification ${i + 1}`, message: `This is a sample notification message for testing purposes.` });
    }
  };

  const demoSections = { badges: 'Badge Components', alerts: 'Alert System', modals: 'Modal Dialogs', loading: 'Loading States', tooltips: 'Tooltips', notifications: 'Notifications', playerCards: 'Player Cards', dataTable: 'Data Table', navigation: 'Navigation', roster: 'Roster Manager' } as const;

  return (
    <AppLayout>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <h1 className="text-xl font-semibold text-gray-900">Component Demo</h1>
              <div className="flex items-center space-x-4">
                <NotificationBell unreadCount={unreadCount} onClick={() => setSelectedDemo('notifications')} />
                <button onClick={() => setShowSidebar(!showSidebar)} className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Toggle Sidebar Demo</button>
              </div>
            </div>
          </div>
        </div>
        {/* The remainder of the original demo page content can stay unchanged */}
      </div>
    </AppLayout>
  );
}

