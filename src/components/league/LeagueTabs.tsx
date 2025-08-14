'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { League, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import LeagueOverview from '@/components/league/LeagueOverview';

interface LeagueTabsProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

type TabType = 'overview' | 'teams' | 'roster' | 'trades' | 'waivers' | 'draft' | 'settings';

interface Tab {
  id: TabType;
  name: string;
  icon?: React.ReactNode;
  badge?: number;
}

export default function LeagueTabs({ league, members, currentUserId }: LeagueTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams?.get('tab') as TabType;
    if (tabParam && ['overview', 'teams', 'roster', 'trades', 'waivers', 'draft', 'settings'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tabId: TabType) => {
    setActiveTab(tabId);
    // Update URL without full page reload
    const newUrl = `${pathname}?tab=${tabId}`;
    router.push(newUrl, { scroll: false });
  };

  const tabs: Tab[] = [
    { id: 'overview', name: 'Overview' },
    { id: 'teams', name: 'Teams' },
    { id: 'roster', name: 'My Roster' },
    { id: 'trades', name: 'Trades', badge: 2 },
    { id: 'waivers', name: 'Waivers' },
    { id: 'draft', name: 'Draft' },
    { id: 'settings', name: 'Settings' }
  ];

  const isAdmin = members.find(m => m.userId === currentUserId)?.role === 'owner';

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-lg">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span>{tab.name}</span>
                  {tab.badge && (
                    <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      {tab.badge}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <LeagueOverview 
                league={league} 
                members={members} 
                currentUserId={currentUserId}
              />
            )}

            {activeTab === 'teams' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">League Teams</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {members.map((member) => (
                    <div key={member.id} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{member.teamName}</h3>
                        {member.role === 'owner' && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">
                            Owner
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        Joined {new Date(member.joinedAt).toLocaleDateString()}
                      </p>
                      {league.status !== 'preseason' && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-sm">
                            <span className="text-gray-600">Record: </span>
                            <span className="font-medium">4-3</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-600">Points: </span>
                            <span className="font-medium">823.1</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'roster' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">My Roster</h2>
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600">Roster management coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === 'trades' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Trades</h2>
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Propose Trade
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600">Trade interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === 'waivers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Waiver Wire</h2>
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Submit Claim
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600">Waiver wire interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === 'draft' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">Draft</h2>
                {league.draftDate ? (
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="font-medium text-blue-900 mb-2">Draft Scheduled</h3>
                    <p className="text-blue-700 mb-4">
                      {new Date(league.draftDate).toLocaleString()}
                    </p>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                      Join Draft Room
                    </button>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-8 text-center">
                    <p className="text-gray-600">No draft scheduled yet</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-gray-900">League Settings</h2>
                
                {/* Basic Info */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="league-name" className="block text-sm font-medium text-gray-700 mb-1">League Name</label>
                      <input 
                        id="league-name"
                        type="text" 
                        value={league.name} 
                        disabled={!isAdmin}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label htmlFor="league-code" className="block text-sm font-medium text-gray-700 mb-1">League Code</label>
                      <input 
                        id="league-code"
                        type="text" 
                        value={league.code} 
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Scoring Categories */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Scoring Categories</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {league.categories.map((category) => {
                      const categoryData = FANTASY_CATEGORIES[category];
                      return (
                        <div key={category} className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
                          <span className="text-sm font-medium text-blue-900">
                            {categoryData?.label || category}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Trade Settings */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Trade Settings</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="trade-limit" className="block text-sm font-medium text-gray-700 mb-1">Trade Limit</label>
                      <input 
                        id="trade-limit"
                        type="number" 
                        value={league.tradeSettings.tradeLimit} 
                        disabled={!isAdmin}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label htmlFor="trade-review" className="block text-sm font-medium text-gray-700 mb-1">Review Process</label>
                      <select 
                        id="trade-review"
                        value={league.tradeSettings.tradeReview} 
                        disabled={!isAdmin}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
                      >
                        <option value="none">None</option>
                        <option value="admin">Admin Review</option>
                        <option value="veto">League Veto</option>
                      </select>
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex justify-end space-x-3">
                    <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                      Cancel
                    </button>
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
