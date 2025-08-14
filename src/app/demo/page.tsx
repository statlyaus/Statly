'use client';

import React, { useState } from 'react';
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
  PlayerStatTooltip
} from '@/components/ui';
import { PlayerCard } from '@/components/player';
import { MainSidebar } from '@/components/navigation';
import { RosterManager } from '@/components/roster';
import type { PlayerCardData } from '@/components/player';
import type { TableColumn } from '@/components/ui/DataTable';

// Sample data for testing
const samplePlayers: PlayerCardData[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    team: 'Western Bulldogs',
    position: 'MID',
    jerseyNumber: 4,
    status: 'available',
    isStarred: true,
    currentPrice: 850000,
    averageScore: 108.5,
    totalPoints: 2170,
    seasonHigh: 156,
    trend: 'up',
    nextGame: {
      opponent: 'Richmond',
      date: new Date('2025-08-20'),
      isHome: true,
    },
    ownership: 45.2,
    projectedScore: 115,
    priceChange: 15000,
  },
  {
    id: '2', 
    name: 'Clayton Oliver',
    team: 'Melbourne',
    position: 'MID',
    jerseyNumber: 4,
    status: 'injured',
    currentPrice: 780000,
    averageScore: 95.3,
    totalPoints: 1906,
    seasonHigh: 142,
    trend: 'down',
    nextGame: {
      opponent: 'Collingwood',
      date: new Date('2025-08-22'),
      isHome: false,
    },
    ownership: 38.7,
    projectedScore: 0,
    priceChange: -25000,
  }
];

const tableColumns: TableColumn<PlayerCardData>[] = [
  {
    key: 'name',
    label: 'Player',
    sortable: true,
    filterable: true,
    render: (value, row) => (
      <div className="flex items-center space-x-2">
        <span className="font-medium">{value as string}</span>
        <PositionBadge position={row.position} variant="colored" />
      </div>
    ),
  },
  {
    key: 'team',
    label: 'Team',
    sortable: true,
    filterable: true,
  },
  {
    key: 'averageScore',
    label: 'Avg Score',
    sortable: true,
    align: 'right',
    render: (value) => (value as number)?.toFixed(1) || '-',
  },
  {
    key: 'currentPrice',
    label: 'Price',
    sortable: true,
    align: 'right',
    render: (value) => `$${(value as number)?.toLocaleString()}`,
  },
  {
    key: 'status',
    label: 'Status',
    filterable: true,
    render: (value) => (
      <Badge variant={value === 'available' ? 'success' : 'danger'}>
        {value as string}
      </Badge>
    ),
  },
];

export default function ComponentDemoPage() {
  const [selectedDemo, setSelectedDemo] = useState('badges');
  const [_loadingDemo, _setLoadingDemo] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  
  // Hooks for testing
  const { alerts, removeAlert, success, error, warning, info } = useAlert();
  const modal = useModal();
  const { confirm, ConfirmationModal } = useConfirmation();
  const { 
    notifications, 
    addNotification, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification, 
    clearAll, 
    unreadCount 
  } = useNotifications();

  // Demo data generators
  const generateSampleNotifications = () => {
    const types = ['trade_proposal', 'draft_reminder', 'score_update', 'league_update'] as const;
    const priorities = ['low', 'medium', 'high'] as const;
    
    for (let i = 0; i < 5; i++) {
      addNotification({
        type: types[Math.floor(Math.random() * types.length)],
        priority: priorities[Math.floor(Math.random() * priorities.length)],
        title: `Test Notification ${i + 1}`,
        message: `This is a sample notification message for testing purposes.`,
      });
    }
  };

  const demoSections = {
    badges: 'Badge Components',
    alerts: 'Alert System',
    modals: 'Modal Dialogs', 
    loading: 'Loading States',
    tooltips: 'Tooltips',
    notifications: 'Notifications',
    playerCards: 'Player Cards',
    dataTable: 'Data Table',
    navigation: 'Navigation',
    roster: 'Roster Manager',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Demo Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-gray-900">Component Demo</h1>
            <div className="flex items-center space-x-4">
              <NotificationBell 
                unreadCount={unreadCount} 
                onClick={() => setSelectedDemo('notifications')} 
              />
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Toggle Sidebar Demo
              </button>
            </div>
          </div>
          
          {/* Demo selector */}
          <div className="flex space-x-1 overflow-x-auto pb-2">
            {Object.entries(demoSections).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSelectedDemo(key)}
                className={`px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap ${
                  selectedDemo === key
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar Demo */}
        {showSidebar && (
          <div className="w-64 bg-white border-r border-gray-200">
            <MainSidebar />
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 p-6">
          <div className="max-w-6xl mx-auto">
            
            {/* Badge Demo */}
            {selectedDemo === 'badges' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Badge Components</h2>
                  
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-3">Basic Badges</h3>
                      <BadgeGroup>
                        <Badge variant="default">Default</Badge>
                        <Badge variant="success">Success</Badge>
                        <Badge variant="warning">Warning</Badge>
                        <Badge variant="danger">Danger</Badge>
                        <Badge variant="info">Info</Badge>
                      </BadgeGroup>
                    </div>

                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-3">Sports-Specific Badges</h3>
                      <div className="space-y-3">
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Position Badges</h4>
                          <BadgeGroup>
                            <PositionBadge position="DEF" variant="colored" />
                            <PositionBadge position="MID" variant="colored" />
                            <PositionBadge position="RUC" variant="colored" />
                            <PositionBadge position="FWD" variant="colored" />
                          </BadgeGroup>
                        </div>

                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Team Badges</h4>
                          <BadgeGroup>
                            <TeamBadge teamName="Western Bulldogs" teamCode="WBD" />
                            <TeamBadge teamName="Melbourne" teamCode="MEL" />
                            <TeamBadge teamName="Richmond" teamCode="RIC" />
                          </BadgeGroup>
                        </div>

                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Status & Numbers</h4>
                          <BadgeGroup>
                            <StatusBadge status="online" showText />
                            <StatusBadge status="away" showText />
                            <NumberBadge count={12} />
                            <NumberBadge count={156} max={99} />
                            <PriceChangeBadge change={15000} />
                            <PriceChangeBadge change={-25000} />
                          </BadgeGroup>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Alert Demo */}
            {selectedDemo === 'alerts' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Alert System</h2>
                  
                  <div className="space-y-4">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => success('Success!', 'Your action was completed successfully.')}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                      >
                        Success Alert
                      </button>
                      <button
                        onClick={() => error('Error!', 'Something went wrong. Please try again.')}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                      >
                        Error Alert
                      </button>
                      <button
                        onClick={() => warning('Warning!', 'Please review your lineup before continuing.')}
                        className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
                      >
                        Warning Alert
                      </button>
                      <button
                        onClick={() => info('Info', 'The draft will begin in 5 minutes.')}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        Info Alert
                      </button>
                    </div>
                    
                    <AlertContainer
                      alerts={alerts}
                      onRemove={removeAlert}
                      position="top-right"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Modal Demo */}
            {selectedDemo === 'modals' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Modal Dialogs</h2>
                  
                  <div className="space-x-2">
                    <button
                      onClick={modal.open}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Open Modal
                    </button>
                    <button
                      onClick={() => confirm({
                        title: 'Confirm Action',
                        message: 'Are you sure you want to proceed with this action?',
                        variant: 'danger',
                        onConfirm: async () => {
                          await new Promise(resolve => setTimeout(resolve, 2000));
                          success('Action completed!');
                        }
                      })}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      Confirmation Dialog
                    </button>
                  </div>

                  <Modal
                    isOpen={modal.isOpen}
                    onClose={modal.close}
                    title="Demo Modal"
                    description="This is a sample modal for testing purposes."
                  >
                    <div className="space-y-4">
                      <p className="text-gray-600">
                        This modal demonstrates the basic functionality with title, description, and content area.
                      </p>
                      <div className="flex space-x-2">
                        <button
                          onClick={modal.close}
                          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                        >
                          Close
                        </button>
                        <button
                          onClick={() => {
                            success('Modal action completed!');
                            modal.close();
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </Modal>

                  {ConfirmationModal}
                </div>
              </div>
            )}

            {/* Loading Demo */}
            {selectedDemo === 'loading' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading States</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-3">Spinner Types</h3>
                      <div className="space-y-4">
                        <LoadingSpinner type="circular" size="md" text="Circular" />
                        <LoadingSpinner type="dots" size="md" text="Dots" />
                        <LoadingSpinner type="football" size="md" text="Football" />
                        <LoadingSpinner type="wave" size="md" text="Wave" />
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-3">Specialized Components</h3>
                      <div className="space-y-4">
                        <InlineLoading text="Inline loading..." />
                        <SectionLoading height="h-32" title="Loading section..." />
                        <SkeletonCard />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tooltip Demo */}
            {selectedDemo === 'tooltips' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Tooltips</h2>
                  
                  <div className="space-y-6">
                    <div className="flex space-x-4">
                      <Tooltip content="This is a basic tooltip" placement="top">
                        <button className="px-4 py-2 bg-blue-600 text-white rounded-md">
                          Hover me (top)
                        </button>
                      </Tooltip>
                      
                      <Tooltip content="Bottom tooltip" placement="bottom" variant="dark">
                        <button className="px-4 py-2 bg-green-600 text-white rounded-md">
                          Hover me (bottom)
                        </button>
                      </Tooltip>

                      <div className="flex items-center gap-2">
                        <span>Info icon with tooltip</span>
                        <InfoTooltip content="This provides additional information about the feature." />
                      </div>
                    </div>

                    <div>
                      <PlayerStatTooltip
                        playerName="Marcus Bontempelli"
                        stats={{
                          'Average': '108.5',
                          'Last 3': '112.3',
                          'Price': '$850k',
                          'Ownership': '45.2%'
                        }}
                      >
                        <span className="cursor-pointer text-blue-600 underline">
                          Player with stats tooltip
                        </span>
                      </PlayerStatTooltip>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Demo */}
            {selectedDemo === 'notifications' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Notification Center</h2>
                  
                  <div className="space-x-2 mb-4">
                    <button
                      onClick={generateSampleNotifications}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Generate Sample Notifications
                    </button>
                    <button
                      onClick={clearAll}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      Clear All
                    </button>
                  </div>

                  <div className="max-w-2xl">
                    <NotificationCenter
                      notifications={notifications}
                      onMarkAsRead={markAsRead}
                      onMarkAllAsRead={markAllAsRead}
                      onDelete={deleteNotification}
                      onClearAll={clearAll}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Player Cards Demo */}
            {selectedDemo === 'playerCards' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Player Cards</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {samplePlayers.map((player) => (
                      <PlayerCard
                        key={player.id}
                        player={player}
                        variant="detailed"
                        showStats
                        showNextGame
                        onStar={(player) => success(`${player.name} ${player.isStarred ? 'removed from' : 'added to'} favorites`)}
                        onClick={(player) => info(`Clicked on ${player.name}`)}
                      />
                    ))}
                  </div>

                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-3">Compact Variant</h3>
                    <div className="space-y-2">
                      {samplePlayers.map((player) => (
                        <PlayerCard
                          key={`compact-${player.id}`}
                          player={player}
                          variant="compact"
                          selectable
                          onSelect={(player) => info(`Selected ${player.name}`)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Data Table Demo */}
            {selectedDemo === 'dataTable' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Data Table</h2>
                  
                  <DataTable<Record<string, unknown>>
                    data={samplePlayers as unknown as Record<string, unknown>[]}
                    columns={tableColumns as unknown as TableColumn<Record<string, unknown>>[]}
                    searchable
                    pagination={{ pageSize: 5 }}
                    onRowClick={(player) => info(`Clicked on ${(player as unknown as PlayerCardData).name}`)}
                    className="shadow-lg"
                  />
                </div>
              </div>
            )}

            {/* Navigation Demo */}
            {selectedDemo === 'navigation' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Navigation Components</h2>
                  <p className="text-gray-600 mb-4">
                    The main sidebar is available via the &ldquo;Toggle Sidebar Demo&rdquo; button in the header.
                  </p>
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="w-64">
                      <MainSidebar />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Roster Demo */}
            {selectedDemo === 'roster' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Roster Manager</h2>
                  
                  <div className="max-w-4xl">
                    <RosterManager
                      leagueId="demo-league"
                      teamId="demo-team"
                      onRosterChange={(slots) => info(`Roster updated with ${slots.length} slots`)}
                      readonly={false}
                    />
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
