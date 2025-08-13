import { motion } from 'framer-motion';

interface TopPicksModuleProps {
  refreshTrigger: number;
}

interface TopPick {
  id: string;
  name: string;
  position: string;
  team: string;
  points: number;
  trend: 'up' | 'down' | 'stable';
  change: number;
}

export default function TopPicksModule({ refreshTrigger: _refreshTrigger }: TopPicksModuleProps) {
  // Mock data - in real app, fetch from API
  const topPicks: TopPick[] = [
    {
      id: '1',
      name: 'Christian Petracca',
      position: 'MID',
      team: 'MEL',
      points: 127.3,
      trend: 'up',
      change: 5.2,
    },
    {
      id: '2',
      name: 'Lachie Neale',
      position: 'MID',
      team: 'BRI',
      points: 124.8,
      trend: 'up',
      change: 2.1,
    },
    {
      id: '3',
      name: 'Marcus Bontempelli',
      position: 'MID',
      team: 'WBD',
      points: 122.5,
      trend: 'down',
      change: -1.3,
    },
    {
      id: '4',
      name: 'Max Gawn',
      position: 'RUC',
      team: 'MEL',
      points: 119.7,
      trend: 'stable',
      change: 0.2,
    },
  ];

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'down':
        return (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        );
    }
  };

  return (
    <div className="space-y-3">
      {topPicks.map((pick, index) => (
        <motion.div
          key={pick.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.1 }}
          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-500 w-4">#{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{pick.name}</p>
                <div className="flex items-center space-x-2 mt-1">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                    pick.position === 'MID' ? 'bg-blue-100 text-blue-800' :
                    pick.position === 'RUC' ? 'bg-purple-100 text-purple-800' :
                    pick.position === 'FWD' ? 'bg-red-100 text-red-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {pick.position}
                  </span>
                  <span className="text-xs text-slate-500">{pick.team}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 text-right">
            <div>
              <p className="text-sm font-semibold text-slate-900">{pick.points}</p>
              <div className="flex items-center space-x-1">
                {getTrendIcon(pick.trend)}
                <span className={`text-xs font-medium ${
                  pick.trend === 'up' ? 'text-green-600' :
                  pick.trend === 'down' ? 'text-red-600' :
                  'text-slate-500'
                }`}>
                  {pick.change > 0 ? '+' : ''}{pick.change}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      ))}

      <div className="pt-2">
        <button className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium">
          View All Rankings →
        </button>
      </div>
    </div>
  );
}
