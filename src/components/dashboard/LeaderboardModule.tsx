import { motion } from 'framer-motion';

interface LeaderboardModuleProps {
  refreshTrigger: number;
}

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  points: number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  isCurrentUser?: boolean;
}

export default function LeaderboardModule({ refreshTrigger: _refreshTrigger }: LeaderboardModuleProps) {
  // Mock data - in real app, fetch from API
  const leaderboard: LeaderboardEntry[] = [
    {
      id: '1',
      rank: 1,
      name: 'The Dominator',
      points: 2847,
      change: 2,
      trend: 'up',
    },
    {
      id: '2',
      rank: 2,
      name: 'Fantasy King',
      points: 2831,
      change: -1,
      trend: 'down',
    },
    {
      id: '3',
      rank: 3,
      name: 'You',
      points: 2798,
      change: 1,
      trend: 'up',
      isCurrentUser: true,
    },
    {
      id: '4',
      rank: 4,
      name: 'Coach Supreme',
      points: 2776,
      change: 0,
      trend: 'stable',
    },
    {
      id: '5',
      rank: 5,
      name: 'Footy Genius',
      points: 2765,
      change: -2,
      trend: 'down',
    },
    {
      id: '6',
      rank: 6,
      name: 'Draft Master',
      points: 2742,
      change: 1,
      trend: 'up',
    },
  ];

  const getTrendIcon = (trend: string, size = 'w-3 h-3') => {
    switch (trend) {
      case 'up':
        return (
          <svg className={`${size} text-green-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
          </svg>
        );
      case 'down':
        return (
          <svg className={`${size} text-red-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
          </svg>
        );
      default:
        return (
          <svg className={`${size} text-slate-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        );
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
          🥇
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-8 h-8 bg-gradient-to-br from-gray-300 to-gray-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
          🥈
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
          🥉
        </div>
      );
    }
    return (
      <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-slate-700 font-bold text-sm">
        {rank}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-600">League Standings</h4>
        <span className="text-xs text-slate-500">Round 23</span>
      </div>

      <div className="space-y-2">
        {leaderboard.map((entry, index) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
              entry.isCurrentUser 
                ? 'bg-blue-50 border border-blue-200' 
                : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center space-x-3">
              {getRankBadge(entry.rank)}
              <div>
                <p className={`text-sm font-medium ${
                  entry.isCurrentUser ? 'text-blue-900' : 'text-slate-900'
                }`}>
                  {entry.name}
                </p>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-600">{entry.points.toLocaleString()} pts</span>
                  {entry.change !== 0 && (
                    <div className="flex items-center space-x-1">
                      {getTrendIcon(entry.trend, 'w-3 h-3')}
                      <span className={`text-xs font-medium ${
                        entry.trend === 'up' ? 'text-green-600' :
                        entry.trend === 'down' ? 'text-red-600' :
                        'text-slate-500'
                      }`}>
                        {Math.abs(entry.change)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="pt-2 border-t border-slate-200">
        <button className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium">
          View Full Leaderboard →
        </button>
      </div>
    </div>
  );
}
