'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { CalendarIcon, ShareIcon, PencilIcon, PlayIcon, UserGroupIcon, ClockIcon, ArrowRightIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { League, LeagueMember } from '@/types/leagues';

interface LeagueOverviewProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

interface OnboardingTask {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: string;
}

interface ActivityEvent {
  id: string;
  type: 'trade' | 'waiver' | 'draft' | 'admin' | 'join';
  title: string;
  description: string;
  timestamp: string;
  user?: string;
}

export default function LeagueOverview({ league, members, currentUserId }: LeagueOverviewProps) {
  const router = useRouter();
  const [activityFilter, setActivityFilter] = useState('all');
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [teamName, setTeamName] = useState('');
  
  // Mock data - these would come from actual API calls
  const onboardingTasks: OnboardingTask[] = [
    {
      id: 'team-name',
      title: 'Set team name & logo',
      description: 'Customize your team identity',
      completed: false,
      action: 'Set Team Name'
    },
    {
      id: 'draft-room',
      title: 'Join draft room',
      description: 'Test your device for the upcoming draft',
      completed: false,
      action: 'Test Draft Room'
    },
    {
      id: 'favorite-players',
      title: 'Star favorite players',
      description: 'Build your draft queue with preferred players',
      completed: false,
      action: 'Browse Players'
    },
    {
      id: 'read-rules',
      title: 'Read league rules',
      description: 'Understand categories, trades, and waivers',
      completed: true
    }
  ];

  const handleTaskAction = (taskId: string) => {
    switch (taskId) {
      case 'team-name':
        setShowTeamSettings(true);
        break;
      case 'draft-room':
        // Navigate to draft room (assuming there's a draft for this league)
        router.push(`/drafts/${league.id}`);
        break;
      case 'favorite-players':
        // Navigate to players page with league context
        router.push('/players');
        break;
      default:
        break;
    }
  };

  const activityEvents: ActivityEvent[] = [
    {
      id: '1',
      type: 'join',
      title: 'New member joined',
      description: 'Alex Smith joined the league as "Thunder Bolts"',
      timestamp: '2025-08-14T10:30:00Z',
      user: 'Alex Smith'
    },
    {
      id: '2',
      type: 'admin',
      title: 'Draft scheduled',
      description: 'League admin scheduled the draft for Aug 24, 7:30pm AEST',
      timestamp: '2025-08-13T15:45:00Z'
    },
    {
      id: '3',
      type: 'join',
      title: 'League created',
      description: 'Welcome to the league! Start inviting friends.',
      timestamp: league.createdAt
    }
  ];

  const standings = [
    { rank: 1, teamName: 'Thunder Bolts', record: '5-2', points: 847.3 },
    { rank: 2, teamName: 'Fire Hawks', record: '4-3', points: 823.1 },
    { rank: 3, teamName: 'Storm Eagles', record: '4-3', points: 809.7 },
    { rank: 4, teamName: 'Lightning Cats', record: '3-4', points: 795.2 },
    { rank: 5, teamName: 'Ice Wolves', record: '2-5', points: 778.9 }
  ];

  const waiverOrder = [
    { rank: 1, teamName: 'Ice Wolves', claims: 3 },
    { rank: 2, teamName: 'Lightning Cats', claims: 1 },
    { rank: 3, teamName: 'Storm Eagles', claims: 2 },
    { rank: 4, teamName: 'Fire Hawks', claims: 0 },
    { rank: 5, teamName: 'Thunder Bolts', claims: 1 }
  ];

  const isAdmin = members.find(m => m.userId === currentUserId)?.role === 'owner';
  const nextEvent = league.draftDate ? 
    { type: 'Draft', date: new Date(league.draftDate), description: 'Draft starts' } :
    { type: 'Round 21', date: new Date('2025-08-22T19:50:00'), description: 'Lockout begins' };

  const formatEventDate = (date: Date) => {
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays < 7) return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const filteredActivity = activityFilter === 'all' 
    ? activityEvents 
    : activityEvents.filter(event => event.type === activityFilter);

  const completedTasks = onboardingTasks.filter(task => task.completed);
  const pendingTasks = onboardingTasks.filter(task => !task.completed);

  return (
    <div className="space-y-6">
      {/* A. Header Strip */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-lg p-6"
      >
        <div className="flex items-center justify-between">
          {/* Left: League Info */}
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              {league.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{league.name}</h1>
              <div className="flex items-center space-x-3 text-sm text-gray-600">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  league.type === 'private' 
                    ? 'bg-purple-100 text-purple-800' 
                    : 'bg-green-100 text-green-800'
                }`}>
                  {league.type === 'private' ? 'Private' : 'Public'}
                </span>
                <span className="flex items-center">
                  <UserGroupIcon className="w-4 h-4 mr-1" />
                  {members.length}/{league.maxTeams}
                </span>
              </div>
            </div>
          </div>

          {/* Center: Next Event */}
          <div className="hidden md:flex items-center space-x-2 bg-blue-50 px-4 py-2 rounded-lg">
            <CalendarIcon className="w-5 h-5 text-blue-600" />
            <div className="text-center">
              <div className="text-sm font-medium text-blue-900">
                {nextEvent.type}: {formatEventDate(nextEvent.date)}
              </div>
              <div className="text-xs text-blue-600">
                {nextEvent.date.toLocaleTimeString('en-AU', { 
                  hour: 'numeric', 
                  minute: '2-digit',
                  timeZoneName: 'short'
                })}
              </div>
            </div>
          </div>

          {/* Right: CTA Buttons */}
          <div className="flex items-center space-x-2">
            <button className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <ShareIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Invite</span>
            </button>
            {isAdmin && (
              <button className="flex items-center space-x-1 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                <PencilIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Edit</span>
              </button>
            )}
            <button className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <PlayIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Set Lineup</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* B. Onboarding Checklist */}
      {pendingTasks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Get Started</h2>
            <span className="text-sm text-gray-600">
              {completedTasks.length}/{onboardingTasks.length} completed
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingTasks.map((task, index) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + index * 0.1 }}
                className="bg-white rounded-lg p-4 border border-blue-200"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 mb-1">{task.title}</h3>
                    <p className="text-sm text-gray-600 mb-3">{task.description}</p>
                    {task.action && (
                      <button 
                        onClick={() => handleTaskAction(task.id)}
                        className="text-sm text-blue-600 font-medium hover:text-blue-700 flex items-center transition-colors hover:bg-blue-50 px-2 py-1 rounded-md"
                      >
                        {task.action}
                        <ArrowRightIcon className="w-3 h-3 ml-1" />
                      </button>
                    )}
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ml-3 ${
                    task.completed 
                      ? 'border-green-500 bg-green-500' 
                      : 'border-gray-300'
                  }`}>
                    {task.completed && (
                      <CheckIcon className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Team Settings Modal */}
      {showTeamSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl p-6 w-full max-w-md mx-4"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Set Team Name</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 mb-2">
                  Team Name
                </label>
                <input
                  id="teamName"
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your team name"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowTeamSettings(false)}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // TODO: Save team name to API
                    console.log('Saving team name:', teamName);
                    setShowTeamSettings(false);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save Team Name
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* C. League Activity Feed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 bg-white rounded-xl shadow-lg p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">League Activity</h2>
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
              {['all', 'trades', 'waivers', 'draft', 'admin'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActivityFilter(filter)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activityFilter === filter
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filteredActivity.length > 0 ? (
              filteredActivity.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    event.type === 'trade' ? 'bg-orange-100' :
                    event.type === 'waiver' ? 'bg-purple-100' :
                    event.type === 'draft' ? 'bg-green-100' :
                    event.type === 'admin' ? 'bg-blue-100' : 'bg-gray-100'
                  }`}>
                    {event.type === 'join' && <UserGroupIcon className="w-4 h-4 text-gray-600" />}
                    {event.type === 'admin' && <PencilIcon className="w-4 h-4 text-blue-600" />}
                    {event.type === 'draft' && <PlayIcon className="w-4 h-4 text-green-600" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{event.title}</h3>
                    <p className="text-sm text-gray-600">{event.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(event.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <UserGroupIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No activity yet — invite friends to get started.</p>
              </div>
            )}
          </div>
        </motion.div>

        <div className="space-y-6">
          {/* D. Quick Standings Widget */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl shadow-lg p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Standings</h2>
              <button className="text-sm text-blue-600 font-medium hover:text-blue-700">
                View full table
              </button>
            </div>

            {league.status === 'preseason' ? (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Teams Joined</h3>
                <div className="grid grid-cols-2 gap-2">
                  {members.slice(0, 6).map((member) => (
                    <div key={member.id} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                      {member.teamName}
                    </div>
                  ))}
                  {members.length > 6 && (
                    <div className="text-sm text-gray-500 p-2 bg-gray-50 rounded text-center">
                      +{members.length - 6} more
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {standings.slice(0, 5).map((team) => (
                  <div key={team.rank} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium">
                        {team.rank}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{team.teamName}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900">{team.points}</div>
                      <div className="text-xs text-gray-500">{team.record}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* E. This Week's Matchup */}
          {league.status !== 'preseason' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-xl shadow-lg p-6"
            >
              <h2 className="text-lg font-semibold text-gray-900 mb-4">This Week&apos;s Matchup</h2>
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-900">Your Team</span>
                  <span className="text-xs text-gray-600">vs</span>
                  <span className="text-sm font-medium text-gray-900">Fire Hawks</span>
                </div>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">847.3</div>
                    <div className="text-xs text-gray-600">Projected</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-purple-600">823.1</div>
                    <div className="text-xs text-gray-600">Projected</div>
                  </div>
                </div>
                <button className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                  Edit Lineup
                </button>
              </div>
            </motion.div>
          )}

          {/* F. Waiver Snapshot */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-xl shadow-lg p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Waiver Wire</h2>
              <button className="text-sm text-blue-600 font-medium hover:text-blue-700">
                Make a claim
              </button>
            </div>

            <div className="mb-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600 mb-3">
                <ClockIcon className="w-4 h-4" />
                <span>Next processing: Wed 8:00 AM</span>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-700">Current Order</h3>
                {waiverOrder.slice(0, 5).map((team) => (
                  <div key={team.rank} className="flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-2">
                      <span className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium">
                        {team.rank}
                      </span>
                      <span className="text-gray-900">{team.teamName}</span>
                    </div>
                    <span className="text-gray-500">{team.claims} claims</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
